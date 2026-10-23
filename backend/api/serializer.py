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
            raise serializers.ValidationError("An account with this email already exists.")
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
        fields = ["id", "name", "description", "size", "school", "classroom_id", "classroom"]
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
            raise serializers.ValidationError("Double periods use two lessons each; too many for the weekly lessons.")
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
        fields = ['id', 'name', 'experience', 'school', 'school_name', 'subjects', 'subject_names',
                  'max_lessons_per_day', 'max_lessons_per_week']
        read_only_fields = ['school']

    def get_subject_names(self, obj):
        return [subject.name for subject in obj.subjects.all()]


class SchoolSerializer(serializers.ModelSerializer):
    class Meta:
        model = School
        fields = ["id", "name", "address", "principal_name", "established_year", "week_days"]

    def validate_week_days(self, value):
        try:
            days = [int(d) for d in value.split(",") if d.strip()]
        except ValueError:
            raise serializers.ValidationError("Use day numbers 1-7 separated by commas (7=Sunday).")
        if not days or len(set(days)) != len(days) or any(d < 1 or d > 7 for d in days):
            raise serializers.ValidationError("Use day numbers 1-7 separated by commas (7=Sunday), no repeats.")
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
            raise serializers.ValidationError("Another subject in this school already uses this code.")
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
        raise serializers.ValidationError(f"Invalid day_of_week: {value}")

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
    class Meta:
        model = TimetableJob
        fields = ["id", "timetable", "status", "progress", "message", "params", "result",
                  "created_at", "started_at", "finished_at"]
