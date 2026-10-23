"""
python manage.py seed_demo

Creates (or recreates) one realistic demo school in Amman plus the demo login(s).
Safe to run repeatedly: the previous demo school is deleted first. Deterministic.
"""
import os
import random
from datetime import date, time

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction

from api.models import (
    School, Classroom, StudentGroup, Subject, SubjectRequirement, Teacher,
    Schedule, SchedulePeriod, TeacherAvailablePeriod, Timetable,
)

User = get_user_model()

DEMO_SCHOOL_NAME = "Amman Demo School"
DEMO_ADMIN_EMAIL = "admin@demo.mytimetablepal.com"
DEFAULT_DEMO_PASSWORD = "DemoSchool-2026"

# (name, code suffix, number of teachers, room type needed, heavy = prefer mornings)
SUBJECTS = [
    ("Arabic", "ARB", 9, "", False),
    ("English", "ENG", 8, "", False),
    ("Mathematics", "MATH", 9, "", True),
    ("Science", "SCI", 4, "", False),
    ("Physics", "PHY", 2, "lab", True),
    ("Chemistry", "CHEM", 2, "lab", True),
    ("Biology", "BIO", 2, "lab", False),
    ("Islamic Education", "ISL", 5, "", False),
    ("Social Studies", "SOC", 2, "", False),
    ("History", "HIST", 1, "", False),
    ("Geography", "GEO", 1, "", False),
    ("Computer Science", "CS", 3, "computer_lab", False),
    ("Physical Education", "PE", 3, "gym", False),
    ("Art", "ART", 3, "", False),
    ("French", "FR", 1, "", False),
]

# Weekly (lessons, double periods) per subject code - 34 of the 35 weekly slots.
PRIMARY_PLAN = {"ARB": (7, 0), "ENG": (5, 0), "MATH": (6, 0), "SCI": (4, 0), "ISL": (3, 0), "SOC": (2, 0),
                "CS": (2, 0), "PE": (2, 0), "ART": (3, 1)}
SECONDARY_PLAN = {
    "ARB": (5, 0), "ENG": (5, 0), "MATH": (6, 0), "PHY": (3, 1), "CHEM": (3, 1), "BIO": (2, 0), "ISL": (3, 0),
    "HIST": (2, 0), "GEO": (1, 0), "CS": (2, 0), "PE": (1, 0), "FR": (1, 0),
}

FIRST_NAMES = [
    "Ahmad", "Mohammad", "Omar", "Khaled", "Yousef", "Ali", "Hamza", "Tareq", "Sami", "Rami",
    "Laith", "Zaid", "Faris", "Majed", "Nabil", "Hani", "Basel", "Ibrahim", "Mahmoud", "Saleh",
    "Rania", "Lina", "Dana", "Sara", "Hala", "Noor", "Reem", "Maha", "Huda", "Aseel",
    "Rawan", "Farah", "Yasmin", "Leen", "Abeer", "Dima", "Ruba", "Tala", "Mais", "Nadia",
]
LAST_NAMES = [
    "Haddad", "Khalil", "Nasser", "Saleh", "Masri", "Qasem", "Hamdan", "Abbadi", "Zoubi", "Tamimi",
    "Shami", "Odeh", "Khatib", "Jaber", "Rawashdeh", "Majali", "Smadi", "Bataineh", "Fayez", "Amro",
]


