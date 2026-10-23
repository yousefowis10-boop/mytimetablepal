from datetime import timedelta

from django.contrib.auth.models import User
from django.db import models
from django.utils import timezone

# Feature modules a plan can switch on. School setup, people and timetable viewing are always on.
MODULES = [
    ("timetable", "Timetable generator"),
    ("communication", "Announcements, calendar & messages"),
    ("attendance", "Attendance"),
    ("substitutes", "Teacher absence & substitutes"),
    ("homework", "Homework"),
    ("grades", "Grades & report cards"),
    ("exams", "Exam scheduling"),
    ("fees", "Fees & installments"),
    ("admissions", "Admissions"),
    ("pickup", "Pickup & dismissal"),
    ("transport", "School bus routes & tracking"),
]
ALL_MODULES = [m for m, _ in MODULES]


class Plan(models.Model):
    code = models.SlugField(unique=True)
    name = models.CharField(max_length=100)
    max_students = models.PositiveIntegerField()
    modules = models.JSONField(default=list)
    price_jod_month = models.DecimalField(max_digits=8, decimal_places=3, default=0)
    is_trial = models.BooleanField(default=False)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "id"]

    def __str__(self):
        return self.name

# -----------------School--------------------------
class School(models.Model):
    name = models.CharField(max_length=200)
    address = models.TextField()
    established_year = models.IntegerField()
    principal_name = models.CharField(max_length=100)
    user = models.ForeignKey(User, related_name="school", on_delete=models.CASCADE )
    # Teaching days as ISO-ish day numbers used by TimetableEntry (7=Sunday, 1=Monday ... 6=Saturday).
    week_days = models.CharField(max_length=20, default="7,1,2,3,4", help_text="Comma-separated, e.g. 7,1,2,3,4 = Sun-Thu")

    # --- platform / subscription ---
    STATUS_CHOICES = [("trial", "Trial"), ("active", "Active"), ("suspended", "Suspended")]
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="trial")
    plan = models.ForeignKey(Plan, null=True, blank=True, on_delete=models.SET_NULL, related_name="schools")
    trial_ends_at = models.DateTimeField(null=True, blank=True)
    suspended_reason = models.CharField(max_length=300, blank=True, default="")
    created_at = models.DateTimeField(default=timezone.now)

    # --- branding & settings ---
    city = models.CharField(max_length=100, blank=True, default="Amman")
    phone = models.CharField(max_length=40, blank=True, default="")
    email = models.EmailField(blank=True, default="")
    logo = models.TextField(blank=True, default="", help_text="data: URL (PNG/JPEG/WebP, max ~300 KB)")
    brand_color = models.CharField(max_length=9, blank=True, default="#2563eb")
    currency = models.CharField(max_length=3, default="JOD")
    default_language = models.CharField(max_length=5, default="ar", choices=[("ar", "Arabic"), ("en", "English")])
    attendance_mode = models.CharField(max_length=10, default="period",
                                       choices=[("period", "Per period"), ("day", "Per day")])
    absence_alert_threshold = models.PositiveIntegerField(default=10, help_text="Flag students absent more than this % of school days")
    pass_mark = models.DecimalField(max_digits=5, decimal_places=2, default=50)
    grading_scale = models.JSONField(default=list, blank=True, help_text='[{"min": 90, "label": "A"}, ...]')
    fee_reminder_days_before = models.PositiveIntegerField(default=3)
    fee_reminder_days_after = models.PositiveIntegerField(default=7)
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)

    def __str__(self):
        return self.name

    @property
    def is_suspended(self):
        return self.status == "suspended"

    @property
    def trial_expired(self):
        return self.status == "trial" and self.trial_ends_at is not None and self.trial_ends_at < timezone.now()

    @property
    def enabled_modules(self):
        if self.plan is None:
            return set(ALL_MODULES)
        return set(self.plan.modules or [])

    def has_module(self, module):
        return module in self.enabled_modules

    @property
    def max_students(self):
        return self.plan.max_students if self.plan else 100000

    def start_trial(self, days=30):
        self.status = "trial"
        self.trial_ends_at = timezone.now() + timedelta(days=days)
        self.plan = Plan.objects.filter(is_trial=True).first() or self.plan

    @property
    def week_day_list(self):
        return [int(d) for d in self.week_days.split(",") if d.strip()]


