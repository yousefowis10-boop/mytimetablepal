from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.decorators import action
from rest_framework.response import Response

from api.models import StudentGroup
from api.notify import notify

from ..common import SchoolModelViewSet, staff_users
from ..models import Applicant, Guardian, Student, StudentGuardian
from ..serializers import ApplicantSerializer, StudentSerializer


class ApplicantViewSet(SchoolModelViewSet):
    """Inquiry -> placement test -> documents -> accepted -> enrolled, with follow-up dates."""
    model = Applicant
    serializer_class = ApplicantSerializer
    module = "admissions"
    read_roles = ("admin", "staff")
    audit_model = True

    def get_queryset(self):
        qs = Applicant.objects.filter(school=self.get_school()).order_by("next_follow_up", "-created_at")
        p = self.request.query_params
        if p.get("stage"):
            qs = qs.filter(stage=p["stage"])
        if p.get("due") == "1":
            qs = qs.filter(next_follow_up__lte=timezone.localdate()).exclude(stage__in=("enrolled", "rejected"))
        return qs

    @action(detail=False, methods=["get"])
    def pipeline(self, request, school_id=None):
        qs = self.get_queryset()
        counts = {code: qs.filter(stage=code).count() for code, _ in Applicant.STAGES}
        overdue = qs.filter(next_follow_up__lt=timezone.localdate()).exclude(stage__in=("enrolled", "rejected")).count()
        return Response({"counts": counts, "overdue_follow_ups": overdue})

    @action(detail=True, methods=["post"])
    def enroll(self, request, pk=None, school_id=None):
        """POST {"group": id} - create the student and parent records from an accepted applicant."""
        a = self.get_object()
        if a.student_id:
            return Response({"error": "Already enrolled."}, status=400)
        group = get_object_or_404(StudentGroup, id=request.data.get("group"), school=a.school) \
            if request.data.get("group") else None
        if Student.objects.filter(school=a.school, is_active=True).count() >= a.school.max_students:
            return Response({"error": f"Your plan allows {a.school.max_students} students."}, status=400)
        first, _, last = a.child_name.partition(" ")
        with transaction.atomic():
            student = Student.objects.create(school=a.school, first_name=first, last_name=last, group=group,
                                             date_of_birth=a.date_of_birth)
            g = Guardian.objects.create(school=a.school, name=a.guardian_name, phone=a.guardian_phone,
                                        email=a.guardian_email)
            StudentGuardian.objects.create(student=student, guardian=g, is_primary=True)
            a.student, a.stage = student, "enrolled"
            a.save(update_fields=["student", "stage"])
        self.audit("update", a)
        return Response(StudentSerializer(student, context=self.get_serializer_context()).data, status=201)


def admissions_follow_ups():
    """Remind admin/staff about leads whose follow-up date has come (once per day per lead)."""
    today = timezone.localdate()
    due = Applicant.objects.filter(next_follow_up__lte=today).exclude(stage__in=("enrolled", "rejected")) \
        .exclude(follow_up_notified=today).select_related("school")
    by_school = {}
    for a in due:
        by_school.setdefault(a.school, []).append(a)
    for school, leads in by_school.items():
        if school.is_suspended or not school.has_module("admissions"):
            continue
        names = ", ".join(a.child_name for a in leads[:5]) + (" ..." if len(leads) > 5 else "")
        notify(school, staff_users(school), "admissions", f"{len(leads)} admission follow-up(s) due",
               names, link="/admissions")
        Applicant.objects.filter(id__in=[a.id for a in leads]).update(follow_up_notified=today)
