from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.access import SchoolAccess, log
from api.models import TimetableEntry

from ..common import ALL_ROLES, MANAGERS, SchoolModelViewSet, active_timetable, my_children, parse_date, teacher_for
from ..models import Assessment, Grade, Homework, Student, Term
from ..serializers import AssessmentSerializer, HomeworkSerializer, TermSerializer
from .attendance import attendance_stats

STAFF = ("admin", "staff", "teacher")


def teaches(user, school, group, subject):
    teacher = teacher_for(user, school)
    if not teacher:
        return None
    tt = active_timetable(school)
    if tt and tt.entries.filter(teacher=teacher, student_group=group, subject=subject).exists():
        return teacher
    return None


class HomeworkViewSet(SchoolModelViewSet):
    model = Homework
    serializer_class = HomeworkSerializer
    read_roles = STAFF
    write_roles = STAFF
    module = "homework"

    def get_queryset(self):
        qs = Homework.objects.filter(school=self.get_school()).select_related("group", "subject", "teacher")
        p = self.request.query_params
        if p.get("group"):
            qs = qs.filter(group_id=p["group"])
        if p.get("from"):
            qs = qs.filter(due_date__gte=p["from"])
        if p.get("to"):
            qs = qs.filter(assigned_date__lte=p["to"])
        if not self.get_access().is_manager:
            qs = qs.filter(teacher__user=self.request.user)
        return qs

    def perform_create(self, serializer):
        access = self.get_access()
        d = serializer.validated_data
        teacher = teaches(self.request.user, access.school, d["group"], d["subject"])
        if not access.is_manager and not teacher:
            raise PermissionDenied("You can only set homework for groups and subjects you teach.")
        hw = serializer.save(school=access.school, teacher=teacher or teacher_for(self.request.user, access.school))
        from api.notify import notify
        from ..common import guardian_users
        students = Student.objects.filter(group=hw.group, is_active=True)
        notify(access.school, guardian_users(students), "homework", f"Homework: {hw.subject.name}",
               f"{hw.title} - due {hw.due_date:%A %d %B}", link="/homework", channels=("push",))

    def perform_update(self, serializer):
        access = self.get_access()
        if not access.is_manager and serializer.instance.teacher and serializer.instance.teacher.user_id != self.request.user.id:
            raise PermissionDenied("Not your homework.")
        serializer.save()


class TermViewSet(SchoolModelViewSet):
    model = Term
    serializer_class = TermSerializer
    read_roles = ALL_ROLES
    module = "grades"


class AssessmentViewSet(SchoolModelViewSet):
    model = Assessment
    serializer_class = AssessmentSerializer
    read_roles = STAFF
    write_roles = STAFF
    module = "grades"
    audit_model = True

    def get_queryset(self):
        qs = Assessment.objects.filter(school=self.get_school()).select_related("group", "subject", "term")
        p = self.request.query_params
        for key in ("term", "group", "subject"):
            if p.get(key):
                qs = qs.filter(**{f"{key}_id": p[key]})
        if not self.get_access().is_manager:
            me = teacher_for(self.request.user, self.get_school())
            tt = active_timetable(self.get_school())
            pairs = set(tt.entries.filter(teacher=me).values_list("student_group_id", "subject_id")) if me and tt else set()
            ids = [a.id for a in qs if (a.group_id, a.subject_id) in pairs]
            qs = qs.filter(id__in=ids)
        return qs

    def perform_create(self, serializer):
        access = self.get_access()
        d = serializer.validated_data
        teacher = teaches(self.request.user, access.school, d["group"], d["subject"])
        if not access.is_manager and not teacher:
            raise PermissionDenied("You can only grade groups and subjects you teach.")
        obj = serializer.save(school=access.school, teacher=teacher)
        self.audit("create", obj)

    @action(detail=True, methods=["get", "post"])
    def grades(self, request, pk=None, school_id=None):
        """GET grade sheet / POST {"grades": [{"student": id, "score": 87.5, "comment": ""}]}"""
        a = self.get_object()
        students = list(Student.objects.filter(school=a.school, group=a.group, is_active=True))
        if request.method == "POST":
            ids = {s.id for s in students}
            rows = request.data.get("grades") or []
            with transaction.atomic():
                for r in rows:
                    if r.get("student") not in ids:
                        raise ValidationError({"grades": f"Student {r.get('student')} is not in {a.group.name}."})
                    score = r.get("score")
                    if score not in (None, ""):
                        score = Decimal(str(score))
                        if score < 0 or score > a.max_score:
                            raise ValidationError({"grades": f"Scores must be between 0 and {a.max_score}."})
                    else:
                        score = None
                    old = Grade.objects.filter(assessment=a, student_id=r["student"]).first()
                    Grade.objects.update_or_create(assessment=a, student_id=r["student"],
                                                   defaults={"score": score, "comment": str(r.get("comment", ""))[:200]})
                    if old is None or old.score != score:
                        log(a.school, request.user, "update", a, model="ops.Grade",
                            object_id=f"{a.id}:{r['student']}",
                            summary=f"{a.subject.name} {a.name}: student {r['student']} "
                                    f"{old.score if old else '-'} -> {score}",
                            )
        grades = {g.student_id: g for g in a.grades.all()}
        return Response({"assessment": AssessmentSerializer(a).data, "students": [
            {"id": s.id, "name": s.full_name, "score": grades[s.id].score if s.id in grades else None,
             "comment": grades[s.id].comment if s.id in grades else ""} for s in students]})