# -------------------Classroom model--------------------------
ROOM_TYPES = [
    ("regular", "Regular classroom"),
    ("lab", "Science lab"),
    ("computer_lab", "Computer lab"),
    ("gym", "Gym / sports"),
    ("other", "Other"),
]


class Classroom(models.Model):
    name = models.CharField(max_length=100)  # e.g. "Grade 5 - A"
    capacity = models.IntegerField()
    room_type = models.CharField(max_length=20, choices=ROOM_TYPES, default="regular")
    school = models.ForeignKey(School, related_name="classrooms", on_delete=models.CASCADE)

    def __str__(self):
        return f"{self.name} - {self.school.name}"


# -----------------Student Group--------------------
class StudentGroup(models.Model):
    school = models.ForeignKey(School, related_name="student_groups", on_delete=models.CASCADE)
    classroom = models.ForeignKey(Classroom, related_name="groups", on_delete=models.SET_NULL, null=True, blank=True)  # Change to ForeignKey
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, null=True)
    size = models.PositiveIntegerField(default=25, help_text="Number of students")
    grade_level = models.PositiveIntegerField(null=True, blank=True, help_text="e.g. 9 for Grade 9")

    def __str__(self):
        return f"{self.name} - {self.classroom.name if self.classroom else 'No Classroom'} - {self.school.name}"

    
# ---------------- SUBJECT REQUIREMENT ----------------
class SubjectRequirement(models.Model):
    student_group = models.ForeignKey(
        "StudentGroup", related_name="subject_requirements", on_delete=models.CASCADE
    )
    subject = models.ForeignKey(
        "Subject", related_name="subject_requirements", on_delete=models.CASCADE
    )
    lectures_per_week = models.PositiveIntegerField(default=1)
    double_periods_per_week = models.PositiveIntegerField(
        default=0, help_text="How many of the weekly lessons are taught as back-to-back pairs"
    )

    class Meta:
        unique_together = ("student_group", "subject")

    def __str__(self):
        return f"{self.student_group.name} needs {self.lectures_per_week} of {self.subject.name}/week"

    
#------------------ Teacher------------------------
class Teacher(models.Model):
    name = models.CharField(max_length=100)
    experience = models.IntegerField()
    school = models.ForeignKey(School, related_name="teachers", on_delete=models.CASCADE )
    subjects = models.ManyToManyField('Subject', related_name='teachers')
    user = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="teacher_profiles")
    phone = models.CharField(max_length=40, blank=True, default="")
    email = models.EmailField(blank=True, default="")
    max_lessons_per_day = models.PositiveIntegerField(null=True, blank=True)
    max_lessons_per_week = models.PositiveIntegerField(null=True, blank=True)


    def __str__(self):
        return f"{self.name}"

#-------------------Availability of teacher--------------------
class Availability(models.Model):
    teacher = models.ForeignKey(
        Teacher,
        related_name='availabilities',
        on_delete=models.CASCADE
    )
    slot = models.CharField(max_length=100)  # Example: "Morning Slot", "Evening Slot"
    start_time = models.TimeField()
    end_time = models.TimeField()

    def __str__(self):
        return f"{self.teacher.name} - {self.slot} ({self.start_time} to {self.end_time})"


# ------------------- Schedule --------------------

class Schedule(models.Model):
    school = models.ForeignKey(School, related_name="schedules", on_delete=models.CASCADE)
    name = models.CharField(max_length=100, help_text="e.g. Morning Shift, Evening Shift")
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.school.name} - {self.name}"


class SchedulePeriod(models.Model):
    PERIOD_TYPES = [
        ('lecture', 'Lecture'),
        ('break', 'Break'),
        ('lab', 'Lab'),
        ('other', 'Other'),
    ]

    schedule = models.ForeignKey(Schedule, related_name="periods", on_delete=models.CASCADE)
    name = models.CharField(max_length=100, help_text="e.g. Lecture 1, Break, Lab")
    start_time = models.TimeField()
    end_time = models.TimeField()
    type = models.CharField(max_length=20, choices=PERIOD_TYPES, default='lecture')
    order = models.PositiveIntegerField(help_text="Order of periods in the day")

    class Meta:
        ordering = ['order']

    def __str__(self):
        return f"{self.name} ({self.start_time} - {self.end_time})"

