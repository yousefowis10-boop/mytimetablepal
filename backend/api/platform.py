"""
Multi-school platform: school sign-up, invitations / joining, "me", setup checklist and the owner panel.
"""
import secrets
from datetime import timedelta

from django.utils.translation import gettext as _
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.db import transaction
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny, BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from .access import SchoolAccess, log
from .models import (
    ALL_MODULES, MODULES, ROLES, Classroom, Invitation, Membership, Plan, School, SchedulePeriod,
    StudentGroup, Subject, SubjectRequirement, Teacher, Timetable, UserProfile,
)

User = get_user_model()


def tokens_for(user):
    refresh = RefreshToken.for_user(user)
    return {"access": str(refresh.access_token), "refresh": str(refresh)}


def create_school_for(user, data):
    """Create a school owned by `user`, make them its admin and start the 30-day trial."""
    with transaction.atomic():
        school = School(
            name=data["name"], address=data.get("address") or data.get("city") or "",
            established_year=data.get("established_year") or timezone.now().year,
            principal_name=data.get("principal_name") or "", user=user,
        )
        for field in ("city", "phone", "email", "week_days", "default_language", "currency"):
            if data.get(field):
                setattr(school, field, data[field])
        school.start_trial()
        school.save()
        Membership.objects.get_or_create(user=user, school=school, role="admin")
        log(school, user, "create", school, summary=f"School '{school.name}' signed up")
    return school


# ---------------------------------------------------------------- sign-up & me
class SchoolSignupSerializer(serializers.Serializer):
    school_name = serializers.CharField(max_length=200)
    city = serializers.CharField(max_length=100, required=False, allow_blank=True, default="Amman")
    phone = serializers.CharField(max_length=40, required=False, allow_blank=True, default="")
    first_name = serializers.CharField(max_length=150)
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True, default="")
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)
    language = serializers.ChoiceField(choices=["ar", "en"], required=False, default="ar")

    def validate_email(self, value):
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError(_("This email already has an account. Log in and add a school from there."))
        return value.lower()

    def validate_password(self, value):
        validate_password(value)
        return value


class SchoolSignupView(APIView):
    """POST /api/signup/school/ - any school can register itself; returns login tokens."""
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [AnonRateThrottle]

    def post(self, request):
        s = SchoolSignupSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        with transaction.atomic():
            user = User.objects.create_user(username=d["email"], email=d["email"], password=d["password"],
                                            first_name=d["first_name"], last_name=d["last_name"])
            UserProfile.objects.create(user=user, phone=d["phone"], language=d["language"])
            school = create_school_for(user, {"name": d["school_name"], "city": d["city"], "phone": d["phone"],
                                              "email": d["email"], "default_language": d["language"]})
        return Response({"school_id": school.id, **tokens_for(user)}, status=status.HTTP_201_CREATED)


def membership_payload(user):
    rows = (Membership.objects.filter(user=user, is_active=True).select_related("school", "school__plan")
            .order_by("school__name", "role"))
    schools = {}
    for m in rows:
        sch = m.school
        entry = schools.setdefault(sch.id, {
            "school_id": sch.id, "name": sch.name, "logo": sch.logo, "brand_color": sch.brand_color,
            "status": sch.status, "trial_ends_at": sch.trial_ends_at, "trial_expired": sch.trial_expired,
            "plan": sch.plan.name if sch.plan else None, "modules": sorted(sch.enabled_modules),
            "currency": sch.currency, "default_language": sch.default_language,
            "week_days": sch.week_day_list, "attendance_mode": sch.attendance_mode, "roles": [],
        })
        entry["roles"].append(m.role)
    return list(schools.values())