def letter_for(school, pct):
    if pct is None:
        return ""
    for band in school.grading_scale or []:
        if pct >= float(band["min"]):
            return band["label"]
    return ""


def subject_results(student, term):
    """Weighted percentage per subject for one student in one term."""
    per = defaultdict(lambda: {"weighted": Decimal(0), "weights": Decimal(0), "items": []})
    for g in Grade.objects.filter(student=student, assessment__term=term, score__isnull=False) \
            .select_related("assessment__subject"):
        a = g.assessment
        pct = g.score / a.max_score * 100 if a.max_score else Decimal(0)
        p = per[a.subject.name]
        p["weighted"] += pct * a.weight
        p["weights"] += a.weight
        p["items"].append({"name": a.name, "date": a.date, "score": g.score, "max": a.max_score,
                           "pct": round(float(pct), 1)})
    return {name: {"percentage": round(float(p["weighted"] / p["weights"]), 1) if p["weights"] else None,
                   "items": p["items"]} for name, p in per.items()}


class ReportCardView(APIView):
    """GET /schools/{id}/students/{sid}/report-card/?term= - data for the printable report card."""
    permission_classes = [IsAuthenticated]

    def get(self, request, school_id, student_id):
        access = SchoolAccess(request, school_id, read_roles=ALL_ROLES, module="grades")
        school = access.school
        student = get_object_or_404(Student, id=student_id, school=school)
        if not access.is_staff and not my_children(request.user, school).filter(id=student.id).exists():
            from rest_framework.exceptions import NotFound
            raise NotFound()
        terms = Term.objects.filter(school=school)
        term = terms.filter(id=request.query_params.get("term")).first() if request.query_params.get("term") \
            else terms.filter(start_date__lte=timezone.localdate()).order_by("-start_date").first() or terms.first()
        if not term:
            raise ValidationError("No terms are set up yet.")
        results = subject_results(student, term)
        att = attendance_stats(school, [student], term.start_date, term.end_date).get(student.id, {})
        pcts = [r["percentage"] for r in results.values() if r["percentage"] is not None]
        overall = round(sum(pcts) / len(pcts), 1) if pcts else None
        return Response({
            "school": {"name": school.name, "logo": school.logo, "address": school.address, "phone": school.phone,
                       "brand_color": school.brand_color, "principal": school.principal_name},
            "student": {"name": student.full_name, "number": student.student_number,
                        "group": student.group.name if student.group else ""},
            "term": TermSerializer(term).data, "terms": TermSerializer(terms, many=True).data,
            "subjects": [{"subject": k, **v, "letter": letter_for(school, v["percentage"]),
                          "passed": v["percentage"] is not None and v["percentage"] >= float(school.pass_mark)}
                         for k, v in sorted(results.items())],
            "overall": overall, "overall_letter": letter_for(school, overall),
            "attendance": att, "pass_mark": float(school.pass_mark),
        })


def at_risk_students(school, days=30):
    """Students whose attendance is low, whose average is below the pass mark, or whose grades are falling."""
    today = timezone.localdate()
    students = list(Student.objects.filter(school=school, is_active=True).select_related("group"))
    att = attendance_stats(school, students, today - timedelta(days=days), today)
    threshold = school.absence_alert_threshold
    pass_mark = float(school.pass_mark)
    grades = defaultdict(list)
    for g in Grade.objects.filter(student__in=students, score__isnull=False).select_related("assessment") \
            .order_by("assessment__date", "assessment_id"):
        a = g.assessment
        grades[g.student_id].append(float(g.score / a.max_score * 100) if a.max_score else 0.0)
    out = []
    for s in students:
        reasons = []
        a = att.get(s.id)
        if a and a["days"] >= 3 and a["absence_rate"] > threshold:
            reasons.append({"kind": "attendance", "text": f"Absent {a['absence_rate']}% of the last {days} days"})
        pcts = grades.get(s.id, [])
        if pcts:
            avg = sum(pcts) / len(pcts)
            if avg < pass_mark:
                reasons.append({"kind": "grades", "text": f"Average {avg:.0f}% is below the pass mark ({pass_mark:.0f}%)"})
            if len(pcts) >= 4:
                half = len(pcts) // 2
                early, late = sum(pcts[:half]) / half, sum(pcts[half:]) / (len(pcts) - half)
                if early - late >= 15:
                    reasons.append({"kind": "trend", "text": f"Grades falling: {early:.0f}% -> {late:.0f}%"})
        if reasons:
            out.append({"student_id": s.id, "student": s.full_name, "group": s.group.name if s.group else "",
                        "reasons": reasons})
    return sorted(out, key=lambda r: (-len(r["reasons"]), r["student"]))


class AtRiskView(APIView):
    """GET /schools/{id}/at-risk/ - early warning list for admin/staff (and teachers for their groups)."""
    permission_classes = [IsAuthenticated]

    def get(self, request, school_id):
        access = SchoolAccess(request, school_id, read_roles=STAFF)
        rows = at_risk_students(access.school)
        if not access.is_manager:
            me = teacher_for(request.user, access.school)
            tt = active_timetable(access.school)
            groups = set(tt.entries.filter(teacher=me).values_list("student_group__name", flat=True)) if me and tt else set()
            rows = [r for r in rows if r["group"] in groups]
        return Response({"students": rows})
