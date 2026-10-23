from collections import Counter

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.access import SchoolAccess, log
from api.models import Teacher, TeacherAvailablePeriod, TimetableEntry
from api.notify import notify

from ..common import MANAGERS, SchoolModelViewSet, active_timetable, parse_date, teacher_for, week_bounds
from ..models import CoverAssignment, TeacherAbsence
from ..serializers import CoverSerializer, TeacherAbsenceSerializer

STAFF = ("admin", "staff", "teacher")


def affected_entries(absence):
    tt = active_timetable(absence.school)
    if not tt:
        return []
    qs = tt.entries.filter(teacher=absence.teacher, day_of_week=absence.date.isoweekday()) \
        .select_related("period", "student_group", "subject", "classroom")
    if absence.period_ids:
        qs = qs.filter(period_id__in=absence.period_ids)
    return list(qs.order_by("period__order"))


def absent_teacher_ids(school, day, period_id):
    ids = set()
    for a in TeacherAbsence.objects.filter(school=school, date=day):
        if not a.period_ids or period_id in a.period_ids:
            ids.add(a.teacher_id)
    return ids


def suggest_substitutes(entry, day, limit=5):
    """Rank teachers for covering `entry` on `day`.

    Must be: not absent, not teaching or covering in that period, available in that period (if availability is
    configured). Preference: qualified for the subject, then fewest covers this week, then lightest day.
    """
    school = entry.timetable.school
    tt = entry.timetable
    weekday, period_id = day.isoweekday(), entry.period_id
    busy = set(tt.entries.filter(day_of_week=weekday, period_id=period_id).values_list("teacher_id", flat=True))
    busy |= set(CoverAssignment.objects.filter(date=day, entry__period_id=period_id)
                .values_list("covering_teacher_id", flat=True))
    # A teacher whose own lesson is being covered by someone else is free.
    busy -= set(CoverAssignment.objects.filter(date=day, entry__period_id=period_id)
                .values_list("entry__teacher_id", flat=True))
    busy |= absent_teacher_ids(school, day, period_id)
    avail = {}
    for row in TeacherAvailablePeriod.objects.filter(teacher__school=school, period__schedule=tt.schedule):
        avail.setdefault(row.teacher_id, set()).add(row.period_id)
    start, end = week_bounds(day)
    covers_week = Counter(CoverAssignment.objects.filter(school=school, date__gte=start, date__lte=end)
                          .values_list("covering_teacher_id", flat=True))
    lessons_today = Counter(tt.entries.filter(day_of_week=weekday).values_list("teacher_id", flat=True))
    out = []
    for t in Teacher.objects.filter(school=school).prefetch_related("subjects"):
        if t.id in busy or t.id == entry.teacher_id:
            continue
        if t.id in avail and period_id not in avail[t.id]:
            continue
        qualified = any(s.id == entry.subject_id for s in t.subjects.all())
        score = (10 if qualified else 0) - 2 * covers_week[t.id] - lessons_today[t.id] * 0.5
        reasons = ["free this period"]
        reasons.append("teaches this subject" if qualified else "not a subject specialist")
        reasons.append(f"{covers_week[t.id]} cover(s) this week, {lessons_today[t.id]} lesson(s) today")
        out.append({"teacher_id": t.id, "name": t.name, "qualified": qualified, "score": score,
                    "covers_this_week": covers_week[t.id], "lessons_today": lessons_today[t.id],
                    "reasons": reasons})
    out.sort(key=lambda r: (-r["score"], r["name"]))
    return out[:limit]


