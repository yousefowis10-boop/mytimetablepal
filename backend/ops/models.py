"""Day-to-day school operations. Every row belongs to exactly one school."""
from decimal import Decimal

from django.contrib.auth.models import User
from django.db import models
from django.utils import timezone

from api.models import School, StudentGroup, Subject, Teacher, TimetableEntry, Classroom

MONEY = dict(max_digits=12, decimal_places=3)   # JOD has 3 decimals (fils)


# ---------------------------------------------------------------- students & parents
class Guardian(models.Model):
    school = models.ForeignKey(School, related_name="guardians", on_delete=models.CASCADE)
    user = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="guardian_profiles")
    name = models.CharField(max_length=150)
    phone = models.CharField(max_length=40, blank=True, default="")
    email = models.EmailField(blank=True, default="")
    relation = models.CharField(max_length=40, blank=True, default="", help_text="Father, mother, ...")

    def __str__(self):
        return self.name


class Student(models.Model):
    school = models.ForeignKey(School, related_name="students", on_delete=models.CASCADE)
    group = models.ForeignKey(StudentGroup, null=True, blank=True, on_delete=models.SET_NULL, related_name="students")
    student_number = models.CharField(max_length=40, blank=True, default="")
    first_name = models.CharField(max_length=100)
    last_name = models.CharField(max_length=100, blank=True, default="")
    date_of_birth = models.DateField(null=True, blank=True)
    gender = models.CharField(max_length=1, blank=True, default="", choices=[("M", "Male"), ("F", "Female")])
    is_active = models.BooleanField(default=True)
    guardians = models.ManyToManyField(Guardian, through="StudentGuardian", related_name="students")
    emergency_contact_name = models.CharField(max_length=150, blank=True, default="")
    emergency_contact_phone = models.CharField(max_length=40, blank=True, default="")
    # Visible to school staff only - never to parents of other children, drivers or the platform owner.
    medical_notes = models.TextField(blank=True, default="")
    allergies = models.TextField(blank=True, default="")
    pickup_permissions = models.JSONField(default=list, blank=True,
                                          help_text='[{"name": "...", "relation": "...", "phone": "..."}]')
    # Transport (phase 4). Home location is private: only staff, the child's own parents and the planner.
    home_address = models.CharField(max_length=300, blank=True, default="")
    home_lat = models.FloatField(null=True, blank=True)
    home_lng = models.FloatField(null=True, blank=True)
    uses_bus_morning = models.BooleanField(default=False)
    uses_bus_afternoon = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["first_name", "last_name"]

    @property
    def full_name(self):
        return f"{self.first_name} {self.last_name}".strip()

    def __str__(self):
        return self.full_name


class StudentGuardian(models.Model):
    student = models.ForeignKey(Student, on_delete=models.CASCADE)
    guardian = models.ForeignKey(Guardian, on_delete=models.CASCADE)
    is_primary = models.BooleanField(default=False)
    can_pickup = models.BooleanField(default=True)

    class Meta:
        unique_together = ("student", "guardian")


# ---------------------------------------------------------------- communication
class Announcement(models.Model):
    AUDIENCES = [("school", "Whole school"), ("staff", "All staff"), ("parents", "All parents"),
                 ("grade", "A grade"), ("group", "A class group"), ("guardian", "One parent")]
    school = models.ForeignKey(School, related_name="announcements", on_delete=models.CASCADE)
    author = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name="+")
    title = models.CharField(max_length=200)
    body = models.TextField()
    audience = models.CharField(max_length=20, choices=AUDIENCES, default="school")
    grade_level = models.PositiveIntegerField(null=True, blank=True)
    group = models.ForeignKey(StudentGroup, null=True, blank=True, on_delete=models.CASCADE)
    guardian = models.ForeignKey(Guardian, null=True, blank=True, on_delete=models.CASCADE)
    publish_at = models.DateTimeField(default=timezone.now)
    sent_at = models.DateTimeField(null=True, blank=True)
    urgent = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-publish_at"]