class TeacherAvailablePeriod(models.Model):
    teacher = models.ForeignKey(
        Teacher,
        related_name="available_periods",
        on_delete=models.CASCADE
    )
    period = models.ForeignKey(
        SchedulePeriod,
        related_name="available_teachers",
        on_delete=models.CASCADE
    )

    class Meta:
        unique_together = ("teacher", "period")

    def __str__(self):
        return f"{self.teacher.name} available in {self.period.name}"


# -------------------Subject-----------------------------------
class Subject(models.Model):
    name = models.CharField(max_length=100)
    code = models.CharField(max_length=20)  # e.g. MATH101, unique per school
    description = models.TextField(blank=True, null=True)
    school = models.ForeignKey(School, related_name="subjects", on_delete=models.CASCADE)
    requires_room_type = models.CharField(max_length=20, choices=ROOM_TYPES, blank=True, default="",
                                          help_text="Empty = any regular classroom")
    is_heavy = models.BooleanField(default=False, help_text="Prefer morning periods")

    class Meta:
        unique_together = ("school", "code")

    def __str__(self):
        return f"{self.name} ({self.code})"


# ---------------- Timetable ----------------
class Timetable(models.Model):
    is_active = models.BooleanField(default=True, help_text="Used for attendance, covers and dashboards")
    schedule = models.ForeignKey(
        "Schedule",
        related_name="timetables",
        on_delete=models.CASCADE
    )
    school = models.ForeignKey(School, on_delete=models.CASCADE)
    name = models.CharField(max_length=100, help_text="e.g., Class 10A Timetable")
    description = models.TextField(blank=True, null=True)
    effective_date_start = models.DateField()
    effective_date_end = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name}"


# ---------------- Timetable Entry ----------------
class TimetableEntry(models.Model):
    DAYS_OF_WEEK = [
        (1, "Monday"),
        (2, "Tuesday"),
        (3, "Wednesday"),
        (4, "Thursday"),
        (5, "Friday"),
        (6, "Saturday"),
        (7, "Sunday"),
    ]

    timetable = models.ForeignKey(
        Timetable,
        related_name="entries",
        on_delete=models.CASCADE
    )

    student_group = models.ForeignKey(
        "StudentGroup",
        related_name="timetable_entries",
        on_delete=models.CASCADE
    )

    day_of_week = models.IntegerField(choices=DAYS_OF_WEEK)

    period = models.ForeignKey(
        "SchedulePeriod",
        related_name="entries",
        on_delete=models.CASCADE
    )
    teacher = models.ForeignKey(
        "Teacher",
        related_name="timetable_entries",
        on_delete=models.CASCADE
    )
    covering_teacher = models.ForeignKey(             # NEW FIELD
        "Teacher",
        null=True,
        blank=True,
        related_name="covering_entries",
        on_delete=models.SET_NULL
    )
    subject = models.ForeignKey(
        "Subject",
        related_name="timetable_entries",
        on_delete=models.CASCADE
    )
    classroom = models.ForeignKey(
        "Classroom",
        related_name="timetable_entries",
        on_delete=models.CASCADE
    )
    locked = models.BooleanField(default=False, help_text="Pinned by an admin; the generator keeps it")

    def __str__(self):
        return f"{self.student_group.name} | {self.get_day_of_week_display()} - {self.period.name} ({self.subject.name})"



# ---------------- Timetable generator settings & jobs ----------------
DEFAULT_SOLVER_WEIGHTS = {
    "spread": 10,          # same subject twice in a day (not a double period)
    "teacher_gaps": 3,     # free periods sandwiched between a teacher's lessons
    "heavy_late": 2,       # heavy subject after the morning
    "room_change": 1,      # lesson outside the group's home room (regular subjects)
    "teacher_split": 8,    # a group's subject taught by more than one teacher
    "load_balance": 1,     # uneven load between teachers of the same subject
}


class SolverSettings(models.Model):
    school = models.OneToOneField(School, related_name="solver_settings", on_delete=models.CASCADE)
    weights = models.JSONField(default=dict, blank=True)
    time_limit_seconds = models.PositiveIntegerField(default=60)

    def effective_weights(self):
        merged = dict(DEFAULT_SOLVER_WEIGHTS)
        merged.update({k: int(v) for k, v in (self.weights or {}).items() if k in DEFAULT_SOLVER_WEIGHTS})
        return merged