class TeacherAbsenceViewSet(SchoolModelViewSet):
    """Admin/staff mark any teacher absent; a teacher can mark themselves absent."""
    model = TeacherAbsence
    serializer_class = TeacherAbsenceSerializer
    read_roles = STAFF
    write_roles = STAFF
    module = "substitutes"
    audit_model = True

    def get_queryset(self):
        qs = TeacherAbsence.objects.filter(school=self.get_school()).select_related("teacher")
        if not self.get_access().is_manager:
            qs = qs.filter(teacher__user=self.request.user)
        if self.request.query_params.get("date"):
            qs = qs.filter(date=self.request.query_params["date"])
        return qs

    def perform_create(self, serializer):
        access = self.get_access()
        if not access.is_manager:
            me = teacher_for(self.request.user, access.school)
            if not me or serializer.validated_data["teacher"].id != me.id:
                raise PermissionDenied("Teachers can only report their own absence.")
        absence = serializer.save(school=access.school, created_by=self.request.user)
        self.audit("create", absence)
        from ..common import staff_users
        lessons = affected_entries(absence)
        notify(access.school, staff_users(access.school), "teacher_absence",
               f"{absence.teacher.name} is absent on {absence.date}",
               f"{len(lessons)} lesson(s) need a cover.", link="/substitutes")

    def retrieve(self, request, *args, **kwargs):
        absence = self.get_object()
        data = TeacherAbsenceSerializer(absence).data
        covers = {c.entry_id: c for c in absence.covers.select_related("covering_teacher")}
        data["lessons"] = [{
            "entry": e.id, "period": e.period.name, "period_id": e.period_id, "group": e.student_group.name,
            "subject": e.subject.name, "room": e.classroom.name,
            "cover": {"id": covers[e.id].id, "teacher": covers[e.id].covering_teacher.name} if e.id in covers else None,
            "suggestions": [] if e.id in covers else suggest_substitutes(e, absence.date),
        } for e in affected_entries(absence)]
        return Response(data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None, school_id=None):
        """POST {"entry": id, "teacher": id} - one-click approval of a substitute."""
        access = self.get_access()
        if not access.is_manager:
            raise PermissionDenied("Only admin or staff approve covers.")
        absence = self.get_object()
        entry = get_object_or_404(TimetableEntry, id=request.data.get("entry"), timetable__school=access.school)
        if entry.id not in {e.id for e in affected_entries(absence)}:
            raise ValidationError({"entry": "This lesson is not affected by the absence."})
        teacher = get_object_or_404(Teacher, id=request.data.get("teacher"), school=access.school)
        if teacher.id not in {s["teacher_id"] for s in suggest_substitutes(entry, absence.date, limit=1000)}:
            raise ValidationError({"teacher": f"{teacher.name} is not free in this period."})
        with transaction.atomic():
            cover, _ = CoverAssignment.objects.update_or_create(
                entry=entry, date=absence.date,
                defaults={"school": access.school, "absence": absence, "covering_teacher": teacher,
                          "approved_by": request.user})
            # Show it in the timetable for this week (cleared automatically after the date).
            entry.covering_teacher = teacher
            entry.save(update_fields=["covering_teacher"])
        log(access.school, request.user, "update", entry,
            summary=f"Cover {absence.date}: {teacher.name} for {entry}")
        if teacher.user_id:
            notify(access.school, [teacher.user], "cover", f"Cover on {absence.date:%A %d %B}",
                   f"{entry.period.name}: {entry.subject.name} with {entry.student_group.name} in {entry.classroom.name} "
                   f"(for {absence.teacher.name}).", link="/today")
        return Response(CoverSerializer(cover).data, status=201)

    @action(detail=True, methods=["post"], url_path="unassign")
    def unassign(self, request, pk=None, school_id=None):
        absence = self.get_object()
        cover = get_object_or_404(CoverAssignment, absence=absence, entry_id=request.data.get("entry"))
        TimetableEntry.objects.filter(id=cover.entry_id, covering_teacher=cover.covering_teacher).update(covering_teacher=None)
        cover.delete()
        return Response(status=204)


class CoverLoadView(APIView):
    """GET /schools/{id}/covers/?from=&to= - covers in a range and cover load per teacher."""
    permission_classes = [IsAuthenticated]

    def get(self, request, school_id):
        access = SchoolAccess(request, school_id, read_roles=STAFF, module="substitutes")
        start, end = week_bounds(timezone.localdate())
        start = parse_date(request.query_params.get("from"), start)
        end = parse_date(request.query_params.get("to"), end)
        covers = CoverAssignment.objects.filter(school=access.school, date__gte=start, date__lte=end) \
            .select_related("covering_teacher", "entry__student_group", "entry__subject", "entry__period",
                            "absence__teacher").order_by("date", "entry__period__order")
        if not access.is_manager:
            covers = covers.filter(covering_teacher__user=request.user)
        load = Counter(c.covering_teacher.name for c in covers)
        return Response({"from": start, "to": end, "covers": CoverSerializer(covers, many=True).data,
                         "load": [{"teacher": k, "covers": v} for k, v in load.most_common()]})


def clear_past_covers():
    """Covering teacher on a timetable entry is only meant for the week of the cover."""
    today = timezone.localdate()
    for c in CoverAssignment.objects.filter(date__lt=today).select_related("entry"):
        if c.entry.covering_teacher_id == c.covering_teacher_id and not CoverAssignment.objects.filter(
                entry=c.entry, date__gte=today).exists():
            TimetableEntry.objects.filter(id=c.entry_id).update(covering_teacher=None)