class MeView(APIView):
    """GET /api/me/ - who am I, which schools and roles (drives the school switcher). PATCH language/phone."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        u = request.user
        profile, _created = UserProfile.objects.get_or_create(user=u)
        return Response({
            "id": u.id, "email": u.email or u.username, "first_name": u.first_name, "last_name": u.last_name,
            "is_platform_owner": u.is_superuser, "language": profile.language, "phone": profile.phone,
            "email_notifications": profile.email_notifications, "push_notifications": profile.push_notifications,
            "schools": membership_payload(u),
        })

    def patch(self, request):
        profile, _created = UserProfile.objects.get_or_create(user=request.user)
        for field in ("language", "phone", "email_notifications", "push_notifications"):
            if field in request.data:
                setattr(profile, field, request.data[field])
        profile.save()
        for field in ("first_name", "last_name"):
            if field in request.data:
                setattr(request.user, field, str(request.data[field])[:150])
        request.user.save()
        return self.get(request)


# ---------------------------------------------------------------- invitations
class InvitationSerializer(serializers.ModelSerializer):
    teacher_name = serializers.CharField(source="teacher.name", read_only=True, default=None)
    accepted = serializers.SerializerMethodField()

    class Meta:
        model = Invitation
        fields = ["id", "role", "code", "email", "name", "teacher", "teacher_name", "guardian_id", "bus_id",
                  "created_at", "expires_at", "accepted", "accepted_at"]
        read_only_fields = ["code", "created_at", "expires_at", "accepted_at"]

    def get_accepted(self, obj):
        return obj.accepted_by_id is not None

    def validate(self, data):
        school = self.context["school"]
        role = data.get("role")
        teacher = data.get("teacher")
        if teacher and teacher.school_id != school.id:
            raise serializers.ValidationError(_("Unknown teacher."))
        if data.get("guardian_id"):
            from ops.models import Guardian
            if not Guardian.objects.filter(id=data["guardian_id"], school=school).exists():
                raise serializers.ValidationError(_("Unknown parent."))
        if data.get("bus_id"):
            from transport.models import Bus
            if not Bus.objects.filter(id=data["bus_id"], school=school).exists():
                raise serializers.ValidationError(_("Unknown bus."))
        if role == "admin" and not self.context["access"].has("admin"):
            raise serializers.ValidationError(_("Only admins can invite admins."))
        return data


def new_code():
    return secrets.token_urlsafe(9).replace("-", "").replace("_", "")[:10].upper()


class InvitationListView(APIView):
    """GET/POST /schools/{id}/invitations/ (admin, staff)."""
    permission_classes = [IsAuthenticated]

    def get(self, request, school_id):
        access = SchoolAccess(request, school_id, read_roles=("admin", "staff"), write_roles=("admin", "staff"))
        qs = Invitation.objects.filter(school=access.school).select_related("teacher").order_by("-created_at")
        return Response(InvitationSerializer(qs, many=True).data)

    def post(self, request, school_id):
        access = SchoolAccess(request, school_id, read_roles=("admin", "staff"), write_roles=("admin", "staff"))
        s = InvitationSerializer(data=request.data, context={"school": access.school, "access": access})
        s.is_valid(raise_exception=True)
        inv = s.save(school=access.school, created_by=request.user, code=new_code(),
                     expires_at=timezone.now() + timedelta(days=30))
        log(access.school, request.user, "create", inv, summary=f"Invitation for {inv.role} {inv.name or inv.email}")
        return Response(InvitationSerializer(inv).data, status=status.HTTP_201_CREATED)


class InvitationDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, school_id, pk):
        access = SchoolAccess(request, school_id, read_roles=("admin", "staff"), write_roles=("admin", "staff"))
        get_object_or_404(Invitation, id=pk, school=access.school).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class InvitationPreviewView(APIView):
    """GET /api/invitations/{code}/ - public: which school and role a join code is for."""
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [AnonRateThrottle]

    def get(self, request, code):
        inv = _valid_invitation(code)
        return Response({"school": inv.school.name, "logo": inv.school.logo, "role": inv.role, "name": inv.name,
                         "email": inv.email})


def _valid_invitation(code):
    inv = get_object_or_404(Invitation.objects.select_related("school"), code=str(code).strip().upper())
    if inv.accepted_by_id or inv.expires_at < timezone.now():
        raise serializers.ValidationError({"code": _("This code has already been used or has expired.")})
    if inv.school.is_suspended:
        raise serializers.ValidationError({"code": _("This school's account is suspended.")})
    return inv


def accept_invitation(inv, user):
    with transaction.atomic():
        Membership.objects.update_or_create(user=user, school=inv.school, role=inv.role,
                                            defaults={"is_active": True})
        if inv.teacher_id:
            Teacher.objects.filter(id=inv.teacher_id).update(user=user)
        if inv.guardian_id:
            from ops.models import Guardian
            Guardian.objects.filter(id=inv.guardian_id, school=inv.school).update(user=user)
        if inv.bus_id:
            from transport.models import Bus
            Bus.objects.filter(id=inv.bus_id, school=inv.school).update(driver=user)
        inv.accepted_by = user
        inv.accepted_at = timezone.now()
        inv.save(update_fields=["accepted_by", "accepted_at"])
        log(inv.school, user, "update", inv, summary=f"{user.username} joined as {inv.role}")


class InvitationAcceptView(APIView):
    """POST /api/invitations/accept/
    Logged in: {"code"} adds this school/role to the account (one person, several schools).
    Not logged in: {"code", "email", "password", "first_name", "last_name"} creates the account too.
    """
    permission_classes = [AllowAny]
    throttle_classes = [AnonRateThrottle]

    def post(self, request):
        inv = _valid_invitation(request.data.get("code", ""))
        user = request.user if request.user.is_authenticated else None
        if user is None:
            email = str(request.data.get("email", "")).strip().lower()
            password = request.data.get("password", "")
            if not email or not password:
                raise serializers.ValidationError({"email": _("Email and password are required to create an account.")})
            existing = User.objects.filter(username__iexact=email).first()
            if existing:
                if not existing.check_password(password):
                    raise serializers.ValidationError({"email": _("This email already has an account; the password does not match.")})
                user = existing
            else:
                validate_password(password)
                user = User.objects.create_user(username=email, email=email, password=password,
                                                first_name=str(request.data.get("first_name", ""))[:150],
                                                last_name=str(request.data.get("last_name", ""))[:150])
                UserProfile.objects.create(user=user, language=str(request.data.get("language", ""))[:5])
        accept_invitation(inv, user)
        return Response({"school_id": inv.school_id, "role": inv.role, **tokens_for(user)})


# ---------------------------------------------------------------- setup checklist
class SetupChecklistView(APIView):
    """GET /schools/{id}/setup/ - what a newly registered school still has to do."""
    permission_classes = [IsAuthenticated]

    def get(self, request, school_id):
        school = SchoolAccess(request, school_id, read_roles=("admin", "staff")).school
        from ops.models import Guardian, Student
        counts = {
            "periods": SchedulePeriod.objects.filter(schedule__school=school, type__in=("lecture", "lab")).count(),
            "subjects": Subject.objects.filter(school=school).count(),
            "classrooms": Classroom.objects.filter(school=school).count(),
            "teachers": Teacher.objects.filter(school=school).count(),
            "groups": StudentGroup.objects.filter(school=school).count(),
            "requirements": SubjectRequirement.objects.filter(student_group__school=school).count(),
            "students": Student.objects.filter(school=school, is_active=True).count(),
            "guardians": Guardian.objects.filter(school=school).count(),
            "parents_joined": Guardian.objects.filter(school=school, user__isnull=False).count(),
            "teachers_joined": Teacher.objects.filter(school=school, user__isnull=False).count(),
            "timetable_lessons": sum(t.entries.count() for t in Timetable.objects.filter(school=school, is_active=True)),
        }
        steps = [
            ("profile", bool(school.address and school.phone), "school"),
            ("schedule", counts["periods"] > 0, "schedules"),
            ("subjects", counts["subjects"] > 0, "subjects"),
            ("classrooms", counts["classrooms"] > 0, "classrooms"),
            ("teachers", counts["teachers"] > 0, "teachers"),
            ("groups", counts["groups"] > 0, "groups"),
            ("requirements", counts["requirements"] > 0, "groups"),
            ("students", counts["students"] > 0, "students"),
            ("parents", counts["parents_joined"] > 0, "invitations"),
            ("timetable", counts["timetable_lessons"] > 0, "timetables"),
        ]
        done = sum(1 for _key, ok, _page in steps if ok)
        return Response({"steps": [{"key": k, "done": ok, "page": page} for k, ok, page in steps],
                         "done": done, "total": len(steps), "counts": counts})


# ---------------------------------------------------------------- plans & owner panel
class IsPlatformOwner(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_superuser)


class PlanSerializer(serializers.ModelSerializer):
    class Meta:
        model = Plan
        fields = ["id", "code", "name", "max_students", "modules", "price_jod_month", "is_trial", "sort_order"]

    def validate_modules(self, value):
        unknown = set(value) - set(ALL_MODULES)
        if unknown:
            raise serializers.ValidationError(_("Unknown modules: %(modules)s") % {"modules": ", ".join(sorted(unknown))})
        return value


class PlansView(APIView):
    """GET /api/plans/ - public price list (for the sign-up page)."""
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"plans": PlanSerializer(Plan.objects.all(), many=True).data,
                         "modules": [{"key": k, "label": v} for k, v in MODULES]})


class OwnerPlanView(APIView):
    """PUT /api/platform/plans/{id}/ - owner edits limits, modules and price."""
    permission_classes = [IsPlatformOwner]

    def put(self, request, pk):
        plan = get_object_or_404(Plan, id=pk)
        s = PlanSerializer(plan, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)


class OwnerSchoolsView(APIView):
    """GET /api/platform/schools/ - every school with status, plan and totals. No children's data."""
    permission_classes = [IsPlatformOwner]

    def get(self, request):
        from ops.models import Student
        students = dict(Student.objects.filter(is_active=True).values("school").annotate(n=Count("id"))
                        .values_list("school", "n"))
        schools = (School.objects.select_related("plan")
                   .annotate(n_teachers=Count("teachers", distinct=True),
                             n_groups=Count("student_groups", distinct=True),
                             n_members=Count("memberships", filter=Q(memberships__is_active=True), distinct=True))
                   .order_by("-created_at"))
        rows = []
        for s in schools:
            admins = list(Membership.objects.filter(school=s, role="admin").values_list("user__email", flat=True)[:3])
            rows.append({
                "id": s.id, "name": s.name, "city": s.city, "status": s.status,
                "trial_ends_at": s.trial_ends_at, "trial_expired": s.trial_expired,
                "plan": s.plan.code if s.plan else None, "plan_name": s.plan.name if s.plan else None,
                "max_students": s.max_students, "students": students.get(s.id, 0), "teachers": s.n_teachers,
                "groups": s.n_groups, "members": s.n_members, "admins": admins, "created_at": s.created_at,
                "suspended_reason": s.suspended_reason,
            })
        totals = {
            "schools": len(rows), "students": sum(r["students"] for r in rows),
            "by_status": {k: sum(1 for r in rows if r["status"] == k) for k in ("trial", "active", "suspended")},
            "monthly_revenue_jod": float(sum((s.plan.price_jod_month if s.plan and s.status == "active" else 0)
                                             for s in schools)),
        }
        return Response({"schools": rows, "totals": totals})


