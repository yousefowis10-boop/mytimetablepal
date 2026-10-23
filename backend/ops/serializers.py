from decimal import Decimal

from django.utils.translation import gettext as _
from django.db import transaction
from rest_framework import serializers

from api.models import Classroom, StudentGroup, Subject, Teacher
from api.serializer import SchoolScopedRelatedField

from .models import (
    FAQ, Announcement, Applicant, Assessment, CalendarEvent, Exam, ExamPeriod, ExamSitting, FeePlan, Guardian,
    Homework, Installment, Message, MessageThread, Payment, PickupNotice, Student, StudentFee, StudentGuardian,
    TeacherAbsence, Term, AbsenceReport, CoverAssignment,
)


# ---------------------------------------------------------------- people
class GuardianSerializer(serializers.ModelSerializer):
    joined = serializers.SerializerMethodField()
    children = serializers.SerializerMethodField()

    class Meta:
        model = Guardian
        fields = ["id", "name", "phone", "email", "relation", "joined", "children"]

    def get_joined(self, obj):
        return obj.user_id is not None

    def get_children(self, obj):
        return [{"id": s.id, "name": s.full_name} for s in obj.students.all()]


class StudentGuardianInput(serializers.Serializer):
    id = serializers.IntegerField(required=False)
    name = serializers.CharField(required=False, allow_blank=True)
    phone = serializers.CharField(required=False, allow_blank=True, default="")
    email = serializers.EmailField(required=False, allow_blank=True, default="")
    relation = serializers.CharField(required=False, allow_blank=True, default="")
    is_primary = serializers.BooleanField(required=False, default=False)
    can_pickup = serializers.BooleanField(required=False, default=True)


PRIVATE_FIELDS = ("medical_notes", "allergies")
LOCATION_FIELDS = ("home_address", "home_lat", "home_lng")


class StudentSerializer(serializers.ModelSerializer):
    group = SchoolScopedRelatedField(queryset=StudentGroup.objects.all(), required=False, allow_null=True)
    group_name = serializers.CharField(source="group.name", read_only=True, default=None)
    full_name = serializers.CharField(read_only=True)
    guardians = serializers.SerializerMethodField()
    guardians_input = StudentGuardianInput(many=True, write_only=True, required=False)

    class Meta:
        model = Student
        fields = ["id", "student_number", "first_name", "last_name", "full_name", "date_of_birth", "gender",
                  "group", "group_name", "is_active", "emergency_contact_name", "emergency_contact_phone",
                  "medical_notes", "allergies", "pickup_permissions", "home_address", "home_lat", "home_lng",
                  "uses_bus_morning", "uses_bus_afternoon", "guardians", "guardians_input"]

    def get_guardians(self, obj):
        links = obj.studentguardian_set.all()   # prefetched by the views (no query per student)
        return [{"id": l.guardian.id, "name": l.guardian.name, "phone": l.guardian.phone, "email": l.guardian.email,
                 "relation": l.guardian.relation, "is_primary": l.is_primary, "can_pickup": l.can_pickup,
                 "joined": l.guardian.user_id is not None} for l in links]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        access = self.context.get("access")
        # Medical / allergy notes: school staff only. Home location: staff and the child's own parents.
        if not access or not access.is_staff:
            for f in PRIVATE_FIELDS:
                data.pop(f, None)
            if not self.context.get("own_child"):
                for f in LOCATION_FIELDS:
                    data.pop(f, None)
        return data

    def validate(self, data):
        school = self.context["school"]
        if self.instance is None and data.get("is_active", True):
            if Student.objects.filter(school=school, is_active=True).count() >= school.max_students:
                raise serializers.ValidationError(
                    _("Your plan allows %(n)s students. Upgrade the plan to add more.") % {"n": school.max_students})
        for f in ("home_lat", "home_lng"):
            v = data.get(f)
            if v is not None and not (-90 <= v <= 90 if f == "home_lat" else -180 <= v <= 180):
                raise serializers.ValidationError({f: _("Invalid coordinate.")})
        return data

    def _save_guardians(self, student, items):
        if items is None:
            return
        school = self.context["school"]
        keep = []
        for item in items:
            if item.get("id"):
                g = Guardian.objects.filter(id=item["id"], school=school).first()
                if not g:
                    raise serializers.ValidationError({"guardians_input": _("Unknown parent.")})
                for f in ("name", "phone", "email", "relation"):
                    if item.get(f):
                        setattr(g, f, item[f])
                g.save()
            else:
                if not item.get("name"):
                    raise serializers.ValidationError({"guardians_input": _("Parent name is required.")})
                g = Guardian.objects.create(school=school, name=item["name"], phone=item.get("phone", ""),
                                            email=item.get("email", ""), relation=item.get("relation", ""))
            StudentGuardian.objects.update_or_create(student=student, guardian=g, defaults={
                "is_primary": item.get("is_primary", False), "can_pickup": item.get("can_pickup", True)})
            keep.append(g.id)
        StudentGuardian.objects.filter(student=student).exclude(guardian_id__in=keep).delete()

    @transaction.atomic
    def create(self, validated):
        items = validated.pop("guardians_input", None)
        student = super().create(validated)
        self._save_guardians(student, items)
        return student

    @transaction.atomic
    def update(self, instance, validated):
        items = validated.pop("guardians_input", None)
        student = super().update(instance, validated)
        self._save_guardians(student, items)
        return student