class AnnouncementReceipt(models.Model):
    announcement = models.ForeignKey(Announcement, related_name="receipts", on_delete=models.CASCADE)
    user = models.ForeignKey(User, related_name="announcement_receipts", on_delete=models.CASCADE)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = ("announcement", "user")


class CalendarEvent(models.Model):
    KINDS = [("holiday", "Holiday"), ("exam", "Exam"), ("event", "Event"), ("no_school", "No school"),
             ("term", "Term date")]
    school = models.ForeignKey(School, related_name="calendar_events", on_delete=models.CASCADE)
    title = models.CharField(max_length=200)
    kind = models.CharField(max_length=20, choices=KINDS, default="event")
    start_date = models.DateField()
    end_date = models.DateField()
    description = models.TextField(blank=True, default="")
    grade_level = models.PositiveIntegerField(null=True, blank=True, help_text="Empty = whole school")

    class Meta:
        ordering = ["start_date"]


class FAQ(models.Model):
    school = models.ForeignKey(School, related_name="faqs", on_delete=models.CASCADE)
    question = models.CharField(max_length=300)
    answer = models.TextField()
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]


class MessageThread(models.Model):
    school = models.ForeignKey(School, related_name="message_threads", on_delete=models.CASCADE)
    parent = models.ForeignKey(User, related_name="message_threads", on_delete=models.CASCADE)
    student = models.ForeignKey(Student, null=True, blank=True, on_delete=models.SET_NULL)
    subject = models.CharField(max_length=200)
    status = models.CharField(max_length=10, default="open", choices=[("open", "Open"), ("closed", "Closed")])
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]


class Message(models.Model):
    thread = models.ForeignKey(MessageThread, related_name="messages", on_delete=models.CASCADE)
    author = models.ForeignKey(User, null=True, on_delete=models.SET_NULL)
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]


# ---------------------------------------------------------------- attendance
class AttendanceRecord(models.Model):
    STATUSES = [("present", "Present"), ("absent", "Absent"), ("late", "Late"), ("excused", "Excused")]
    school = models.ForeignKey(School, related_name="attendance", on_delete=models.CASCADE)
    student = models.ForeignKey(Student, related_name="attendance", on_delete=models.CASCADE)
    date = models.DateField()
    period = models.ForeignKey("api.SchedulePeriod", null=True, blank=True, on_delete=models.SET_NULL,
                               help_text="Empty when the school takes attendance once a day")
    status = models.CharField(max_length=10, choices=STATUSES)
    note = models.CharField(max_length=200, blank=True, default="")
    taken_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name="+")
    taken_at = models.DateTimeField(auto_now=True)
    parent_notified = models.BooleanField(default=False)

    class Meta:
        unique_together = ("student", "date", "period")
        indexes = [models.Index(fields=["school", "date"])]


class AbsenceReport(models.Model):
    """A parent tells the school in advance that a child will be absent."""
    school = models.ForeignKey(School, related_name="absence_reports", on_delete=models.CASCADE)
    student = models.ForeignKey(Student, related_name="absence_reports", on_delete=models.CASCADE)
    date_from = models.DateField()
    date_to = models.DateField()
    reason = models.CharField(max_length=300)
    reported_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    acknowledged = models.BooleanField(default=False)


# ---------------------------------------------------------------- teacher absence & covers
class TeacherAbsence(models.Model):
    school = models.ForeignKey(School, related_name="teacher_absences", on_delete=models.CASCADE)
    teacher = models.ForeignKey(Teacher, related_name="absences", on_delete=models.CASCADE)
    date = models.DateField()
    period_ids = models.JSONField(default=list, blank=True, help_text="Empty = whole day")
    reason = models.CharField(max_length=200, blank=True, default="")
    created_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date"]


class CoverAssignment(models.Model):
    """Who covers one lesson on one date. Approving also sets TimetableEntry.covering_teacher for that week."""
    school = models.ForeignKey(School, related_name="covers", on_delete=models.CASCADE)
    absence = models.ForeignKey(TeacherAbsence, related_name="covers", on_delete=models.CASCADE)
    entry = models.ForeignKey(TimetableEntry, related_name="covers", on_delete=models.CASCADE)
    date = models.DateField()
    covering_teacher = models.ForeignKey(Teacher, related_name="cover_assignments", on_delete=models.CASCADE)
    approved_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("entry", "date")


