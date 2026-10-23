from django.db import models
from django.contrib.auth.models import User

# -----------------School--------------------------
class School(models.Model):
    name = models.CharField(max_length=200)
    address = models.TextField()
    established_year = models.IntegerField()
    principal_name = models.CharField(max_length=100)
    user = models.ForeignKey(User, related_name="school", on_delete=models.CASCADE )
    # Teaching days as ISO-ish day numbers used by TimetableEntry (7=Sunday, 1=Monday ... 6=Saturday).
    week_days = models.CharField(max_length=20, default="7,1,2,3,4", help_text="Comma-separated, e.g. 7,1,2,3,4 = Sun-Thu")

    def __str__(self):
        return self.name

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