# ---------------------------------------------------------------- communication
class AnnouncementSerializer(serializers.ModelSerializer):
    group = SchoolScopedRelatedField(queryset=StudentGroup.objects.all(), required=False, allow_null=True)
    guardian = SchoolScopedRelatedField(queryset=Guardian.objects.all(), required=False, allow_null=True)
    author_name = serializers.SerializerMethodField()
    stats = serializers.SerializerMethodField()

    class Meta:
        model = Announcement
        fields = ["id", "title", "body", "audience", "grade_level", "group", "guardian", "publish_at", "sent_at",
                  "urgent", "author_name", "stats", "created_at"]
        read_only_fields = ["sent_at", "created_at"]

    def get_author_name(self, obj):
        return obj.author.get_full_name() or obj.author.username if obj.author else ""

    def get_stats(self, obj):
        total = obj.receipts.count()
        return {"recipients": total, "read": obj.receipts.filter(read_at__isnull=False).count()}

    def validate(self, data):
        aud = data.get("audience", "school")
        if aud == "grade" and not data.get("grade_level"):
            raise serializers.ValidationError({"grade_level": _("Choose a grade.")})
        if aud == "group" and not data.get("group"):
            raise serializers.ValidationError({"group": _("Choose a class group.")})
        if aud == "guardian" and not data.get("guardian"):
            raise serializers.ValidationError({"guardian": _("Choose a parent.")})
        access = self.context["access"]
        if not access.is_manager and aud != "group":
            raise serializers.ValidationError(_("Teachers can only send announcements to their class groups."))
        return data


class CalendarEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = CalendarEvent
        fields = ["id", "title", "kind", "start_date", "end_date", "description", "grade_level"]

    def validate(self, data):
        if data.get("end_date") and data.get("start_date") and data["end_date"] < data["start_date"]:
            raise serializers.ValidationError(_("The end date is before the start date."))
        return data


class FAQSerializer(serializers.ModelSerializer):
    class Meta:
        model = FAQ
        fields = ["id", "question", "answer", "order"]


class MessageSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()
    from_school = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = ["id", "body", "author_name", "from_school", "created_at"]

    def get_author_name(self, obj):
        return (obj.author.get_full_name() or obj.author.username) if obj.author else ""

    def get_from_school(self, obj):
        return obj.author_id != obj.thread.parent_id


class ThreadSerializer(serializers.ModelSerializer):
    messages = MessageSerializer(many=True, read_only=True)
    parent_name = serializers.SerializerMethodField()
    student_name = serializers.CharField(source="student.full_name", read_only=True, default=None)
    body = serializers.CharField(write_only=True, required=False)

    class Meta:
        model = MessageThread
        fields = ["id", "subject", "status", "student", "student_name", "parent_name", "messages", "body",
                  "created_at", "updated_at"]
        read_only_fields = ["status"]

    def get_parent_name(self, obj):
        return obj.parent.get_full_name() or obj.parent.username


# ---------------------------------------------------------------- attendance / staffing
class AbsenceReportSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.full_name", read_only=True)

    class Meta:
        model = AbsenceReport
        fields = ["id", "student", "student_name", "date_from", "date_to", "reason", "acknowledged", "created_at"]
        read_only_fields = ["acknowledged"]

    def validate(self, data):
        if data["date_to"] < data["date_from"]:
            raise serializers.ValidationError(_("The end date is before the start date."))
        return data


