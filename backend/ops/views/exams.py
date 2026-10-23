from datetime import timedelta

from django.db import transaction
from rest_framework.decorators import action
from rest_framework.response import Response

from api.access import log
from api.scheduling.exams import ExamIn, ExamProblem, solve_exams

from ..common import SchoolModelViewSet, active_timetable
from ..models import Exam, ExamPeriod, ExamSitting
from ..serializers import ExamPeriodSerializer, ExamSerializer

STAFF = ("admin", "staff", "teacher")


class ExamPeriodViewSet(SchoolModelViewSet):
    model = ExamPeriod
    serializer_class = ExamPeriodSerializer
    read_roles = STAFF
    module = "exams"

    @action(detail=True, methods=["post"])
    def schedule(self, request, pk=None, school_id=None):
        """Build the exam timetable: dates/sessions, rooms and invigilators. Replaces the previous plan."""
        ep = self.get_object()
        school = ep.school
        week = set(school.week_day_list)
        slots = []
        d = ep.start_date
        while d <= ep.end_date:
            if d.isoweekday() in week:
                slots += [(d, i) for i in range(len(ep.sessions))]
            d += timedelta(days=1)
        exams = list(ep.exams.prefetch_related("groups").select_related("subject"))
        tt = active_timetable(school)
        groups = {}
        exam_inputs = []
        for e in exams:
            gids = tuple(sorted(g.id for g in e.groups.all()))
            for g in e.groups.all():
                groups[g.id] = (g.name, g.size)
            teachers = set(tt.entries.filter(subject=e.subject, student_group_id__in=gids)
                           .values_list("teacher_id", flat=True)) if tt else set()
            exam_inputs.append(ExamIn(e.id, f"{e.subject.name}", gids, frozenset(teachers)))
        rooms = [(r.id, r.name, r.capacity) for r in school.classrooms.exclude(room_type="gym")]
        teachers = [(t.id, t.name) for t in school.teachers.all()]
        result = solve_exams(ExamProblem(slots=slots, exams=exam_inputs, groups=groups, rooms=rooms,
                                         teachers=teachers, max_per_day=ep.max_exams_per_day))
        if result.status in ("optimal", "feasible"):
            with transaction.atomic():
                ExamSitting.objects.filter(exam__exam_period=ep).delete()
                for e in exams:
                    day, idx = result.placements[e.id]
                    e.date, e.session_index = day, idx
                    e.save(update_fields=["date", "session_index"])
                ExamSitting.objects.bulk_create([ExamSitting(exam_id=eid, group_id=g, room_id=r, invigilator_id=t)
                                                 for eid, g, r, t in result.sittings])
        ep.last_result = {"status": result.status, "reasons": result.reasons, "stats": result.stats}
        ep.save(update_fields=["last_result"])
        log(school, request.user, "generate", ep, summary=f"Exam schedule '{ep.name}': {result.status}")
        return Response({"result": ep.last_result,
                         "exams": ExamSerializer(ep.exams.all(), many=True, context={"school": school}).data})


class ExamViewSet(SchoolModelViewSet):
    model = Exam
    serializer_class = ExamSerializer
    read_roles = STAFF
    module = "exams"

    def get_queryset(self):
        qs = Exam.objects.filter(exam_period__school=self.get_school()).select_related("subject") \
            .prefetch_related("groups", "sittings__group", "sittings__room", "sittings__invigilator")
        if self.request.query_params.get("exam_period"):
            qs = qs.filter(exam_period_id=self.request.query_params["exam_period"])
        return qs.order_by("date", "session_index", "id")

    def perform_create(self, serializer):
        serializer.save()
