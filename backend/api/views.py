from collections import Counter
import random

from django.contrib.auth import get_user_model
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import generics, viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    School, Teacher, Classroom, Schedule, SchedulePeriod, TeacherAvailablePeriod,
    Subject, StudentGroup, Timetable, TimetableEntry, Availability, SubjectRequirement
)
from .serializer import (
    RegisterSerializer,
    SchoolSerializer, TeacherSerializer, AvailabilitySerializer, ClassroomSerializer,
    SchedulePeriodSerializer, ScheduleSerializer, SubjectSerializer,
    StudentGroupSerializer, TimetableSerializer, TimetableEntrySerializer,
    SubjectRequirementSerializer,
)

User = get_user_model()


def get_user_school(user, school_id):
    """Return the school if it belongs to the user, otherwise 404 (never leak existence)."""
    return get_object_or_404(School, id=school_id, user=user)


class SchoolScopedMixin:
    """For viewsets nested under /schools/<school_id>/: every query is limited to a school the user owns."""

    def get_school(self):
        if not hasattr(self, "_school"):
            self._school = get_user_school(self.request.user, self.kwargs.get("school_id"))
        return self._school

    def get_serializer_context(self):
        context = super().get_serializer_context()
        if self.kwargs.get("school_id"):
            context["school"] = self.get_school()
        return context

    def perform_create(self, serializer):
        serializer.save(school=self.get_school())


# ============== AUTH ==============
class RegisterView(generics.CreateAPIView):
    serializer_class = RegisterSerializer
    authentication_classes = []
    permission_classes = [AllowAny]


class HealthView(APIView):
    """Unauthenticated liveness check used by the hosting platform."""
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"status": "ok"})


# ============== SCHOOL ==============
class SchoolViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = SchoolSerializer

    def get_queryset(self):
        return School.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