class TeacherAbsenceSerializer(serializers.ModelSerializer):
    teacher = SchoolScopedRelatedField(queryset=Teacher.objects.all())
    teacher_name = serializers.CharField(source="teacher.name", read_only=True)

    class Meta:
        model = TeacherAbsence
        fields = ["id", "teacher", "teacher_name", "date", "period_ids", "reason", "created_at"]


class CoverSerializer(serializers.ModelSerializer):
    covering_teacher_name = serializers.CharField(source="covering_teacher.name", read_only=True)
    group = serializers.CharField(source="entry.student_group.name", read_only=True)
    subject = serializers.CharField(source="entry.subject.name", read_only=True)
    period = serializers.CharField(source="entry.period.name", read_only=True)
    absent_teacher = serializers.CharField(source="absence.teacher.name", read_only=True)

    class Meta:
        model = CoverAssignment
        fields = ["id", "date", "entry", "covering_teacher", "covering_teacher_name", "group", "subject", "period",
                  "absent_teacher"]


# ---------------------------------------------------------------- homework & grades
class HomeworkSerializer(serializers.ModelSerializer):
    group = SchoolScopedRelatedField(queryset=StudentGroup.objects.all())
    subject = SchoolScopedRelatedField(queryset=Subject.objects.all())
    group_name = serializers.CharField(source="group.name", read_only=True)
    subject_name = serializers.CharField(source="subject.name", read_only=True)
    teacher_name = serializers.CharField(source="teacher.name", read_only=True, default=None)

    class Meta:
        model = Homework
        fields = ["id", "group", "group_name", "subject", "subject_name", "teacher_name", "title", "description",
                  "assigned_date", "due_date", "link"]

    def validate(self, data):
        if data.get("due_date") and data.get("assigned_date") and data["due_date"] < data["assigned_date"]:
            raise serializers.ValidationError(_("The due date is before the assigned date."))
        return data


class TermSerializer(serializers.ModelSerializer):
    class Meta:
        model = Term
        fields = ["id", "name", "start_date", "end_date"]


class AssessmentSerializer(serializers.ModelSerializer):
    term = SchoolScopedRelatedField(queryset=Term.objects.all())
    group = SchoolScopedRelatedField(queryset=StudentGroup.objects.all())
    subject = SchoolScopedRelatedField(queryset=Subject.objects.all())
    group_name = serializers.CharField(source="group.name", read_only=True)
    subject_name = serializers.CharField(source="subject.name", read_only=True)
    graded = serializers.SerializerMethodField()

    class Meta:
        model = Assessment
        fields = ["id", "term", "group", "group_name", "subject", "subject_name", "name", "date", "max_score",
                  "weight", "graded"]

    def get_graded(self, obj):
        return obj.grades.filter(score__isnull=False).count()


# ---------------------------------------------------------------- exams
class ExamPeriodSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExamPeriod
        fields = ["id", "name", "start_date", "end_date", "sessions", "max_exams_per_day", "last_result"]
        read_only_fields = ["last_result"]

    def to_representation(self, instance):
        from api.i18n import tr
        data = super().to_representation(instance)
        if data.get("last_result", {}).get("reasons"):
            data["last_result"] = {**data["last_result"], "reasons": tr(data["last_result"]["reasons"])}
        return data

    def validate_sessions(self, value):
        if not isinstance(value, list) or not value or any(
                not isinstance(s, dict) or not s.get("start") or not s.get("end") for s in value):
            raise serializers.ValidationError(_('Add at least one session like {"start": "09:00", "end": "11:00"}.'))
        return value


class ExamSittingSerializer(serializers.ModelSerializer):
    group_name = serializers.CharField(source="group.name", read_only=True)
    room_name = serializers.CharField(source="room.name", read_only=True, default=None)
    invigilator_name = serializers.CharField(source="invigilator.name", read_only=True, default=None)

    class Meta:
        model = ExamSitting
        fields = ["id", "group", "group_name", "room", "room_name", "invigilator", "invigilator_name"]


class ExamSerializer(serializers.ModelSerializer):
    subject = SchoolScopedRelatedField(queryset=Subject.objects.all())
    groups = SchoolScopedRelatedField(queryset=StudentGroup.objects.all(), many=True)
    exam_period = serializers.PrimaryKeyRelatedField(queryset=ExamPeriod.objects.all())
    subject_name = serializers.CharField(source="subject.name", read_only=True)
    sittings = ExamSittingSerializer(many=True, read_only=True)

    class Meta:
        model = Exam
        fields = ["id", "exam_period", "subject", "subject_name", "groups", "duration_minutes", "date",
                  "session_index", "sittings"]
        read_only_fields = ["date", "session_index"]

    def validate_exam_period(self, value):
        if value.school_id != self.context["school"].id:
            raise serializers.ValidationError(_("Unknown exam period."))
        return value