# ---------------------------------------------------------------- homework
class Homework(models.Model):
    school = models.ForeignKey(School, related_name="homework", on_delete=models.CASCADE)
    group = models.ForeignKey(StudentGroup, related_name="homework", on_delete=models.CASCADE)
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE)
    teacher = models.ForeignKey(Teacher, null=True, on_delete=models.SET_NULL)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True, default="")
    assigned_date = models.DateField(default=timezone.localdate)
    due_date = models.DateField()
    link = models.URLField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["due_date"]


# ---------------------------------------------------------------- grades
class Term(models.Model):
    school = models.ForeignKey(School, related_name="terms", on_delete=models.CASCADE)
    name = models.CharField(max_length=100)
    start_date = models.DateField()
    end_date = models.DateField()

    class Meta:
        ordering = ["start_date"]


class Assessment(models.Model):
    school = models.ForeignKey(School, related_name="assessments", on_delete=models.CASCADE)
    term = models.ForeignKey(Term, related_name="assessments", on_delete=models.CASCADE)
    group = models.ForeignKey(StudentGroup, related_name="assessments", on_delete=models.CASCADE)
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE)
    teacher = models.ForeignKey(Teacher, null=True, blank=True, on_delete=models.SET_NULL)
    name = models.CharField(max_length=100)
    date = models.DateField(default=timezone.localdate)
    max_score = models.DecimalField(max_digits=6, decimal_places=2, default=100)
    weight = models.DecimalField(max_digits=5, decimal_places=2, default=1)

    class Meta:
        ordering = ["date", "id"]


class Grade(models.Model):
    assessment = models.ForeignKey(Assessment, related_name="grades", on_delete=models.CASCADE)
    student = models.ForeignKey(Student, related_name="grades", on_delete=models.CASCADE)
    score = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    comment = models.CharField(max_length=200, blank=True, default="")

    class Meta:
        unique_together = ("assessment", "student")


# ---------------------------------------------------------------- exams
class ExamPeriod(models.Model):
    school = models.ForeignKey(School, related_name="exam_periods", on_delete=models.CASCADE)
    name = models.CharField(max_length=100)
    start_date = models.DateField()
    end_date = models.DateField()
    sessions = models.JSONField(default=list, help_text='[{"start": "09:00", "end": "11:00"}, ...] each day')
    max_exams_per_day = models.PositiveIntegerField(default=1)
    last_result = models.JSONField(default=dict, blank=True)


class Exam(models.Model):
    exam_period = models.ForeignKey(ExamPeriod, related_name="exams", on_delete=models.CASCADE)
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE)
    groups = models.ManyToManyField(StudentGroup, related_name="exams")
    duration_minutes = models.PositiveIntegerField(default=120)
    date = models.DateField(null=True, blank=True)
    session_index = models.PositiveIntegerField(null=True, blank=True)


class ExamSitting(models.Model):
    """One group sitting one exam in one room with one invigilator."""
    exam = models.ForeignKey(Exam, related_name="sittings", on_delete=models.CASCADE)
    group = models.ForeignKey(StudentGroup, on_delete=models.CASCADE)
    room = models.ForeignKey(Classroom, null=True, on_delete=models.SET_NULL)
    invigilator = models.ForeignKey(Teacher, null=True, on_delete=models.SET_NULL)


# ---------------------------------------------------------------- fees
FEE_CATEGORIES = [("tuition", "Tuition"), ("trip", "Trip"), ("books", "Books"), ("uniform", "Uniform"),
                  ("bus", "Bus"), ("other", "Other")]


class FeePlan(models.Model):
    """A template: e.g. "Grade 1-6 2026/27" = tuition 2,400 JOD in 4 installments + books 120."""
    school = models.ForeignKey(School, related_name="fee_plans", on_delete=models.CASCADE)
    name = models.CharField(max_length=150)
    items = models.JSONField(default=list, help_text='[{"category","description","amount","installments":[{"due_date","amount"}]}]')
    created_at = models.DateTimeField(auto_now_add=True)


