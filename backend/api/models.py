from django.db import models
from django.contrib.auth.models import User

# -----------------School--------------------------
class School(models.Model):
    name = models.CharField(max_length=200)
    address = models.TextField()
    established_year = models.IntegerField()
    principal_name = models.CharField(max_length=100)
    user = models.ForeignKey(User, related_name="school", on_delete=models.CASCADE )


    def __str__(self):
        return self.name


# -------------------Classroom model--------------------------
class Classroom(models.Model):
    name = models.CharField(max_length=100)  # e.g. "Grade 5 - A"
    capacity = models.IntegerField()
    school = models.ForeignKey(School, related_name="classrooms", on_delete=models.CASCADE)

    def __str__(self):
        return f"{self.name} - {self.school.name}"


# -----------------Student Group--------------------
class StudentGroup(models.Model):
    school = models.ForeignKey(School, related_name="student_groups", on_delete=models.CASCADE)
    classroom = models.ForeignKey(Classroom, related_name="groups", on_delete=models.SET_NULL, null=True, blank=True)  # Change to ForeignKey
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, null=True)

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

    class Meta:
        unique_together = ("student_group", "subject")

    def __str__(self):
        return f"{self.student_group.name} needs {self.lectures_per_week} of {self.subject.name}/week"

    
#------------------ Teacher------------------------
class Teacher(models.Model):
    name = models.CharField(max_length=100)
    experience = models.IntegerField()
    school = models.ForeignKey(School, related_name="teachers", on_delete=models.CASCADE )
    subjects = models.ManyToManyField('Subject', related_name='teachers')  # ✅ New field
    

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
    code = models.CharField(max_length=20, unique=True)  # e.g. MATH101
    description = models.TextField(blank=True, null=True)
    school = models.ForeignKey(School, related_name="subjects", on_delete=models.CASCADE)

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

    def __str__(self):
        return f"{self.student_group.name} | {self.get_day_of_week_display()} - {self.period.name} ({self.subject.name})"

