from collections import defaultdict
from datetime import date, timedelta

from django.db import transaction
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.access import SchoolAccess
from api.models import SchedulePeriod, StudentGroup
from api.notify import notify

from ..common import ALL_ROLES, MANAGERS, SchoolModelViewSet, active_timetable, guardian_users, my_children, \
    parse_date, teacher_for
from ..models import AbsenceReport, AttendanceRecord, CoverAssignment, Student
from ..serializers import AbsenceReportSerializer

STAFF = ("admin", "staff", "teacher")


def teacher_lessons(teacher, day):
    """Lessons a teacher gives on a date: own timetable lessons (minus ones covered by others) + covers."""
    tt = active_timetable(teacher.school)
    if not tt:
        return []
    covered_away = set(CoverAssignment.objects.filter(date=day, entry__teacher=teacher).values_list("entry_id", flat=True))
    own = [e for e in tt.entries.filter(teacher=teacher, day_of_week=day.isoweekday())
           .select_related("period", "student_group", "subject", "classroom") if e.id not in covered_away]
    covers = [c.entry for c in CoverAssignment.objects.filter(date=day, covering_teacher=teacher)
              .select_related("entry__period", "entry__student_group", "entry__subject", "entry__classroom")]
    lessons = [(e, False) for e in own] + [(e, True) for e in covers]
    return sorted(lessons, key=lambda x: x[0].period.order)


def can_take(access, user, group, day, period):
    if access.is_manager:
        return True
    teacher = teacher_for(user, access.school)
    if not teacher:
        return False
    for e, _ in teacher_lessons(teacher, day):
        if e.student_group_id == group.id and (period is None or e.period_id == period.id):
            return True
    return False


class TeacherTodayView(APIView):
    """GET /schools/{id}/teacher/today/?date= - my lessons today (with covers) and whether attendance is done."""
    permission_classes = [IsAuthenticated]

    def get(self, request, school_id):
        access = SchoolAccess(request, school_id, read_roles=STAFF)
        day = parse_date(request.query_params.get("date"), timezone.localdate())
        teacher = teacher_for(request.user, access.school)
        if not teacher:
            return Response({"lessons": [], "teacher": None})
        per_day = access.school.attendance_mode == "day"
        rows = []
        for e, is_cover in teacher_lessons(teacher, day):
            taken = AttendanceRecord.objects.filter(
                student__group=e.student_group, date=day, **({"period__isnull": True} if per_day else {"period": e.period})
            ).exists()
            rows.append({"entry": e.id, "period": e.period.name, "period_id": e.period_id,
                         "start": str(e.period.start_time)[:5], "end": str(e.period.end_time)[:5],
                         "group": e.student_group.name, "group_id": e.student_group_id, "subject": e.subject.name,
                         "room": e.classroom.name, "is_cover": is_cover, "attendance_taken": taken})
        return Response({"teacher": teacher.name, "date": day, "lessons": rows, "attendance_mode": access.school.attendance_mode})


class AttendanceSheetView(APIView):
    """GET/POST /schools/{id}/attendance/sheet/?group=&date=&period=

    POST {"group", "date", "period" (omit in per-day mode), "records": [{"student", "status", "note"}]}
    Absent / late marks notify the child's parents automatically (once per child per day/period).
    """
    permission_classes = [IsAuthenticated]

    def _context(self, request, data, writing):
        access = SchoolAccess(request, self.kwargs["school_id"], read_roles=STAFF, write_roles=STAFF,
                              module="attendance")
        school = access.school
        group = get_object_or_404(StudentGroup, id=data.get("group"), school=school)
        day = parse_date(data.get("date"), timezone.localdate())
        period = None
        if school.attendance_mode == "period":
            if not data.get("period"):
                raise ValidationError({"period": "Choose the lesson period."})
            period = get_object_or_404(SchedulePeriod, id=data.get("period"), schedule__school=school)
        if not can_take(access, request.user, group, day, period):
            raise PermissionDenied("You do not teach this group at this time.")
        return access, group, day, period

    def get(self, request, school_id):
        access, group, day, period = self._context(request, request.query_params, False)
        students = list(Student.objects.filter(school=access.school, group=group, is_active=True))
        records = {r.student_id: r for r in AttendanceRecord.objects.filter(student__in=students, date=day, period=period)}
        reported = set(AbsenceReport.objects.filter(student__in=students, date_from__lte=day, date_to__gte=day)
                       .values_list("student_id", flat=True))
        return Response({"group": group.name, "date": day, "period": period.name if period else None, "students": [
            {"id": s.id, "name": s.full_name,
             "status": records[s.id].status if s.id in records else ("excused" if s.id in reported else None),
             "note": records[s.id].note if s.id in records else "", "reported_absent": s.id in reported}
            for s in students]})

    def post(self, request, school_id):
        access, group, day, period = self._context(request, request.data, True)
        records = request.data.get("records") or []
        valid = {c for c, _ in AttendanceRecord.STATUSES}
        students = {s.id: s for s in Student.objects.filter(school=access.school, group=group, is_active=True)}
        to_notify = []
        with transaction.atomic():
            for r in records:
                sid, st = r.get("student"), r.get("status")
                if sid not in students or st not in valid:
                    raise ValidationError({"records": f"Invalid record {r}."})
                rec, _ = AttendanceRecord.objects.update_or_create(
                    student_id=sid, date=day, period=period,
                    defaults={"school": access.school, "status": st, "note": str(r.get("note", ""))[:200],
                              "taken_by": request.user})
                if st in ("absent", "late") and not rec.parent_notified:
                    to_notify.append(rec)
        for rec in to_notify:
            s = students[rec.student_id]
            when = f"{period.name} " if period else ""
            word = "absent" if rec.status == "absent" else "late"
            notify(access.school, guardian_users([s]), "attendance", f"{s.first_name} was marked {word}",
                   f"{s.full_name} was marked {word} {when}on {day:%A %d %B}.", link="/children",
                   data={"student": s.id, "date": str(day), "status": rec.status})
            AttendanceRecord.objects.filter(id=rec.id).update(parent_notified=True)
        return Response({"saved": len(records), "parents_notified": len(to_notify)})


