"""
Tenant access control. Every school-scoped endpoint goes through here.

Rules:
- A user only reaches a school they have an active Membership in. Anyone else gets 404, so other schools'
  existence and ids never leak. The platform owner (superuser) gets no school data at all - only totals
  through the owner panel.
- Each view declares which roles may read and which may write.
- Suspended schools are read-blocked; schools whose trial ended are read-only until a plan is active.
- Plan modules switch whole features on and off.
"""
from django.utils.translation import gettext as _
from django.shortcuts import get_object_or_404
from rest_framework import permissions
from rest_framework.exceptions import NotFound, PermissionDenied

from .models import STAFF_ROLES, AuditLog, Membership, School

SAFE = permissions.SAFE_METHODS


def roles_for(user, school):
    if not user or not user.is_authenticated:
        return set()
    cache = getattr(user, "_school_roles", None)
    if cache is None:
        cache = user._school_roles = {}
    if school.id not in cache:
        cache[school.id] = set(Membership.objects.filter(user=user, school=school, is_active=True)
                               .values_list("role", flat=True))
    return cache[school.id]


class SchoolAccess:
    """Resolved access of one request to one school."""

    def __init__(self, request, school_id, read_roles=STAFF_ROLES, write_roles=("admin",), module=None):
        self.request = request
        self.school = get_object_or_404(School.objects.select_related("plan"), id=school_id)
        self.roles = roles_for(request.user, self.school)
        if not self.roles:
            raise NotFound()
        if self.school.is_suspended:
            raise PermissionDenied(_("This school's account is suspended. Please contact support."))
        writing = request.method not in SAFE
        if writing and self.school.trial_expired:
            raise PermissionDenied(_("The free trial has ended. Choose a plan to keep making changes."))
        if module and not self.school.has_module(module):
            raise PermissionDenied(_("This feature is not part of your school's plan."))
        allowed = write_roles if writing else read_roles
        if not (self.roles & set(allowed)):
            raise PermissionDenied(_("Your role does not allow this."))

    def has(self, *roles):
        return bool(self.roles & set(roles))

    @property
    def is_staff(self):
        return self.has(*STAFF_ROLES)

    @property
    def is_manager(self):
        return self.has("admin", "staff")


class SchoolScopedMixin:
    """For views nested under /schools/<school_id>/.

    Subclasses set read_roles / write_roles / module; get_queryset must filter by self.get_school().
    """
    read_roles = STAFF_ROLES
    write_roles = ("admin",)
    module = None
    audit_model = None   # set to log create/update/delete in the audit log

    def get_access(self):
        if not hasattr(self, "_access"):
            read, write = self.roles_for_action()
            self._access = SchoolAccess(self.request, self.kwargs.get("school_id"), read, write, self.module)
        return self._access

    def roles_for_action(self):
        return self.read_roles, self.write_roles

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if self.kwargs.get("school_id") is not None:
            self.get_access()

    def get_school(self):
        return self.get_access().school

    def get_serializer_context(self):
        context = super().get_serializer_context()
        if self.kwargs.get("school_id") is not None:
            context["school"] = self.get_school()
            context["access"] = self.get_access()
        return context

    def perform_create(self, serializer):
        obj = serializer.save(school=self.get_school())
        self.audit("create", obj)

    def perform_update(self, serializer):
        before = _snapshot(serializer.instance) if self.audit_model else None
        obj = serializer.save()
        self.audit("update", obj, before)

    def perform_destroy(self, instance):
        self.audit("delete", instance)
        instance.delete()

    def audit(self, action, obj, before=None):
        if not self.audit_model:
            return
        log(self.get_school(), self.request.user, action, obj, before=before)


def _snapshot(obj):
    data = {}
    for f in obj._meta.concrete_fields:
        value = getattr(obj, f.attname)
        data[f.name] = value if isinstance(value, (int, float, str, bool, type(None))) else str(value)
    return data


def log(school, user, action, obj=None, summary="", before=None, model=None, object_id=""):
    changes = {}
    if obj is not None and before is not None:
        after = _snapshot(obj)
        changes = {k: [before.get(k), v] for k, v in after.items() if before.get(k) != v}
        if not changes and action == "update":
            return
    elif obj is not None and action in ("create", "delete"):
        changes = _snapshot(obj)
    AuditLog.objects.create(
        school=school, user=user if user and user.is_authenticated else None, action=action,
        model=model or (obj._meta.label if obj is not None else ""),
        object_id=object_id or (str(obj.pk) if obj is not None else ""),
        summary=(summary or (str(obj) if obj is not None else ""))[:300], changes=changes,
    )


def school_access(request, school_id, read_roles=STAFF_ROLES, write_roles=("admin",), module=None):
    return SchoolAccess(request, school_id, read_roles, write_roles, module)


def member_school_or_404(user, **lookup):
    """For legacy flat URLs (e.g. /timetables/<id>/json/): find the object's school and require membership."""
    return lookup