# ---------------------------------------------------------------- fees
class FeePlanSerializer(serializers.ModelSerializer):
    total = serializers.SerializerMethodField()

    class Meta:
        model = FeePlan
        fields = ["id", "name", "items", "total", "created_at"]

    def get_total(self, obj):
        return str(sum(Decimal(str(i.get("amount", 0))) for i in obj.items))

    def validate_items(self, items):
        if not isinstance(items, list) or not items:
            raise serializers.ValidationError(_("Add at least one fee item."))
        for it in items:
            try:
                amount = Decimal(str(it["amount"]))
            except Exception:  # noqa: BLE001
                raise serializers.ValidationError(_("Each item needs an amount."))
            if amount < 0:
                raise serializers.ValidationError(_("Amounts cannot be negative."))
            insts = it.get("installments") or []
            if insts:
                total = sum(Decimal(str(x["amount"])) for x in insts)
                if total != amount:
                    raise serializers.ValidationError(
                        _("Installments of '%(item)s' add up to %(total)s, not %(amount)s.")
                        % {"item": it.get("description", ""), "total": total, "amount": amount})
                for x in insts:
                    serializers.DateField().to_internal_value(x["due_date"])
            elif not it.get("due_date"):
                raise serializers.ValidationError(_("Each item needs a due date or installments."))
        return items


class InstallmentSerializer(serializers.ModelSerializer):
    outstanding = serializers.DecimalField(max_digits=12, decimal_places=3, read_only=True)

    class Meta:
        model = Installment
        fields = ["id", "due_date", "amount", "paid", "outstanding"]
        read_only_fields = ["paid"]


class StudentFeeSerializer(serializers.ModelSerializer):
    student = SchoolScopedRelatedField(queryset=Student.objects.all())
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    installments = InstallmentSerializer(many=True, required=False)

    class Meta:
        model = StudentFee
        fields = ["id", "student", "student_name", "plan", "category", "description", "amount", "discount",
                  "installments", "created_at"]
        read_only_fields = ["plan"]

    def validate(self, data):
        insts = data.get("installments")
        amount = data.get("amount", getattr(self.instance, "amount", None))
        discount = data.get("discount", getattr(self.instance, "discount", Decimal("0")))
        if insts is not None and amount is not None and sum(i["amount"] for i in insts) != amount - discount:
            raise serializers.ValidationError(_("Installments must add up to the amount minus discount."))
        return data

    @transaction.atomic
    def create(self, validated):
        insts = validated.pop("installments", None)
        fee = StudentFee.objects.create(**validated)
        if not insts:
            insts = [{"due_date": fee.created_at.date(), "amount": fee.amount - fee.discount}]
        for i in insts:
            Installment.objects.create(fee=fee, **i)
        return fee

    @transaction.atomic
    def update(self, instance, validated):
        insts = validated.pop("installments", None)
        fee = super().update(instance, validated)
        if insts is not None:
            fee.installments.all().delete()
            for i in insts:
                Installment.objects.create(fee=fee, **i)
        return fee


class PaymentSerializer(serializers.ModelSerializer):
    student = SchoolScopedRelatedField(queryset=Student.objects.all())
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    received_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Payment
        fields = ["id", "student", "student_name", "amount", "method", "date", "reference", "receipt_number",
                  "note", "received_by_name", "created_at"]
        read_only_fields = ["receipt_number"]

    def get_received_by_name(self, obj):
        return (obj.received_by.get_full_name() or obj.received_by.username) if obj.received_by else ""

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError(_("The amount must be more than zero."))
        return value


# ---------------------------------------------------------------- admissions & pickup
class ApplicantSerializer(serializers.ModelSerializer):
    class Meta:
        model = Applicant
        fields = ["id", "child_name", "date_of_birth", "grade_applying", "guardian_name", "guardian_phone",
                  "guardian_email", "stage", "test_date", "test_score", "documents", "next_follow_up", "notes",
                  "source", "student", "created_at", "updated_at"]
        read_only_fields = ["student"]


class PickupNoticeSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.full_name", read_only=True)

    class Meta:
        model = PickupNotice
        fields = ["id", "student", "student_name", "date", "mode", "person_name", "note", "handed_over_at",
                  "handed_over_to"]
        read_only_fields = ["handed_over_at", "handed_over_to"]
