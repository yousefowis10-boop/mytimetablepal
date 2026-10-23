"""
python manage.py seed_demo [--if-missing] [--skip-solvers]

Creates two demo schools with every module filled in, plus one demo login per role.

  Amman Demo School  - Premium plan, ~750 students, 55 teachers, buses, fees, the works
  Irbid Demo School  - Standard plan (no fees, no buses), smaller; shows strict school separation

The demo parent has two children in Amman and one in Irbid (school switcher). The platform owner account is
created only from PLATFORM_OWNER_EMAIL / PLATFORM_OWNER_PASSWORD - never with a public password.

--if-missing (deploy mode) only runs when SEED_DEMO=true and this demo version has not been seeded yet.
"""
import os
import random
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction
from django.test.utils import override_settings
from django.utils import timezone

from api.models import (
    Classroom, Membership, Plan, School, Schedule, SchedulePeriod, StudentGroup, Subject, SubjectRequirement,
    TaskLock, Teacher, TeacherAvailablePeriod, Timetable, UserProfile,
)

User = get_user_model()

DEMO_VERSION = 5
DEMO_SCHOOL_NAME = "Amman Demo School"
IRBID_SCHOOL_NAME = "Irbid Demo School"
DEFAULT_DEMO_PASSWORD = "DemoSchool-2026"
EMAILS = {
    "admin": "admin@demo.mytimetablepal.com",
    "staff": "staff@demo.mytimetablepal.com",
    "teacher": "teacher@demo.mytimetablepal.com",
    "parent": "parent@demo.mytimetablepal.com",
    "driver": "driver@demo.mytimetablepal.com",
    "irbid_admin": "admin.irbid@demo.mytimetablepal.com",
}
DEMO_ADMIN_EMAIL = EMAILS["admin"]

# (name, code, teachers, room type, heavy)
SUBJECTS = [
    ("Arabic", "ARB", 9, "", False), ("English", "ENG", 8, "", False), ("Mathematics", "MATH", 9, "", True),
    ("Science", "SCI", 4, "", False), ("Physics", "PHY", 2, "lab", True), ("Chemistry", "CHEM", 2, "lab", True),
    ("Biology", "BIO", 2, "lab", False), ("Islamic Education", "ISL", 5, "", False),
    ("Social Studies", "SOC", 2, "", False), ("History", "HIST", 1, "", False), ("Geography", "GEO", 1, "", False),
    ("Computer Science", "CS", 3, "computer_lab", False), ("Physical Education", "PE", 3, "gym", False),
    ("Art", "ART", 3, "", False), ("French", "FR", 1, "", False),
]
PRIMARY_PLAN = {"ARB": (7, 0), "ENG": (5, 0), "MATH": (6, 0), "SCI": (4, 0), "ISL": (3, 0), "SOC": (2, 0),
                "CS": (2, 0), "PE": (2, 0), "ART": (3, 1)}
SECONDARY_PLAN = {"ARB": (5, 0), "ENG": (5, 0), "MATH": (6, 0), "PHY": (3, 1), "CHEM": (3, 1), "BIO": (2, 0),
                  "ISL": (3, 0), "HIST": (2, 0), "GEO": (1, 0), "CS": (2, 0), "PE": (1, 0), "FR": (1, 0)}
SECOND_SUBJECT = {"SCI": "BIO", "PHY": "SCI", "CHEM": "SCI", "HIST": "SOC", "GEO": "SOC", "SOC": "HIST"}

BOYS = ["Ahmad", "Mohammad", "Omar", "Khaled", "Yousef", "Ali", "Hamza", "Tareq", "Sami", "Rami", "Laith", "Zaid",
        "Faris", "Majed", "Nabil", "Hani", "Basel", "Ibrahim", "Mahmoud", "Saleh", "Yazan", "Karam", "Anas", "Qais"]
GIRLS = ["Rania", "Lina", "Dana", "Sara", "Hala", "Noor", "Reem", "Maha", "Huda", "Aseel", "Rawan", "Farah",
         "Yasmin", "Leen", "Abeer", "Dima", "Ruba", "Tala", "Mais", "Nadia", "Jana", "Salma", "Joud", "Lama"]
LAST = ["Haddad", "Khalil", "Nasser", "Saleh", "Masri", "Qasem", "Hamdan", "Abbadi", "Zoubi", "Tamimi", "Shami",
        "Odeh", "Khatib", "Jaber", "Rawashdeh", "Majali", "Smadi", "Bataineh", "Fayez", "Amro", "Daher", "Hijazi"]