# ============== STUDENT GROUP ==============
class StudentGroupViewSet(SchoolScopedMixin, viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = StudentGroupSerializer

    def get_queryset(self):
        return StudentGroup.objects.filter(school=self.get_school()).select_related("classroom")

    @action(detail=True, methods=['get'])
    def requirements(self, request, pk=None, school_id=None):
        """GET /schools/{school_id}/groups/{id}/requirements/"""
        group = self.get_object()
        serializer = SubjectRequirementSerializer(group.subject_requirements.all(), many=True)
        return Response(serializer.data)


# ============== TEACHER ==============
class TeacherViewSet(SchoolScopedMixin, viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = TeacherSerializer

    def get_queryset(self):
        return Teacher.objects.filter(school=self.get_school()).prefetch_related("subjects")

    @action(detail=True, methods=['get', 'post'])
    def availability(self, request, pk=None, school_id=None):
        """GET/POST /schools/{school_id}/teachers/{id}/availability/"""
        teacher = self.get_object()

        if request.method == 'GET':
            serializer = AvailabilitySerializer(teacher.availabilities.all(), many=True)
            return Response(serializer.data)

        serializer = AvailabilitySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(teacher=teacher)
        return Response(
            {"message": "Availability slot created successfully", "data": serializer.data},
            status=status.HTTP_201_CREATED
        )

    @action(detail=True, methods=['put', 'patch', 'delete'], url_path=r'availability/(?P<availability_id>\d+)')
    def availability_detail(self, request, pk=None, school_id=None, availability_id=None):
        """PUT/PATCH/DELETE /schools/{school_id}/teachers/{id}/availability/{availability_id}/"""
        teacher = self.get_object()
        availability = get_object_or_404(Availability, pk=availability_id, teacher=teacher)

        if request.method == 'DELETE':
            availability.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        serializer = AvailabilitySerializer(availability, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(teacher=teacher)
        return Response({"message": "Availability updated successfully", "data": serializer.data})


# ============== CLASSROOM ==============
class ClassroomViewSet(SchoolScopedMixin, viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = ClassroomSerializer

    def get_queryset(self):
        return Classroom.objects.filter(school=self.get_school())


# ============== SCHEDULE ==============
class ScheduleViewSet(SchoolScopedMixin, viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = ScheduleSerializer

    def get_queryset(self):
        return Schedule.objects.filter(school=self.get_school()).prefetch_related("periods")

    @action(detail=True, methods=['get', 'post'])
    def periods(self, request, pk=None, school_id=None):
        """GET/POST /schools/{school_id}/schedules/{id}/periods/"""
        schedule = self.get_object()

        if request.method == 'GET':
            serializer = SchedulePeriodSerializer(schedule.periods.all().order_by('order'), many=True)
            return Response(serializer.data)

        serializer = SchedulePeriodSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(schedule=schedule)
        return Response(
            {"message": "Period created successfully", "data": serializer.data},
            status=status.HTTP_201_CREATED
        )

    @action(detail=True, methods=['put', 'delete'], url_path=r'periods/(?P<period_id>\d+)')
    def period_detail(self, request, pk=None, school_id=None, period_id=None):
        """PUT/DELETE /schools/{school_id}/schedules/{id}/periods/{period_id}/"""
        schedule = self.get_object()
        period = get_object_or_404(SchedulePeriod, pk=period_id, schedule=schedule)

        if request.method == 'DELETE':
            period.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        serializer = SchedulePeriodSerializer(period, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(schedule=schedule)
        return Response({"message": "Period updated successfully", "data": serializer.data})


# ============== SUBJECT ==============
class SubjectViewSet(SchoolScopedMixin, viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = SubjectSerializer

    def get_queryset(self):
        return Subject.objects.filter(school=self.get_school())


# ============== TIMETABLE ==============
class TimetableViewSet(SchoolScopedMixin, viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = TimetableSerializer

    def get_queryset(self):
        return Timetable.objects.filter(school=self.get_school())

    @action(detail=True, methods=['get'])
    def entries(self, request, pk=None, school_id=None):
        """GET /schools/{school_id}/timetables/{id}/entries/"""
        timetable = self.get_object()
        entries = timetable.entries.select_related("teacher", "subject", "classroom", "period")
        return Response(TimetableEntrySerializer(entries, many=True).data)

    @action(detail=True, methods=['post'])
    def bulk_update_entries(self, request, pk=None, school_id=None):
        """POST /schools/{school_id}/timetables/{id}/bulk_update_entries/"""
        timetable = self.get_object()
        entries_data = request.data.get("entries", [])

        if not isinstance(entries_data, list):
            return Response({"error": "Entries must be a list."}, status=status.HTTP_400_BAD_REQUEST)

        serializer = TimetableEntrySerializer(
            data=entries_data,
            many=True,
            context={"timetable": timetable, "school": timetable.school}
        )
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            timetable.entries.all().delete()
            serializer.save()
        return Response({"message": "Timetable entries updated successfully."},
                        status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def generate(self, request, pk=None, school_id=None):
        """POST /schools/{school_id}/timetables/{id}/generate/"""
        return generate_timetable(self.get_object())

    @action(detail=True, methods=['get'])
    def json_view(self, request, pk=None, school_id=None):
        """GET /schools/{school_id}/timetables/{id}/json_view/?type=grade|teacher|room"""
        return Response(build_timetable_pages(self.get_object(), request.GET.get("type", "grade")))


# ============== SUBJECT REQUIREMENT ==============
class SubjectRequirementViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = SubjectRequirementSerializer

    def get_group(self):
        if not hasattr(self, "_group"):
            self._group = get_object_or_404(
                StudentGroup, id=self.kwargs.get('student_group_id'), school__user=self.request.user
            )
        return self._group

    def get_queryset(self):
        return SubjectRequirement.objects.filter(student_group=self.get_group()).select_related("subject")

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["school"] = self.get_group().school
        return context

    def perform_create(self, serializer):
        serializer.save(student_group=self.get_group())

    def perform_update(self, serializer):
        serializer.save(student_group=self.get_group())


# ============== TEACHER AVAILABILITY PERIOD ==============
class TeacherAvailabilityPeriodAPI(APIView):
    """Which teachers are available in a given schedule period."""
    permission_classes = [IsAuthenticated]

    def get_period(self, request, period_id):
        return get_object_or_404(
            SchedulePeriod.objects.select_related("schedule"),
            id=period_id, schedule__school__user=request.user
        )

    def get(self, request, period_id):
        """GET /periods/{period_id}/teacher_availability/"""
        period = self.get_period(request, period_id)
        teachers = Teacher.objects.filter(school_id=period.schedule.school_id)
        available_teacher_ids = set(
            TeacherAvailablePeriod.objects.filter(period=period).values_list("teacher_id", flat=True)
        )
        return Response([
            {"id": t.id, "name": t.name, "available": t.id in available_teacher_ids}
            for t in teachers
        ])

    def post(self, request, period_id):
        """POST /periods/{period_id}/teacher_availability/  body: {"teachers": [ids]}"""
        period = self.get_period(request, period_id)
        teacher_ids = request.data.get("teachers", [])
        if not isinstance(teacher_ids, list):
            return Response({"error": "teachers must be a list of ids."}, status=status.HTTP_400_BAD_REQUEST)

        teachers = list(Teacher.objects.filter(school_id=period.schedule.school_id, id__in=teacher_ids))
        if len(teachers) != len(set(teacher_ids)):
            return Response({"error": "Unknown teacher id for this school."}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            TeacherAvailablePeriod.objects.filter(period=period).delete()
            TeacherAvailablePeriod.objects.bulk_create(
                [TeacherAvailablePeriod(teacher=t, period=period) for t in teachers]
            )
        return Response({"message": "Availability updated!"})


# ============== TIMETABLE SPECIAL VIEWS ==============
DISPLAY_DAYS = [7, 1, 2, 3, 4]  # Sunday..Thursday


def build_timetable_pages(timetable, view_type):
    """One page per group / teacher / room, each a grid of periods x days."""
    periods = list(timetable.schedule.periods.all())
    entries = list(timetable.entries.select_related(
        "teacher", "covering_teacher", "subject", "classroom", "student_group"
    ))

    if view_type == "teacher":
        key, title, extra = "teacher", "Teacher", "student_group"
    elif view_type == "room":
        key, title, extra = "classroom", "Room", "student_group"
    else:
        key, title, extra = "student_group", "Grade", "teacher"

    grid = {}
    owners = {}
    for e in entries:
        owner = getattr(e, key)
        owners[owner.id] = owner
        grid[(owner.id, e.day_of_week, e.period_id)] = e

    pages = []
    for owner in sorted(owners.values(), key=lambda o: o.name):
        page = {"title": f"{title}: {owner.name}", "periods": []}
        for p in periods:
            row = {"period": p.name, "days": []}
            for day in DISPLAY_DAYS:
                e = grid.get((owner.id, day, p.id))
                cell = {
                    "day": day,
                    "subject": e.subject.name if e else "",
                    "covering_teacher": e.covering_teacher.name if e and e.covering_teacher else "",
                }
                if view_type == "room":
                    cell["teacher"] = e.teacher.name if e else ""
                    cell["student_group"] = e.student_group.name if e else ""
                elif view_type == "teacher":
                    cell["student_group"] = e.student_group.name if e else ""
                    cell["classroom"] = e.classroom.name if e else ""
                else:
                    cell["teacher"] = e.teacher.name if e else ""
                    cell["classroom"] = e.classroom.name if e else ""
                row["days"].append(cell)
            page["periods"].append(row)
        pages.append(page)
    return {"pages": pages}


class TimetableJSONView(APIView):
    """GET /timetables/{id}/json/?type=grade|teacher|room (used by the PDF export)."""
    permission_classes = [IsAuthenticated]

    def get(self, request, timetable_id):
        timetable = get_object_or_404(Timetable, id=timetable_id, school__user=request.user)
        return Response(build_timetable_pages(timetable, request.GET.get("type", "grade")))


class TimetableSolver:
    """Heuristic generator (to be replaced by the OR-Tools solver in api/scheduling)."""

    def __init__(self, groups, periods, classrooms, days, requirements):
        self.groups = groups
        self.periods = sorted(periods, key=lambda x: x.id)
        self.classrooms = classrooms
        self.days = days
        self.requirements = requirements
        self.home_rooms = {g.id: classrooms[i % len(classrooms)] for i, g in enumerate(groups)}
        self.timetable = []

    def solve(self):
        for group in self.groups:
            group_tasks = [r for r in self.requirements if r[0].id == group.id]
            day_buckets = {d: [] for d in self.days}

            group_tasks.sort(key=lambda x: Counter([r[1].id for r in group_tasks])[x[1].id], reverse=True)
            for i, task in enumerate(group_tasks):
                target_day = self.days[i % len(self.days)]
                day_buckets[target_day].append(list(task))

            for day in self.days:
                for p_idx, task_data in enumerate(day_buckets[day]):
                    if p_idx >= len(self.periods):
                        break

                    sub = task_data[1]
                    name = sub.name.lower()

                    pe_keys = ['pe', 'sport', 'field', 'gym', 'pitch', 'court']
                    lab_keys = ['science', 'lab', 'chem', 'phys', 'bio', 'ict']

                    if any(k in name for k in pe_keys):
                        special_rooms = [r for r in self.classrooms if any(k in r.name.lower() for k in pe_keys)]
                        room = random.choice(special_rooms) if special_rooms else self.classrooms[-1]
                    elif any(k in name for k in lab_keys):
                        special_rooms = [r for r in self.classrooms if any(k in r.name.lower() for k in lab_keys)]
                        room = random.choice(special_rooms) if special_rooms else self.classrooms[-1]
                    else:
                        room = self.home_rooms[group.id]

                    self.timetable.append({
                        'group': group, 'subject': sub,
                        'teacher': random.choice(task_data[2]),
                        'room': room, 'period': self.periods[p_idx], 'day': day
                    })

        for _ in range(200):
            clashes = 0
            teacher_usage = {}
            for i, entry in enumerate(self.timetable):
                key = (entry['teacher'].id, entry['period'].id, entry['day'])
                if key in teacher_usage:
                    clashes += 1
                    self._swap_to_resolve(i)
                else:
                    teacher_usage[key] = i
            if clashes == 0:
                break
        return self.timetable

    def _swap_to_resolve(self, entry_idx):
        target = self.timetable[entry_idx]
        candidates = [
            i for i, e in enumerate(self.timetable)
            if e['group'].id == target['group'].id and e['day'] == target['day'] and i != entry_idx
        ]
        if candidates:
            swap_idx = random.choice(candidates)
            self.timetable[entry_idx]['period'], self.timetable[swap_idx]['period'] = \
                self.timetable[swap_idx]['period'], self.timetable[entry_idx]['period']


def generate_timetable(timetable):
    school = timetable.school
    groups = list(StudentGroup.objects.filter(school=school))
    periods = list(SchedulePeriod.objects.filter(
        schedule=timetable.schedule, type__in=['lecture', 'lab']
    ).order_by('order'))
    classrooms = list(Classroom.objects.filter(school=school))

    if not periods or not classrooms:
        return Response({"error": "The schedule needs lecture periods and the school needs classrooms."}, status=400)

    needed_tasks = []
    for group in groups:
        for req in SubjectRequirement.objects.filter(student_group=group).select_related("subject"):
            pool = list(Teacher.objects.filter(school=school, subjects=req.subject))
            if not pool:
                pool = list(Teacher.objects.filter(school=school))
            if not pool:
                return Response({"error": "The school has no teachers."}, status=400)
            for _ in range(req.lectures_per_week):
                needed_tasks.append((group, req.subject, pool))

    if not needed_tasks:
        return Response({"error": "No requirements found for this school/timetable."}, status=400)

    final_entries_data = TimetableSolver(groups, periods, classrooms, DISPLAY_DAYS, needed_tasks).solve()

    with transaction.atomic():
        TimetableEntry.objects.filter(timetable=timetable).delete()
        bulk_list = [
            TimetableEntry(
                timetable=timetable,
                student_group=e['group'],
                subject=e['subject'],
                teacher=e['teacher'],
                classroom=e['room'],
                period=e['period'],
                day_of_week=e['day']
            ) for e in final_entries_data
        ]
        TimetableEntry.objects.bulk_create(bulk_list)

    return Response({"status": "ok", "message": f"Successfully generated {len(bulk_list)} entries."})


class GenerateTimetableEntriesAPIView(APIView):
    """POST /timetables/{id}/generate/"""
    permission_classes = [IsAuthenticated]

    def post(self, request, timetable_id):
        timetable = get_object_or_404(
            Timetable.objects.select_related('schedule', 'school'),
            id=timetable_id, school__user=request.user
        )
        return generate_timetable(timetable)