class AbsenceReportViewSet(SchoolModelViewSet):
    """Parents report an absence in advance for their own children; staff see and acknowledge all."""
    model = AbsenceReport
    serializer_class = AbsenceReportSerializer
    read_roles = STAFF + ("parent",)
    write_roles = MANAGERS + ("parent",)
    module = "attendance"

    def get_queryset(self):
        qs = AbsenceReport.objects.filter(school=self.get_school()).select_related("student").order_by("-date_from")
        if not self.get_access().is_staff:
            qs = qs.filter(student__in=my_children(self.request.user, self.get_school()))
        return qs

    def perform_create(self, serializer):
        access = self.get_access()
        student = serializer.validated_data["student"]
        if student.school_id != access.school.id or (
                not access.is_manager and not my_children(self.request.user, access.school).filter(id=student.id).exists()):
            raise ValidationError({"student": "Unknown student."})
        report = serializer.save(school=access.school, reported_by=self.request.user)
        from ..common import staff_users
        notify(access.school, staff_users(access.school), "absence_report",
               f"Absence reported: {student.full_name}",
               f"{report.date_from} to {report.date_to}: {report.reason}", link="/attendance")


def attendance_stats(school, students, start, end):
    """Per student: school days with a record, days absent, late count, absence rate."""
    per_day = school.attendance_mode == "day"
    qs = AttendanceRecord.objects.filter(student__in=students, date__gte=start, date__lte=end)
    if per_day:
        qs = qs.filter(period__isnull=True)
    stats = defaultdict(lambda: {"days": set(), "absent_days": set(), "late": 0, "excused": 0})
    for r in qs.values("student_id", "date", "status"):
        s = stats[r["student_id"]]
        s["days"].add(r["date"])
        if r["status"] == "absent":
            s["absent_days"].add(r["date"])
        elif r["status"] == "late":
            s["late"] += 1
        elif r["status"] == "excused":
            s["excused"] += 1
    out = {}
    for sid, s in stats.items():
        days = len(s["days"])
        absent = len(s["absent_days"])
        out[sid] = {"days": days, "absent": absent, "late": s["late"], "excused": s["excused"],
                    "absence_rate": round(100 * absent / days, 1) if days else 0.0}
    return out


class AttendanceReportView(APIView):
    """GET /schools/{id}/attendance/report/?kind=daily&date=  or  ?kind=monthly&month=YYYY-MM[&group=]"""
    permission_classes = [IsAuthenticated]

    def get(self, request, school_id):
        access = SchoolAccess(request, school_id, read_roles=STAFF, module="attendance")
        school = access.school
        kind = request.query_params.get("kind", "daily")
        students = Student.objects.filter(school=school, is_active=True).select_related("group")
        if request.query_params.get("group"):
            students = students.filter(group_id=request.query_params["group"])
        if kind == "daily":
            day = parse_date(request.query_params.get("date"), timezone.localdate())
            recs = AttendanceRecord.objects.filter(student__in=students, date=day).select_related("student__group", "period")
            groups = defaultdict(lambda: {"absent": [], "late": [], "taken": False})
            for r in recs:
                g = groups[r.student.group.name if r.student.group else "-"]
                g["taken"] = True
                if r.status in ("absent", "late"):
                    entry = {"student": r.student.full_name, "student_id": r.student_id,
                             "period": r.period.name if r.period else None}
                    g[r.status].append(entry)
            all_groups = sorted({s.group.name for s in students if s.group})
            return Response({"date": day, "groups": [
                {"group": name, **groups[name], "absent_count": len({x["student_id"] for x in groups[name]["absent"]})}
                for name in all_groups]})
        month = request.query_params.get("month") or timezone.localdate().strftime("%Y-%m")
        try:
            y, m = (int(x) for x in month.split("-"))
            start = date(y, m, 1)
        except ValueError:
            raise ValidationError({"month": "Use YYYY-MM."})
        end = (start.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
        stats = attendance_stats(school, students, start, end)
        threshold = school.absence_alert_threshold
        rows = []
        for s in students:
            st = stats.get(s.id, {"days": 0, "absent": 0, "late": 0, "excused": 0, "absence_rate": 0.0})
            rows.append({"student_id": s.id, "student": s.full_name, "group": s.group.name if s.group else "",
                         **st, "flagged": st["absence_rate"] > threshold})
        rows.sort(key=lambda r: (-r["absence_rate"], r["student"]))
        return Response({"month": month, "threshold": threshold, "students": rows,
                         "flagged": sum(1 for r in rows if r["flagged"])})
