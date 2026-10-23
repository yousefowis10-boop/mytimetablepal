from django.utils.translation import gettext as _
from django.db.models import Q
from rest_framework.decorators import action
from rest_framework.response import Response

from ..common import MANAGERS, SchoolModelViewSet
from ..models import Guardian, Student
from ..serializers import GuardianSerializer, StudentSerializer


class StudentViewSet(SchoolModelViewSet):
    """Staff see all students of their school; parents use /my/children/ instead."""
    model = Student
    serializer_class = StudentSerializer
    audit_model = True

    def get_queryset(self):
        qs = (Student.objects.filter(school=self.get_school()).select_related("group")
              .prefetch_related("studentguardian_set__guardian"))
        p = self.request.query_params
        if p.get("group"):
            qs = qs.filter(group_id=p["group"])
        if p.get("grade"):
            qs = qs.filter(group__grade_level=p["grade"])
        if p.get("active", "1") == "1":
            qs = qs.filter(is_active=True)
        if p.get("bus") == "1":
            qs = qs.filter(Q(uses_bus_morning=True) | Q(uses_bus_afternoon=True))
        if p.get("q"):
            q = p["q"]
            qs = qs.filter(Q(first_name__icontains=q) | Q(last_name__icontains=q) | Q(student_number__icontains=q))
        return qs.order_by("group__name", "first_name", "last_name")

    @action(detail=False, methods=["post"])
    def move(self, request, school_id=None):
        """POST {"student_ids": [...], "group": id|null} - move several students to a class group."""
        school = self.get_school()
        ids = request.data.get("student_ids") or []
        group_id = request.data.get("group")
        if group_id and not school.student_groups.filter(id=group_id).exists():
            return Response({"error": _("Unknown group.")}, status=400)
        n = Student.objects.filter(school=school, id__in=ids).update(group_id=group_id)
        return Response({"moved": n})


class GuardianViewSet(SchoolModelViewSet):
    model = Guardian
    serializer_class = GuardianSerializer
    read_roles = MANAGERS + ("teacher",)

    def get_queryset(self):
        qs = Guardian.objects.filter(school=self.get_school()).prefetch_related("students").order_by("name")
        q = self.request.query_params.get("q")
        if q:
            qs = qs.filter(Q(name__icontains=q) | Q(phone__icontains=q) | Q(email__icontains=q))
        return qs