class TimetableJob(models.Model):
    STATUSES = [
        ("queued", "Queued"),
        ("running", "Running"),
        ("succeeded", "Succeeded"),
        ("failed", "Failed"),
        ("infeasible", "No valid timetable"),
    ]
    timetable = models.ForeignKey(Timetable, related_name="jobs", on_delete=models.CASCADE)
    created_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL)
    status = models.CharField(max_length=20, choices=STATUSES, default="queued")
    progress = models.PositiveIntegerField(default=0, help_text="0-100")
    message = models.TextField(blank=True, default="")
    params = models.JSONField(default=dict, blank=True)
    result = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]


# ---------------- Tenancy: who belongs to which school, with which roles ----------------
ROLES = [
    ("admin", "School admin"),
    ("staff", "Staff / secretary"),
    ("teacher", "Teacher"),
    ("parent", "Parent"),
    ("driver", "Bus driver"),
]
STAFF_ROLES = ("admin", "staff", "teacher")


class Membership(models.Model):
    """One row per (user, school, role). A person can hold several roles and belong to several schools."""
    user = models.ForeignKey(User, related_name="memberships", on_delete=models.CASCADE)
    school = models.ForeignKey(School, related_name="memberships", on_delete=models.CASCADE)
    role = models.CharField(max_length=20, choices=ROLES)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("user", "school", "role")

    def __str__(self):
        return f"{self.user} - {self.role} @ {self.school}"


class Invitation(models.Model):
    """Join code for a teacher / parent / driver / staff member; links them to their record when accepted."""
    school = models.ForeignKey(School, related_name="invitations", on_delete=models.CASCADE)
    role = models.CharField(max_length=20, choices=ROLES)
    code = models.CharField(max_length=40, unique=True)
    email = models.EmailField(blank=True, default="")
    name = models.CharField(max_length=150, blank=True, default="")
    teacher = models.ForeignKey(Teacher, null=True, blank=True, on_delete=models.CASCADE)
    guardian_id = models.PositiveIntegerField(null=True, blank=True)   # ops.Guardian
    bus_id = models.PositiveIntegerField(null=True, blank=True)        # transport.Bus
    created_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    accepted_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    accepted_at = models.DateTimeField(null=True, blank=True)


class AuditLog(models.Model):
    school = models.ForeignKey(School, related_name="audit_logs", on_delete=models.CASCADE)
    user = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL)
    action = models.CharField(max_length=20)            # create / update / delete / generate / view
    model = models.CharField(max_length=60)
    object_id = models.CharField(max_length=40, blank=True, default="")
    summary = models.CharField(max_length=300, blank=True, default="")
    changes = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["school", "model", "created_at"])]


class Notification(models.Model):
    school = models.ForeignKey(School, related_name="notifications", on_delete=models.CASCADE)
    user = models.ForeignKey(User, related_name="notifications", on_delete=models.CASCADE)
    kind = models.CharField(max_length=40)              # absence, announcement, cover, fee, bus, ...
    title = models.CharField(max_length=200)
    body = models.TextField(blank=True, default="")
    link = models.CharField(max_length=300, blank=True, default="")
    data = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    read_at = models.DateTimeField(null=True, blank=True)
    channels_sent = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "read_at"])]


class PushSubscription(models.Model):
    user = models.ForeignKey(User, related_name="push_subscriptions", on_delete=models.CASCADE)
    endpoint = models.URLField(max_length=600, unique=True)
    p256dh = models.CharField(max_length=200)
    auth = models.CharField(max_length=100)
    created_at = models.DateTimeField(auto_now_add=True)


class UserProfile(models.Model):
    user = models.OneToOneField(User, related_name="profile", on_delete=models.CASCADE)
    phone = models.CharField(max_length=40, blank=True, default="")
    language = models.CharField(max_length=5, blank=True, default="")
    email_notifications = models.BooleanField(default=True)
    push_notifications = models.BooleanField(default=True)


class TaskLock(models.Model):
    """Lets periodic jobs run once even with several web workers."""
    name = models.CharField(max_length=50, unique=True)
    last_run = models.DateTimeField(null=True, blank=True)
