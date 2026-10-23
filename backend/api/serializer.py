from django.utils.translation import gettext as _
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from .models import (
    School, Teacher, Availability, Classroom, Schedule, SchedulePeriod, Subject, StudentGroup,
    Timetable, TimetableEntry, SubjectRequirement, TimetableJob,
)

User = get_user_model()


class SchoolScopedRelatedField(serializers.PrimaryKeyRelatedField):
    """A PK field that only accepts objects from the school in the serializer context."""

    def __init__(self, school_lookup="school", **kwargs):
        self.school_lookup = school_lookup
        super().__init__(**kwargs)

    def get_queryset(self):
        queryset = super().get_queryset()
        school = self.context.get("school")
        if school is None:
            return queryset.none()
        return queryset.filter(**{self.school_lookup: school})


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True)
    email = serializers.EmailField()

    class Meta:
        model = User
        fields = ['email', 'password', 'first_name', 'last_name']

    def validate_email(self, value):
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError(_("An account with this email already exists."))
        return value

    def validate_password(self, value):
        validate_password(value)
        return value

    def create(self, validated_data):
        validated_data['username'] = validated_data['email']
        return User.objects.create_user(**validated_data)


class ClassroomSerializer(serializers.ModelSerializer):
    class Meta:
        model = Classroom
        fields = '__all__'
        read_only_fields = ['school']


class StudentGroupSerializer(serializers.ModelSerializer):
    classroom = ClassroomSerializer(read_only=True)
    classroom_id = SchoolScopedRelatedField(
        queryset=Classroom.objects.all(),
        source="classroom",
        write_only=True,
        required=False,
        allow_null=True,
    )

    class Meta:
        model = StudentGroup
        fields = ["id", "name", "description", "size", "grade_level", "school", "classroom_id", "classroom"]
        read_only_fields = ['school']


class SubjectRequirementSerializer(serializers.ModelSerializer):
    subject = SchoolScopedRelatedField(queryset=Subject.objects.all())
    subject_name = serializers.CharField(source='subject.name', read_only=True)

    class Meta:
        model = SubjectRequirement
        fields = ['id', 'student_group', 'subject', 'subject_name', 'lectures_per_week', 'double_periods_per_week']
        read_only_fields = ['student_group']

    def validate(self, data):
        lessons = data.get("lectures_per_week", getattr(self.instance, "lectures_per_week", 1))
        doubles = data.get("double_periods_per_week", getattr(self.instance, "double_periods_per_week", 0))
        if doubles * 2 > lessons:
            raise serializers.ValidationError(_("Double periods use two lessons each; too many for the weekly lessons."))
        return data


class AvailabilitySerializer(serializers.ModelSerializer):
    class Meta:
        model = Availability
        fields = '__all__'
        read_only_fields = ['teacher']


class TeacherSerializer(serializers.ModelSerializer):
    subjects = SchoolScopedRelatedField(queryset=Subject.objects.all(), many=True)
    subject_names = serializers.SerializerMethodField()
    school_name = serializers.CharField(source='school.name', read_only=True)

    class Meta:
        model = Teacher
        fields = ['id', 'name', 'experience', 'school', 'school_name', 'subjects', 'subject_names', 'phone', 'email', 'user',
                  'max_lessons_per_day', 'max_lessons_per_week']
        read_only_fields = ['school', 'user']

    def get_subject_names(self, obj):
        return [subject.name for subject in obj.subjects.all()]


LOGO_PREFIXES = ("data:image/png;base64,", "data:image/jpeg;base64,", "data:image/webp;base64,")


class SchoolSerializer(serializers.ModelSerializer):
    plan_name = serializers.CharField(source="plan.name", read_only=True, default=None)
    modules = serializers.SerializerMethodField()
    roles = serializers.SerializerMethodField()
    max_students = serializers.IntegerField(read_only=True)
    trial_expired = serializers.BooleanField(read_only=True)
    address = serializers.CharField(required=False, allow_blank=True, default="")
    principal_name = serializers.CharField(required=False, allow_blank=True, default="")
    established_year = serializers.IntegerField(required=False, default=2000)

    class Meta:
        model = School
        fields = ["id", "name", "address", "principal_name", "established_year", "week_days",
                  "city", "phone", "email", "logo", "brand_color", "currency", "default_language",
                  "attendance_mode", "absence_alert_threshold", "pass_mark", "grading_scale",
                  "fee_reminder_days_before", "fee_reminder_days_after", "latitude", "longitude",
                  "status", "plan_name", "trial_ends_at", "trial_expired", "modules", "max_students", "roles"]
        read_only_fields = ["status", "trial_ends_at"]

    def get_modules(self, obj):
        return sorted(obj.enabled_modules)

    def get_roles(self, obj):
        from .access import roles_for
        request = self.context.get("request")
        return sorted(roles_for(request.user, obj)) if request else []

    def validate_logo(self, value):
        if not value:
            return ""
        if not value.startswith(LOGO_PREFIXES):
            raise serializers.ValidationError(_("Upload a PNG, JPEG or WebP image."))
        if len(value) > 450_000:
            raise serializers.ValidationError(_("Logo is too large; please use an image under 300 KB."))
        return value

    def validate_brand_color(self, value):
        import re
        if value and not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
            raise serializers.ValidationError(_("Use a colour like #2563eb."))
        return value

    def validate_currency(self, value):
        if not value.isalpha() or len(value) != 3:
            raise serializers.ValidationError(_("Use a 3-letter currency code such as JOD."))
        return value.upper()

    def validate_grading_scale(self, value):
        if not isinstance(value, list) or any(
                not isinstance(b, dict) or "min" not in b or "label" not in b for b in value):
            raise serializers.ValidationError(_('Use a list like [{"min": 90, "label": "A"}].'))
        return sorted(value, key=lambda b: -float(b["min"]))

    def validate_week_days(self, value):
        try:
            days = [int(d) for d in value.split(",") if d.strip()]
        except ValueError:
            raise serializers.ValidationError(_("Use day numbers 1-7 separated by commas (7=Sunday)."))
        if not days or len(set(days)) != len(days) or any(d < 1 or d > 7 for d in days):
            raise serializers.ValidationError(_("Use day numbers 1-7 separated by commas (7=Sunday), no repeats."))
        return ",".join(str(d) for d in days)