class StudentFee(models.Model):
    school = models.ForeignKey(School, related_name="student_fees", on_delete=models.CASCADE)
    student = models.ForeignKey(Student, related_name="fees", on_delete=models.CASCADE)
    plan = models.ForeignKey(FeePlan, null=True, blank=True, on_delete=models.SET_NULL)
    category = models.CharField(max_length=20, choices=FEE_CATEGORIES, default="tuition")
    description = models.CharField(max_length=200)
    amount = models.DecimalField(**MONEY)
    discount = models.DecimalField(default=Decimal("0"), **MONEY)
    created_at = models.DateTimeField(auto_now_add=True)


class Installment(models.Model):
    fee = models.ForeignKey(StudentFee, related_name="installments", on_delete=models.CASCADE)
    due_date = models.DateField()
    amount = models.DecimalField(**MONEY)
    paid = models.DecimalField(default=Decimal("0"), **MONEY)
    reminder_before_sent = models.BooleanField(default=False)
    reminder_after_sent = models.BooleanField(default=False)

    class Meta:
        ordering = ["due_date", "id"]

    @property
    def outstanding(self):
        return self.amount - self.paid


class Payment(models.Model):
    METHODS = [("cash", "Cash"), ("transfer", "Bank transfer"), ("cheque", "Cheque"), ("other", "Other")]
    school = models.ForeignKey(School, related_name="payments", on_delete=models.CASCADE)
    student = models.ForeignKey(Student, related_name="payments", on_delete=models.CASCADE)
    amount = models.DecimalField(**MONEY)
    method = models.CharField(max_length=20, choices=METHODS, default="cash")
    date = models.DateField(default=timezone.localdate)
    reference = models.CharField(max_length=100, blank=True, default="")
    receipt_number = models.CharField(max_length=30, blank=True, default="")
    received_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name="+")
    note = models.CharField(max_length=200, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date", "-id"]


# ---------------------------------------------------------------- admissions
class Applicant(models.Model):
    STAGES = [("inquiry", "Inquiry"), ("placement_test", "Placement test"), ("documents", "Documents"),
              ("accepted", "Accepted"), ("enrolled", "Enrolled"), ("rejected", "Not proceeding")]
    school = models.ForeignKey(School, related_name="applicants", on_delete=models.CASCADE)
    child_name = models.CharField(max_length=150)
    date_of_birth = models.DateField(null=True, blank=True)
    grade_applying = models.PositiveIntegerField(null=True, blank=True)
    guardian_name = models.CharField(max_length=150)
    guardian_phone = models.CharField(max_length=40)
    guardian_email = models.EmailField(blank=True, default="")
    stage = models.CharField(max_length=20, choices=STAGES, default="inquiry")
    test_date = models.DateField(null=True, blank=True)
    test_score = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    documents = models.JSONField(default=dict, blank=True, help_text='{"birth_certificate": true, ...}')
    next_follow_up = models.DateField(null=True, blank=True)
    follow_up_notified = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")
    source = models.CharField(max_length=60, blank=True, default="")
    student = models.ForeignKey(Student, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


# ---------------------------------------------------------------- pickup & dismissal
class PickupNotice(models.Model):
    MODES = [("parent", "Parent picks up"), ("other", "Someone else picks up"), ("bus", "On the bus"),
             ("walk", "Walks home")]
    school = models.ForeignKey(School, related_name="pickup_notices", on_delete=models.CASCADE)
    student = models.ForeignKey(Student, related_name="pickup_notices", on_delete=models.CASCADE)
    date = models.DateField()
    mode = models.CharField(max_length=10, choices=MODES)
    person_name = models.CharField(max_length=150, blank=True, default="")
    note = models.CharField(max_length=200, blank=True, default="")
    created_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name="+")
    handed_over_at = models.DateTimeField(null=True, blank=True)
    handed_over_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    handed_over_to = models.CharField(max_length=150, blank=True, default="")

    class Meta:
        unique_together = ("student", "date")