class OwnerSchoolActionView(APIView):
    """POST /api/platform/schools/{id}/{action}/ with action in suspend | activate | set-plan | extend-trial."""
    permission_classes = [IsPlatformOwner]

    def post(self, request, pk, action):
        school = get_object_or_404(School, id=pk)
        if action == "suspend":
            school.status = "suspended"
            school.suspended_reason = str(request.data.get("reason", ""))[:300]
        elif action == "activate":
            school.status = "active"
            school.suspended_reason = ""
        elif action == "set-plan":
            school.plan = get_object_or_404(Plan, code=request.data.get("plan"))
            if school.plan.is_trial:
                school.start_trial(int(request.data.get("days", 30)))
            elif school.status != "suspended":
                school.status = "active"
        elif action == "extend-trial":
            days = max(1, min(365, int(request.data.get("days", 14))))
            base = max(school.trial_ends_at or timezone.now(), timezone.now())
            school.trial_ends_at = base + timedelta(days=days)
            school.status = "trial"
        else:
            return Response({"error": _("Unknown action.")}, status=status.HTTP_400_BAD_REQUEST)
        school.save()
        log(school, request.user, "update", school, summary=f"Platform owner: {action}")
        return Response({"id": school.id, "status": school.status, "plan": school.plan.code if school.plan else None,
                         "trial_ends_at": school.trial_ends_at})


ROLE_CODES = [r for r, _ in ROLES]