class Command(BaseCommand):
    help = "Create the demo school, its timetable data and the demo login(s)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--if-missing",
            action="store_true",
            help="Deploy mode: do nothing unless SEED_DEMO=true and the demo school does not exist yet.",
        )

    def handle(self, *args, **options):
        if options["if_missing"]:
            if os.getenv("SEED_DEMO", "").lower() not in ("1", "true", "yes"):
                self.stdout.write("SEED_DEMO is not enabled; skipping demo seed.")
                return
            if School.objects.filter(user__username=DEMO_ADMIN_EMAIL, name=DEMO_SCHOOL_NAME).exists():
                self.stdout.write("Demo school already exists; skipping demo seed.")
                return

        password = os.getenv("DEMO_PASSWORD", DEFAULT_DEMO_PASSWORD)
        rng = random.Random(2026)

        with transaction.atomic():
            admin = self._user(DEMO_ADMIN_EMAIL, "Demo", "Admin", password)
            School.objects.filter(user=admin, name=DEMO_SCHOOL_NAME).delete()

            school = School.objects.create(
                name=DEMO_SCHOOL_NAME,
                address="Khalda, Amman, Jordan",
                established_year=1998,
                principal_name="Dr. Huda Al-Majali",
                user=admin,
            )
            subjects = self._subjects(school)
            rooms = self._rooms(school)
            groups = self._groups(school, rooms, subjects, rng)
            teachers = self._teachers(school, subjects, rng)
            schedule, lessons = self._schedule(school)
            self._availability(teachers, lessons, rng)
            Timetable.objects.create(
                schedule=schedule,
                school=school,
                name="2026/2027 Semester 1",
                effective_date_start=date(2026, 9, 1),
                effective_date_end=date(2027, 1, 15),
            )

        self.stdout.write(self.style.SUCCESS(
            f"Demo school ready: {len(groups)} groups, {len(teachers)} teachers, "
            f"{len(subjects)} subjects, {len(rooms)} rooms, {len(lessons)} lessons/day.\n"
            f"Admin login: {DEMO_ADMIN_EMAIL}"
        ))

    def _user(self, email, first, last, password):
        user, _ = User.objects.get_or_create(username=email, defaults={"email": email})
        user.email = email
        user.first_name = first
        user.last_name = last
        user.set_password(password)
        user.save()
        return user

    def _subjects(self, school):
        # Subject.code is unique across all schools, so prefix it with the school id.
        return {
            code: Subject.objects.create(
                school=school, name=name, code=code, description=f"{name} curriculum",
                requires_room_type=room_type, is_heavy=heavy,
            )
            for name, code, _, room_type, heavy in SUBJECTS
        }

    def _rooms(self, school):
        rooms = [Classroom(school=school, name=f"Room {100 + i}", capacity=32) for i in range(1, 31)]
        rooms += [Classroom(school=school, name=f"Science Lab {i}", capacity=30, room_type="lab") for i in range(1, 5)]
        rooms += [Classroom(school=school, name=f"Computer Lab {i}", capacity=30, room_type="computer_lab")
                  for i in range(1, 4)]
        rooms += [
            Classroom(school=school, name="Sports Hall", capacity=60, room_type="gym"),
            Classroom(school=school, name="Outdoor Court", capacity=60, room_type="gym"),
        ]
        return Classroom.objects.bulk_create(rooms)

    def _groups(self, school, rooms, subjects, rng):
        groups = []
        home_rooms = iter(rooms[:30])
        for grade in range(1, 11):
            plan = PRIMARY_PLAN if grade <= 6 else SECONDARY_PLAN
            for section in "ABC":
                group = StudentGroup.objects.create(
                    school=school,
                    classroom=next(home_rooms),
                    name=f"Grade {grade}-{section}",
                    description=f"Grade {grade}, section {section}",
                    size=rng.randint(24, 30),
                )
                SubjectRequirement.objects.bulk_create([
                    SubjectRequirement(student_group=group, subject=subjects[code], lectures_per_week=n,
                                       double_periods_per_week=doubles)
                    for code, (n, doubles) in plan.items()
                ])
                groups.append(group)
        return groups

    def _teachers(self, school, subjects, rng):
        teachers = []
        names = set()
        for _, code, count, _, _ in SUBJECTS:
            for _ in range(count):
                while True:
                    name = f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}"
                    if name not in names:
                        names.add(name)
                        break
                teacher = Teacher.objects.create(school=school, name=name, experience=rng.randint(1, 25),
                                                 max_lessons_per_day=6)
                teacher.subjects.add(subjects[code])
                teachers.append((teacher, code))

        # A few teachers are qualified for a related second subject.
        second = {"SCI": "BIO", "PHY": "SCI", "CHEM": "SCI", "HIST": "SOC", "GEO": "SOC", "SOC": "HIST"}
        for teacher, code in teachers:
            if code in second:
                teacher.subjects.add(subjects[second[code]])
        return [t for t, _ in teachers]

    def _schedule(self, school):
        schedule = Schedule.objects.create(school=school, name="Main Schedule (Sun-Thu)")
        layout = [
            ("Lesson 1", time(7, 45), time(8, 30), "lecture"),
            ("Lesson 2", time(8, 30), time(9, 15), "lecture"),
            ("Lesson 3", time(9, 15), time(10, 0), "lecture"),
            ("Break 1", time(10, 0), time(10, 20), "break"),
            ("Lesson 4", time(10, 20), time(11, 5), "lecture"),
            ("Lesson 5", time(11, 5), time(11, 50), "lecture"),
            ("Break 2", time(11, 50), time(12, 5), "break"),
            ("Lesson 6", time(12, 5), time(12, 50), "lecture"),
            ("Lesson 7", time(12, 50), time(13, 35), "lecture"),
        ]
        periods = SchedulePeriod.objects.bulk_create([
            SchedulePeriod(schedule=schedule, name=n, start_time=s, end_time=e, type=t, order=i)
            for i, (n, s, e, t) in enumerate(layout, start=1)
        ])
        return schedule, [p for p in periods if p.type == "lecture"]

    def _availability(self, teachers, lessons, rng):
        # Everyone is available every lesson, except six part-timers who leave before lessons 6-7.
        part_timers = set(t.id for t in rng.sample(teachers, 6))
        rows = []
        for teacher in teachers:
            for period in lessons:
                if teacher.id in part_timers and period.order >= 8:
                    continue
                rows.append(TeacherAvailablePeriod(teacher=teacher, period=period))
        TeacherAvailablePeriod.objects.bulk_create(rows)