# Amman neighbourhoods around a school in Khalda: (name, lat, lng)
AMMAN_AREAS = [("Khalda", 31.9985, 35.8357), ("Tla' Al-Ali", 31.9905, 35.8620), ("Sweileh", 32.0215, 35.8410),
               ("Dabouq", 31.9850, 35.8170), ("Um Uthaina", 31.9725, 35.8655), ("Al-Jubeiha", 32.0185, 35.8690),
               ("Abu Nseir", 32.0510, 35.8780), ("Shmeisani", 31.9690, 35.9005), ("Al-Rabieh", 31.9790, 35.8810)]
AMMAN_SCHOOL = (31.9973, 35.8335)
IRBID_SCHOOL = (32.5556, 35.8500)


class Command(BaseCommand):
    help = "Create the two demo schools with data in every module and one login per role."

    def add_arguments(self, parser):
        parser.add_argument("--if-missing", action="store_true")
        parser.add_argument("--skip-solvers", action="store_true", help="Do not run the timetable/bus optimizers")
        parser.add_argument("--small", action="store_true", help="Fewer grades (fast, for tests)")

    def handle(self, *args, **options):
        marker = f"demo_seed_v{DEMO_VERSION}"
        if options["if_missing"]:
            if os.getenv("SEED_DEMO", "").lower() not in ("1", "true", "yes"):
                self.stdout.write("SEED_DEMO is not enabled; skipping demo seed.")
                return
            if TaskLock.objects.filter(name=marker).exists():
                self.stdout.write("Demo data already seeded; skipping.")
                return
        self.password = os.getenv("DEMO_PASSWORD", DEFAULT_DEMO_PASSWORD)
        self.rng = random.Random(2026)
        self.today = timezone.localdate()
        self.solvers = not options["skip_solvers"]
        self.small = options["small"]
        self.owner()
        users = {k: self.user(v, k) for k, v in EMAILS.items()}
        School.objects.filter(name__in=[DEMO_SCHOOL_NAME, IRBID_SCHOOL_NAME],
                              user__username__in=[EMAILS["admin"], EMAILS["irbid_admin"]]).delete()
        amman = self.build_amman(users)
        irbid = self.build_irbid(users)
        TaskLock.objects.update_or_create(name=marker, defaults={"last_run": timezone.now()})
        self.stdout.write(self.style.SUCCESS(
            f"Demo ready: {amman.name} ({amman.students.count()} students) and {irbid.name} "
            f"({irbid.students.count()} students). Logins: " + ", ".join(EMAILS.values())))

    # ------------------------------------------------------------------ accounts
    def user(self, email, key):
        first = {"admin": "Huda", "staff": "Rana", "teacher": "Sami", "parent": "Omar", "driver": "Abu Khaled",
                 "irbid_admin": "Nidal"}.get(key, "Demo")
        last = {"admin": "Al-Majali", "staff": "Odeh", "teacher": "Haddad", "parent": "Khalil", "driver": "Zoubi",
                "irbid_admin": "Bataineh"}.get(key, "")
        u, _ = User.objects.get_or_create(username=email, defaults={"email": email})
        u.email, u.first_name, u.last_name = email, first, last
        u.set_password(self.password)
        u.save()
        UserProfile.objects.get_or_create(user=u, defaults={"language": "ar" if key in ("parent", "driver") else "en"})
        return u

    def owner(self):
        email, password = os.getenv("PLATFORM_OWNER_EMAIL"), os.getenv("PLATFORM_OWNER_PASSWORD")
        if not email or not password:
            return
        u, _ = User.objects.get_or_create(username=email, defaults={"email": email})
        u.is_superuser = u.is_staff = True
        u.email = email
        u.set_password(password)
        u.save()

    # ------------------------------------------------------------------ Amman
    def build_amman(self, users):
        rng = self.rng
        with transaction.atomic():
            school = School.objects.create(
                name=DEMO_SCHOOL_NAME, address="Al-Khalda, Wasfi Al-Tal St., Amman", established_year=1998,
                principal_name="Dr. Huda Al-Majali", user=users["admin"], city="Amman", phone="+962 6 553 0000",
                email="info@amman-demo.edu.jo", brand_color="#1d4ed8", currency="JOD", default_language="ar",
                attendance_mode="day", latitude=AMMAN_SCHOOL[0], longitude=AMMAN_SCHOOL[1],
                grading_scale=[{"min": 90, "label": "A"}, {"min": 80, "label": "B"}, {"min": 70, "label": "C"},
                               {"min": 60, "label": "D"}, {"min": 50, "label": "E"}, {"min": 0, "label": "F"}],
                plan=Plan.objects.get(code="premium"), status="active",
            )
            Membership.objects.get_or_create(user=users["staff"], school=school, role="staff")
            subjects = self.subjects(school)
            rooms = self.rooms(school, homes=30, labs=4, computer=3, gyms=2)
            groups = self.groups(school, rooms, subjects, grades=range(3, 8) if self.small else range(1, 11),
                                 sections="AB" if self.small else "ABC")
            teachers = self.teachers(school, subjects, SUBJECTS)
            schedule, lessons = self.schedule(school)
            self.availability(teachers, lessons, part_timers=6)
            tt = Timetable.objects.create(schedule=schedule, school=school, name="2026/2027 Semester 1",
                                          effective_date_start=date(2026, 9, 1), effective_date_end=date(2027, 1, 15))
            math_teacher = next(t for t in teachers if t.subjects.filter(code="MATH").exists())
            math_teacher.user, math_teacher.email = users["teacher"], users["teacher"].email
            math_teacher.save()
            Membership.objects.get_or_create(user=users["teacher"], school=school, role="teacher")
        self.timetable(tt, 45)
        with transaction.atomic():
            families = self.students(school, groups, areas=AMMAN_AREAS, bus_share=0.22)
            parent_kids = self.demo_parent(school, users["parent"], groups, ["Grade 3-A", "Grade 7-B"], area=AMMAN_AREAS[1])
            self.academics(school, groups, subjects)
            self.attendance(school)
            self.communication(school, users)
            self.fees(school)
            self.admissions(school)
            self.daily(school, users, parent_kids)
        self.transport(school, users["driver"])
        return school

    # ------------------------------------------------------------------ Irbid (second tenant)
    def build_irbid(self, users):
        with transaction.atomic():
            school = School.objects.create(
                name=IRBID_SCHOOL_NAME, address="University St., Irbid", established_year=2005,
                principal_name="Mr. Nidal Bataineh", user=users["irbid_admin"], city="Irbid", phone="+962 2 727 0000",
                brand_color="#059669", currency="JOD", default_language="ar", attendance_mode="day",
                latitude=IRBID_SCHOOL[0], longitude=IRBID_SCHOOL[1],
                grading_scale=[{"min": 85, "label": "Excellent"}, {"min": 70, "label": "Very good"},
                               {"min": 50, "label": "Pass"}, {"min": 0, "label": "Fail"}],
                plan=Plan.objects.get(code="standard"), status="active",
            )
            subjects = self.subjects(school, only=["ARB", "ENG", "MATH", "SCI", "ISL", "SOC", "CS", "PE", "ART"])
            rooms = self.rooms(school, homes=6, labs=0, computer=1, gyms=1)
            groups = self.groups(school, rooms, subjects, grades=range(1, 5) if self.small else range(1, 7), sections="A")
            spec = [(n, c, max(1, k // 4), rt, h) for n, c, k, rt, h in SUBJECTS if c in subjects]
            teachers = self.teachers(school, subjects, spec)
            schedule, lessons = self.schedule(school)
            self.availability(teachers, lessons, part_timers=1)
            tt = Timetable.objects.create(schedule=schedule, school=school, name="2026/2027",
                                          effective_date_start=date(2026, 9, 1), effective_date_end=date(2027, 6, 15))
        self.timetable(tt, 20)
        with transaction.atomic():
            self.students(school, groups, areas=[("Irbid", 32.5500, 35.8550), ("Al-Husn", 32.4880, 35.8800)],
                          bus_share=0.0)
            kid = self.make_student(school, groups[3], "Leen", "Khalil", "F", None)
            from ops.models import Guardian, StudentGuardian
            g = Guardian.objects.create(school=school, name="Omar Khalil", phone="0791000001",
                                        email=users["parent"].email, relation="Father", user=users["parent"])
            StudentGuardian.objects.create(student=kid, guardian=g, is_primary=True)
            Membership.objects.get_or_create(user=users["parent"], school=school, role="parent")
            from ops.models import Announcement, Term
            Term.objects.create(school=school, name="Term 1", start_date=date(2026, 9, 1), end_date=date(2027, 1, 15))
            a = Announcement.objects.create(school=school, author=users["irbid_admin"], audience="school",
                                            title="Welcome to Irbid Demo School",
                                            body="This is a separate school: its data never mixes with Amman's.")
        from ops.views.comms import dispatch_announcement
        with override_settings(NOTIFY_SYNC=True):
            dispatch_announcement(a)
        return school

    # ------------------------------------------------------------------ building blocks
    def subjects(self, school, only=None):
        return {code: Subject.objects.create(school=school, name=name, code=code, description=f"{name} curriculum",
                                             requires_room_type=rt, is_heavy=heavy)
                for name, code, _, rt, heavy in SUBJECTS if only is None or code in only}

    def rooms(self, school, homes, labs, computer, gyms):
        rooms = [Classroom(school=school, name=f"Room {100 + i}", capacity=32) for i in range(1, homes + 1)]
        rooms += [Classroom(school=school, name=f"Science Lab {i}", capacity=30, room_type="lab") for i in range(1, labs + 1)]
        rooms += [Classroom(school=school, name=f"Computer Lab {i}", capacity=30, room_type="computer_lab")
                  for i in range(1, computer + 1)]
        rooms += [Classroom(school=school, name=n, capacity=60, room_type="gym")
                  for n in ["Sports Hall", "Outdoor Court"][:gyms]]
        return Classroom.objects.bulk_create(rooms)

    def groups(self, school, rooms, subjects, grades, sections):
        groups, homes = [], iter(r for r in rooms if r.room_type == "regular")
        for grade in grades:
            plan = PRIMARY_PLAN if grade <= 6 else SECONDARY_PLAN
            for section in sections:
                g = StudentGroup.objects.create(school=school, classroom=next(homes), name=f"Grade {grade}-{section}",
                                                description=f"Grade {grade}, section {section}", grade_level=grade,
                                                size=self.rng.randint(24, 30))
                SubjectRequirement.objects.bulk_create([
                    SubjectRequirement(student_group=g, subject=subjects[c], lectures_per_week=n,
                                       double_periods_per_week=d)
                    for c, (n, d) in plan.items() if c in subjects])
                groups.append(g)
        return groups

    def teachers(self, school, subjects, spec):
        rng, out, names = self.rng, [], set()
        for _, code, count, _, _ in spec:
            if code not in subjects:
                continue
            for _ in range(count):
                while True:
                    female = rng.random() < 0.55
                    name = f"{rng.choice(GIRLS if female else BOYS)} {rng.choice(LAST)}"
                    if name not in names:
                        names.add(name)
                        break
                t = Teacher.objects.create(school=school, name=name, experience=rng.randint(1, 25),
                                           max_lessons_per_day=6, phone=f"079{rng.randint(1000000, 9999999)}")
                t.subjects.add(subjects[code])
                if code in SECOND_SUBJECT and SECOND_SUBJECT[code] in subjects:
                    t.subjects.add(subjects[SECOND_SUBJECT[code]])
                out.append(t)
        return out

    def schedule(self, school):
        sched = Schedule.objects.create(school=school, name="Main Schedule (Sun-Thu)")
        layout = [("Lesson 1", time(7, 45), time(8, 30), "lecture"), ("Lesson 2", time(8, 30), time(9, 15), "lecture"),
                  ("Lesson 3", time(9, 15), time(10, 0), "lecture"), ("Break 1", time(10, 0), time(10, 20), "break"),
                  ("Lesson 4", time(10, 20), time(11, 5), "lecture"), ("Lesson 5", time(11, 5), time(11, 50), "lecture"),
                  ("Break 2", time(11, 50), time(12, 5), "break"), ("Lesson 6", time(12, 5), time(12, 50), "lecture"),
                  ("Lesson 7", time(12, 50), time(13, 35), "lecture")]
        periods = SchedulePeriod.objects.bulk_create([
            SchedulePeriod(schedule=sched, name=n, start_time=s, end_time=e, type=t, order=i)
            for i, (n, s, e, t) in enumerate(layout, start=1)])
        return sched, [p for p in periods if p.type == "lecture"]

    def availability(self, teachers, lessons, part_timers):
        part = {t.id for t in self.rng.sample(teachers, min(part_timers, len(teachers)))}
        TeacherAvailablePeriod.objects.bulk_create([
            TeacherAvailablePeriod(teacher=t, period=p) for t in teachers for p in lessons
            if not (t.id in part and p.order >= 8)])

    def timetable(self, tt, seconds):
        if not self.solvers:
            return
        from api.timetable_jobs import start_job
        with override_settings(TIMETABLE_JOBS_SYNC=True):
            job = start_job(tt, None, {"time_limit": seconds})
        self.stdout.write(f"  {tt.school.name}: timetable {job.status} - {job.message}")

    def make_student(self, school, group, first, last, gender, home, bus=False, number=None):
        from ops.models import Student
        return Student.objects.create(
            school=school, group=group, first_name=first, last_name=last, gender=gender,
            student_number=number or f"S{school.id}-{self.rng.randint(10000, 99999)}",
            date_of_birth=date(2026 - 6 - (group.grade_level or 1), self.rng.randint(1, 12), self.rng.randint(1, 28)),
            home_lat=home[0] if home else None, home_lng=home[1] if home else None,
            home_address=home[2] if home else "", uses_bus_morning=bus, uses_bus_afternoon=bus,
            emergency_contact_phone=f"079{self.rng.randint(1000000, 9999999)}",
            allergies=self.rng.choice(["", "", "", "", "", "Peanuts", "Penicillin", "Lactose"]),
            medical_notes=self.rng.choice(["", "", "", "", "", "", "Asthma - inhaler in bag", "Wears glasses"]))

    def home_in(self, area):
        name, lat, lng = area
        return (lat + self.rng.uniform(-0.006, 0.006), lng + self.rng.uniform(-0.007, 0.007),
                f"{name}, Street {self.rng.randint(1, 60)}, Building {self.rng.randint(1, 40)}")

    def students(self, school, groups, areas, bus_share):
        from ops.models import Guardian, StudentGuardian
        rng = self.rng
        families = []
        seats = {g.id: g.size for g in groups}
        for g in groups:
            while seats[g.id] > 0:
                last = rng.choice(LAST)
                area = rng.choice(areas)
                home = self.home_in(area)
                bus = rng.random() < bus_share
                father = Guardian.objects.create(school=school, name=f"{rng.choice(BOYS)} {last}", relation="Father",
                                                 phone=f"079{rng.randint(1000000, 9999999)}")
                kids = []
                siblings = 1 + (rng.random() < 0.25)
                for k in range(siblings):
                    target = g if k == 0 else rng.choice(groups)
                    if seats[target.id] <= 0:
                        continue
                    seats[target.id] -= 1
                    female = rng.random() < 0.5
                    kid = self.make_student(school, target, rng.choice(GIRLS if female else BOYS), last,
                                            "F" if female else "M", home, bus)
                    StudentGuardian.objects.create(student=kid, guardian=father, is_primary=True)
                    kids.append(kid)
                families.append((father, kids))
        return families

    def demo_parent(self, school, parent_user, groups, group_names, area):
        from ops.models import Guardian, StudentGuardian
        by_name = {g.name: g for g in groups}
        home = (area[1] + 0.002, area[2] + 0.001, f"{area[0]}, Al-Madina Al-Riyadiya St., Building 12")
        g = Guardian.objects.create(school=school, name="Omar Khalil", relation="Father", phone="0791000001",
                                    email=parent_user.email, user=parent_user)
        mother = Guardian.objects.create(school=school, name="Rania Khalil", relation="Mother", phone="0791000002")
        kids = [self.make_student(school, by_name[group_names[0]], "Yazan", "Khalil", "M", home, bus=True,
                                  number="S-DEMO-1"),
                self.make_student(school, by_name[group_names[1]], "Tala", "Khalil", "F", home, bus=False,
                                  number="S-DEMO-2")]
        for k in kids:
            StudentGuardian.objects.create(student=k, guardian=g, is_primary=True)
            StudentGuardian.objects.create(student=k, guardian=mother)
            k.pickup_permissions = [{"name": "Rania Khalil", "relation": "Mother", "phone": "0791000002"},
                                    {"name": "Sami Khalil", "relation": "Uncle", "phone": "0791000003"}]
            k.save(update_fields=["pickup_permissions"])
        Membership.objects.get_or_create(user=parent_user, school=school, role="parent")
        return kids

    def school_days(self, n):
        days, d = [], self.today - timedelta(days=1)
        while len(days) < n:
            if d.isoweekday() in (7, 1, 2, 3, 4):
                days.append(d)
            d -= timedelta(days=1)
        return sorted(days)

    def academics(self, school, groups, subjects):
        from ops.models import Assessment, Grade, Homework, Student, Term
        rng = self.rng
        t1 = Term.objects.create(school=school, name="Term 1", start_date=date(2026, 9, 1), end_date=date(2027, 1, 15))
        Term.objects.create(school=school, name="Term 2", start_date=date(2027, 2, 1), end_date=date(2027, 6, 15))
        tt = Timetable.objects.filter(school=school).first()
        teacher_of = {}
        if tt:
            for e in tt.entries.all():
                teacher_of[(e.student_group_id, e.subject_id)] = e.teacher_id
        weak = set(Student.objects.filter(school=school).order_by("?").values_list("id", flat=True)[:12])
        grades = []
        for g in groups:
            students = list(Student.objects.filter(group=g))
            for code in ("MATH", "ENG", "ARB"):
                subj = subjects.get(code)
                if not subj:
                    continue
                for i, (name, d) in enumerate([("Quiz 1", date(2026, 9, 24)), ("Quiz 2", date(2026, 10, 8)),
                                               ("Midterm", date(2026, 10, 20))]):
                    if d > self.today:
                        continue
                    a = Assessment.objects.create(school=school, term=t1, group=g, subject=subj, name=name, date=d,
                                                  max_score=100 if name == "Midterm" else 20,
                                                  weight=2 if name == "Midterm" else 1,
                                                  teacher_id=teacher_of.get((g.id, subj.id)))
                    for s in students:
                        base = rng.gauss(78, 11)
                        if s.id in weak:
                            base = 72 - 18 * i    # falling grades -> at-risk flag
                        pct = max(5, min(100, base))
                        grades.append(Grade(assessment=a, student=s, score=round(Decimal(pct) * a.max_score / 100, 1)))
        Grade.objects.bulk_create(grades)
        start = self.today - timedelta(days=(self.today.isoweekday() % 7))
        hw = []
        for g in groups:
            for code, title in (("MATH", "Exercises page 34, questions 1-10"), ("ENG", "Read chapter 3 and summarise"),
                                ("ARB", "Write a paragraph about your family")):
                if code in subjects:
                    hw.append(Homework(school=school, group=g, subject=subjects[code], title=title,
                                       teacher_id=teacher_of.get((g.id, subjects[code].id)),
                                       assigned_date=start + timedelta(days=rng.randint(0, 2)),
                                       due_date=start + timedelta(days=rng.randint(3, 4))))
        Homework.objects.bulk_create(hw)

    def attendance(self, school):
        from ops.models import AttendanceRecord, Student
        rng = self.rng
        students = list(Student.objects.filter(school=school))
        chronic = {s.id for s in rng.sample(students, 10)}
        rows = []
        for d in self.school_days(20):
            for s in students:
                p_absent = 0.28 if s.id in chronic else 0.04
                r = rng.random()
                status = "absent" if r < p_absent else "late" if r < p_absent + 0.02 else "present"
                rows.append(AttendanceRecord(school=school, student=s, date=d, period=None, status=status,
                                             parent_notified=True))
        AttendanceRecord.objects.bulk_create(rows, batch_size=2000)

    def communication(self, school, users):
        from ops.models import FAQ, Announcement, CalendarEvent
        from ops.views.comms import dispatch_announcement
        CalendarEvent.objects.bulk_create([
            CalendarEvent(school=school, title="First day of school", kind="term", start_date=date(2026, 9, 1), end_date=date(2026, 9, 1)),
            CalendarEvent(school=school, title="Midterm exams", kind="exam", start_date=date(2026, 11, 8), end_date=date(2026, 11, 12)),
            CalendarEvent(school=school, title="Parents' evening", kind="event", start_date=date(2026, 11, 19), end_date=date(2026, 11, 19)),
            CalendarEvent(school=school, title="Christmas holiday", kind="holiday", start_date=date(2026, 12, 25), end_date=date(2026, 12, 25)),
            CalendarEvent(school=school, title="New Year's Day", kind="holiday", start_date=date(2027, 1, 1), end_date=date(2027, 1, 1)),
            CalendarEvent(school=school, title="End of Term 1", kind="term", start_date=date(2027, 1, 15), end_date=date(2027, 1, 15)),
            CalendarEvent(school=school, title="Grade 5 trip to Ajloun", kind="event", grade_level=5,
                          start_date=self.today + timedelta(days=9), end_date=self.today + timedelta(days=9)),
        ])
        FAQ.objects.bulk_create([
            FAQ(school=school, order=1, question="What time does school start and finish?",
                answer="Lessons start at 7:45 and finish at 13:35, Sunday to Thursday. Buses arrive by 7:35."),
            FAQ(school=school, order=2, question="How do I report that my child will be absent?",
                answer="Open your child's page in the app and choose 'Report absence'. The class teacher sees it immediately."),
            FAQ(school=school, order=3, question="How can I pay the fees?",
                answer="Pay in cash or by bank transfer at the school office. You'll get a receipt in the app."),
            FAQ(school=school, order=4, question="Who can pick up my child?",
                answer="Only the people on your child's pickup list. You can tell us each day who is coming in 'Pickup'."),
            FAQ(school=school, order=5, question="Why can I only see the bus on the map sometimes?",
                answer="For privacy, the bus location is shown only while the route is running."),
            FAQ(school=school, order=6, question="My child has an allergy. Who should I tell?",
                answer="Tell the office; it is added to your child's file, which only school staff can see."),
        ])
        msgs = [
            ("Welcome to the 2026/2027 school year", "school", None,
             "Welcome back! Please check the timetable, bus times and fee schedule in the app."),
            ("Grade 5 trip to Ajloun", "grade", 5, "Grade 5 visits Ajloun Castle next week. Please send a packed lunch."),
            ("Parents' evening on 19 November", "parents", None, "Meet your children's teachers from 16:00 to 19:00."),
        ]
        for title, aud, grade, body in msgs:
            a = Announcement.objects.create(school=school, author=users["admin"], title=title, body=body,
                                            audience=aud, grade_level=grade)
            with override_settings(NOTIFY_SYNC=True):
                dispatch_announcement(a)
        Announcement.objects.create(school=school, author=users["admin"], title="Exam timetable published",
                                    body="The midterm exam timetable is now in the app.", audience="school",
                                    publish_at=timezone.now() + timedelta(days=2))

    def fees(self, school):
        from ops.models import FeePlan, Installment, Payment, Student, StudentFee
        from ops.views.fees import next_receipt_number, reallocate
        rng = self.rng
        dues = [date(2026, 9, 15), date(2026, 11, 15), date(2027, 2, 1), date(2027, 4, 1)]

        def items(tuition, books):
            q = Decimal(tuition) / 4
            return [{"category": "tuition", "description": "Tuition 2026/27", "amount": str(tuition),
                     "installments": [{"due_date": str(d), "amount": str(q)} for d in dues]},
                    {"category": "books", "description": "Books & materials", "amount": str(books),
                     "due_date": str(dues[0])}]
        primary = FeePlan.objects.create(school=school, name="Grades 1-6 2026/27", items=items(2400, 120))
        secondary = FeePlan.objects.create(school=school, name="Grades 7-10 2026/27", items=items(3200, 160))
        for s in Student.objects.filter(school=school).select_related("group"):
            plan = primary if (s.group.grade_level or 1) <= 6 else secondary
            for it in plan.items:
                fee = StudentFee.objects.create(school=school, student=s, plan=plan, category=it["category"],
                                                description=it["description"], amount=Decimal(it["amount"]))
                for x in it.get("installments") or [{"due_date": it["due_date"], "amount": it["amount"]}]:
                    Installment.objects.create(fee=fee, due_date=x["due_date"], amount=Decimal(x["amount"]))
            if s.uses_bus_morning:
                fee = StudentFee.objects.create(school=school, student=s, category="bus", description="School bus 2026/27",
                                                amount=Decimal("450"))
                Installment.objects.create(fee=fee, due_date=dues[0], amount=Decimal("225"))
                Installment.objects.create(fee=fee, due_date=dues[2], amount=Decimal("225"))
            r = rng.random()
            paid = Decimal(0)
            if r < 0.6:
                paid = sum((i.amount for i in Installment.objects.filter(fee__student=s, due_date__lte=self.today)),
                           Decimal(0))
            elif r < 0.8:
                paid = Decimal(rng.choice([300, 500, 650]))
            if paid > 0:
                Payment.objects.create(school=school, student=s, amount=paid, date=date(2026, 9, rng.randint(5, 20)),
                                       method=rng.choice(["cash", "transfer", "transfer", "cheque"]),
                                       receipt_number=next_receipt_number(school))
            reallocate(s)

    def admissions(self, school):
        from ops.models import Applicant
        rng = self.rng
        stages = ["inquiry", "inquiry", "placement_test", "placement_test", "documents", "accepted", "rejected", "inquiry"]
        for i, stage in enumerate(stages):
            first = rng.choice(BOYS + GIRLS)
            last = rng.choice(LAST)
            Applicant.objects.create(
                school=school, child_name=f"{first} {last}", grade_applying=rng.randint(1, 9),
                guardian_name=f"{rng.choice(BOYS)} {last}", guardian_phone=f"079{rng.randint(1000000, 9999999)}",
                stage=stage, source=rng.choice(["Website", "Referral", "Walk-in", "Facebook"]),
                next_follow_up=self.today + timedelta(days=rng.randint(-3, 7)) if stage not in ("rejected",) else None,
                test_score=rng.randint(55, 95) if stage in ("documents", "accepted") else None,
                documents={"birth_certificate": stage in ("documents", "accepted"), "previous_report": stage == "accepted"},
                notes="Interested in the bus service." if i % 3 == 0 else "")

    def daily(self, school, users, parent_kids):
        from ops.models import Message, MessageThread, PickupNotice, TeacherAbsence
        teacher = Teacher.objects.filter(school=school, user__isnull=True).order_by("id")[3]
        if self.today.isoweekday() in school.week_day_list:
            TeacherAbsence.objects.create(school=school, teacher=teacher, date=self.today, reason="Sick leave",
                                          created_by=users["admin"])
        PickupNotice.objects.create(school=school, student=parent_kids[1], date=self.today, mode="other",
                                    person_name="Sami Khalil", note="Uncle picks up today", created_by=users["parent"])
        t = MessageThread.objects.create(school=school, parent=users["parent"], student=parent_kids[0],
                                         subject="Bus arrival time")
        Message.objects.create(thread=t, author=users["parent"], body="What time does the bus reach Tla' Al-Ali?")
        Message.objects.create(thread=t, author=users["staff"],
                               body="Around 7:05. You can follow it live in the app while it is on the way.")

    def transport(self, school, driver):
        from transport.models import Bus, ManualRoute, TransportSettings
        from transport.services import plan_routes
        from ops.models import Student
        Membership.objects.get_or_create(user=driver, school=school, role="driver")
        TransportSettings.objects.create(school=school, provider="osrm", solver_seconds=15, max_ride_minutes=60,
                                         stop_minutes=0.75, school_start_time=time(7, 45))
        buses = []
        for i in range(1, 11):
            buses.append(Bus.objects.create(school=school, name=f"Bus {i}", plate=f"20-{30000 + i * 17}",
                                            capacity=30 if i <= 6 else 26, driver=driver if i == 1 else None,
                                            driver_name="Abu Khaled Zoubi" if i == 1 else f"Driver {i}",
                                            driver_phone=f"07955500{i:02d}", fuel_l_per_100km=18 if i <= 6 else 15,
                                            fuel_price_per_l=Decimal("0.900")))
        # "Before" routes as a coordinator would draw them by hand: children grouped by neighbourhood and street.
        riders = sorted(Student.objects.filter(school=school, uses_bus_morning=True),
                        key=lambda s: (s.home_address.split(",")[0], int(s.home_address.split("Street ")[1].split(",")[0])
                                       if "Street " in s.home_address else 0))
        per_bus = max(1, -(-len(riders) // len(buses)))
        for i, bus in enumerate(buses):
            chunk = riders[i * per_bus:(i + 1) * per_bus]
            for direction in ("morning", "afternoon"):
                ManualRoute.objects.create(school=school, bus=bus, direction=direction, student_order=[s.id for s in chunk])
        if not self.solvers:
            return
        for direction in ("morning", "afternoon"):
            plans = plan_routes(school, direction, None, None)
            for p in plans:
                self.stdout.write(f"  bus plan {direction} {p.summary.get('anchor')}: {p.status}, "
                                  f"{p.summary.get('buses_used')} buses, {p.summary.get('totals')}, "
                                  f"provider {p.summary.get('provider')}")
