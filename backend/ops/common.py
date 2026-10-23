"""Helpers shared by the operations modules."""
from datetime import date, timedelta

from django.contrib.auth.models import User
from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated

from api.access import SchoolScopedMixin
from api.models import Membership, STAFF_ROLES, Teacher, Timetable

ALL_ROLES = ("admin", "staff", "teacher", "parent", "driver")
MANAGERS = ("admin", "staff")


class SchoolModelViewSet(SchoolScopedMixin, viewsets.ModelViewSet):
    """CRUD for a model with a `school` FK, scoped to the URL's school."""
    permission_classes = [IsAuthenticated]
    model = None
    write_roles = MANAGERS

    def get_queryset(self):
        return self.model.objects.filter(school=self.get_school())


def my_children(user, school):
    from .models import Student
    return Student.objects.filter(school=school, guardians__user=user, is_active=True).distinct()


def teacher_for(user, school):
    return Teacher.objects.filter(school=school, user=user).first()


def active_timetable(school):
    return (Timetable.objects.filter(school=school, is_active=True).order_by("-id").first()
            or Timetable.objects.filter(school=school).order_by("-id").first())


def weekday_code(d):
    """Python weekday (Mon=0) -> TimetableEntry day code (Mon=1 ... Sun=7)."""
    return d.isoweekday()


def week_bounds(d=None):
    """Sunday-based school week containing d."""
    d = d or date.today()
    start = d - timedelta(days=(d.isoweekday() % 7))
    return start, start + timedelta(days=6)


def members(school, *roles):
    return User.objects.filter(memberships__school=school, memberships__role__in=roles,
                               memberships__is_active=True).distinct()


def staff_users(school):
    return members(school, *MANAGERS)


def guardian_users(students):
    return User.objects.filter(guardian_profiles__students__in=students).distinct()


def parse_date(value, default=None):
    if not value:
        return default
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        from rest_framework.exceptions import ValidationError
        raise ValidationError({"date": "Use the format YYYY-MM-DD."})


def is_staff_member(access):
    return access.has(*STAFF_ROLES)


def member_roles(user, school):
    return set(Membership.objects.filter(user=user, school=school, is_active=True).values_list("role", flat=True))