class SchedulePeriodSerializer(serializers.ModelSerializer):
    available_teachers = serializers.SerializerMethodField()

    class Meta:
        model = SchedulePeriod
        fields = '__all__'
        read_only_fields = ['schedule']

    def get_available_teachers(self, obj):
        return [
            {"id": tap.teacher.id, "name": tap.teacher.name}
            for tap in obj.available_teachers.select_related("teacher")
        ]


class ScheduleSerializer(serializers.ModelSerializer):
    periods = SchedulePeriodSerializer(many=True, read_only=True)

    class Meta:
        model = Schedule
        fields = "__all__"
        read_only_fields = ['school']


class SubjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Subject
        fields = "__all__"
        read_only_fields = ['school']
        validators = []  # (school, code) uniqueness is checked below because school comes from the URL

    def validate_code(self, value):
        school = self.context.get("school")
        qs = Subject.objects.filter(school=school, code__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if school and qs.exists():
            raise serializers.ValidationError(_("Another subject in this school already uses this code."))
        return value


class TimetableSerializer(serializers.ModelSerializer):
    schedule = SchoolScopedRelatedField(queryset=Schedule.objects.all())

    class Meta:
        model = Timetable
        exclude = ['school']


DAY_NAMES = {
    1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday",
    5: "Friday", 6: "Saturday", 7: "Sunday",
}


class TimetableEntrySerializer(serializers.ModelSerializer):
    day_of_week = serializers.CharField()
    period = SchoolScopedRelatedField(queryset=SchedulePeriod.objects.all(), school_lookup="schedule__school")
    teacher = SchoolScopedRelatedField(queryset=Teacher.objects.all())
    covering_teacher = SchoolScopedRelatedField(queryset=Teacher.objects.all(), required=False, allow_null=True)
    subject = SchoolScopedRelatedField(queryset=Subject.objects.all())
    classroom = SchoolScopedRelatedField(queryset=Classroom.objects.all())
    student_group = SchoolScopedRelatedField(queryset=StudentGroup.objects.all())

    class Meta:
        model = TimetableEntry
        fields = [
            'id', 'day_of_week', 'period', 'teacher', 'subject',
            'classroom', 'student_group', 'covering_teacher', 'locked',
        ]

    def validate_day_of_week(self, value):
        by_name = {name: num for num, name in DAY_NAMES.items()}
        if value in by_name:
            return by_name[value]
        try:
            ivalue = int(value)
        except (ValueError, TypeError):
            ivalue = None
        if ivalue in DAY_NAMES:
            return ivalue
        raise serializers.ValidationError(_("Invalid day of the week: %(value)s") % {"value": value})

    def to_representation(self, instance):
        # The frontend compares day_of_week numerically (7=Sunday .. 4=Thursday).
        rep = super().to_representation(instance)
        rep["day_of_week"] = instance.day_of_week
        rep["day_name"] = DAY_NAMES.get(instance.day_of_week)
        return rep

    def create(self, validated_data):
        validated_data['timetable'] = self.context['timetable']
        return TimetableEntry.objects.create(**validated_data)


class TimetableJobSerializer(serializers.ModelSerializer):
    message = serializers.SerializerMethodField()
    result = serializers.SerializerMethodField()

    class Meta:
        model = TimetableJob
        fields = ["id", "timetable", "status", "progress", "message", "params", "result",
                  "created_at", "started_at", "finished_at"]

    def get_message(self, obj):
        from .timetable_jobs import read_message
        return read_message(obj.message)

    def get_result(self, obj):
        from .i18n import tr
        result = dict(obj.result or {})
        if result.get("reasons"):
            result["reasons"] = tr(result["reasons"])
        return result
