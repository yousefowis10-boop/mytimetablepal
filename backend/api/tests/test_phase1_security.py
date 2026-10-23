from datetime import date, time
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.models import (
    School, Classroom, StudentGroup, Subject, SubjectRequirement, Teacher,
    Schedule, SchedulePeriod, TeacherAvailablePeriod, Timetable, TimetableEntry,
)

User = get_user_model()


def make_school(owner, label):
    school = School.objects.create(
        name=f"School {label}", address="Amman", established_year=2000, principal_name="P", user=owner
    )
    subject = Subject.objects.create(school=school, name="Math", code=f"MATH-{label}")
    room = Classroom.objects.create(school=school, name=f"Room {label}", capacity=30)
    group = StudentGroup.objects.create(school=school, name=f"Grade 1 {label}", classroom=room)
    SubjectRequirement.objects.create(student_group=group, subject=subject, lectures_per_week=3)
    teacher = Teacher.objects.create(school=school, name=f"Teacher {label}", experience=3)
    teacher.subjects.add(subject)
    schedule = Schedule.objects.create(school=school, name="Main")
    period = SchedulePeriod.objects.create(
        schedule=schedule, name="L1", start_time=time(8), end_time=time(8, 45), type="lecture", order=1
    )
    SchedulePeriod.objects.create(
        schedule=schedule, name="L2", start_time=time(8, 45), end_time=time(9, 30), type="lecture", order=2
    )
    TeacherAvailablePeriod.objects.create(teacher=teacher, period=period)
    timetable = Timetable.objects.create(
        schedule=schedule, school=school, name="TT",
        effective_date_start=date(2026, 9, 1), effective_date_end=date(2027, 1, 1),
    )
    TimetableEntry.objects.create(
        timetable=timetable, student_group=group, day_of_week=7, period=period,
        teacher=teacher, subject=subject, classroom=room,
    )
    return dict(school=school, subject=subject, room=room, group=group, teacher=teacher,
                schedule=schedule, period=period, timetable=timetable)


class CrossSchoolIsolationTests(TestCase):
    """A logged-in user must never read or change another user's school."""

    def setUp(self):
        self.alice = User.objects.create_user("alice@example.com", password="pw-alice-123!")
        self.bob = User.objects.create_user("bob@example.com", password="pw-bob-123!")
        self.a = make_school(self.alice, "A")
        self.b = make_school(self.bob, "B")
        self.client = APIClient()
        self.client.force_authenticate(self.alice)

    def test_school_list_only_shows_own(self):
        res = self.client.get("/api/schools/")
        self.assertEqual([s["id"] for s in res.json()], [self.a["school"].id])

    def test_cannot_read_other_school_or_its_children(self):
        sid = self.b["school"].id
        urls = [
            f"/api/schools/{sid}/",
            f"/api/schools/{sid}/teachers/",
            f"/api/schools/{sid}/groups/",
            f"/api/schools/{sid}/classrooms/",
            f"/api/schools/{sid}/subjects/",
            f"/api/schools/{sid}/schedules/",
            f"/api/schools/{sid}/timetables/",
            f"/api/schools/{sid}/teachers/{self.b['teacher'].id}/availability/",
            f"/api/schools/{sid}/schedules/{self.b['schedule'].id}/periods/",
            f"/api/schools/{sid}/timetables/{self.b['timetable'].id}/entries/",
            f"/api/schools/{sid}/timetables/{self.b['timetable'].id}/json_view/",
            f"/api/groups/{self.b['group'].id}/requirements/",
            f"/api/periods/{self.b['period'].id}/teacher_availability/",
            f"/api/timetables/{self.b['timetable'].id}/json/",
        ]
        for url in urls:
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 404)

    def test_cannot_create_in_other_school(self):
        sid = self.b["school"].id
        res = self.client.post(f"/api/schools/{sid}/classrooms/", {"name": "X", "capacity": 10}, format="json")
        self.assertEqual(res.status_code, 404)
        self.assertFalse(Classroom.objects.filter(name="X").exists())

    def test_cannot_modify_or_delete_other_school(self):
        sid = self.b["school"].id
        self.assertEqual(self.client.delete(f"/api/schools/{sid}/").status_code, 404)
        self.assertEqual(
            self.client.delete(f"/api/schools/{sid}/teachers/{self.b['teacher'].id}/").status_code, 404
        )
        self.assertEqual(
            self.client.post(f"/api/timetables/{self.b['timetable'].id}/generate/").status_code, 404
        )
        self.assertEqual(
            self.client.post(
                f"/api/periods/{self.b['period'].id}/teacher_availability/", {"teachers": []}, format="json"
            ).status_code,
            404,
        )
        self.assertTrue(TeacherAvailablePeriod.objects.filter(period=self.b["period"]).exists())
        self.assertTrue(School.objects.filter(id=sid).exists())

    def test_cannot_link_objects_from_other_school(self):
        sid = self.a["school"].id
        # Teacher in my school with a subject from another school
        res = self.client.post(
            f"/api/schools/{sid}/teachers/",
            {"name": "T", "experience": 1, "subjects": [self.b["subject"].id]}, format="json",
        )
        self.assertEqual(res.status_code, 400)
        # Group pointing at another school's classroom
        res = self.client.post(
            f"/api/schools/{sid}/groups/", {"name": "G", "classroom_id": self.b["room"].id}, format="json"
        )
        self.assertEqual(res.status_code, 400)
        # Requirement using another school's subject
        res = self.client.post(
            f"/api/groups/{self.a['group'].id}/requirements/",
            {"subject": self.b["subject"].id, "lectures_per_week": 2}, format="json",
        )
        self.assertEqual(res.status_code, 400)
        # Availability for a teacher from another school
        res = self.client.post(
            f"/api/periods/{self.a['period'].id}/teacher_availability/",
            {"teachers": [self.b["teacher"].id]}, format="json",
        )
        self.assertEqual(res.status_code, 400)
        # Timetable entry referencing another school's teacher
        res = self.client.post(
            f"/api/schools/{sid}/timetables/{self.a['timetable'].id}/bulk_update_entries/",
            {"entries": [{
                "day_of_week": "Sunday", "period": self.a["period"].id, "teacher": self.b["teacher"].id,
                "subject": self.a["subject"].id, "classroom": self.a["room"].id,
                "student_group": self.a["group"].id,
            }]},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        # The failed bulk update must not have wiped the existing entries
        self.assertEqual(self.a["timetable"].entries.count(), 1)

    def test_unauthenticated_is_rejected(self):
        anon = APIClient()
        self.assertEqual(anon.get("/api/schools/").status_code, 401)
        self.assertEqual(anon.get(f"/api/schools/{self.a['school'].id}/teachers/").status_code, 401)


class OwnSchoolFlowTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("owner@example.com", password="pw-owner-123!")
        self.s = make_school(self.user, "A")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_owner_crud_and_views(self):
        sid = self.s["school"].id
        self.assertEqual(self.client.get(f"/api/schools/{sid}/teachers/").status_code, 200)
        res = self.client.post(f"/api/schools/{sid}/subjects/", {"name": "Art", "code": "ART-1"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(Subject.objects.get(code="ART-1").school_id, sid)

        res = self.client.get(f"/api/timetables/{self.s['timetable'].id}/json/?type=teacher")
        self.assertEqual(res.status_code, 200)
        page = res.json()["pages"][0]
        self.assertEqual(page["title"], f"Teacher: {self.s['teacher'].name}")
        self.assertEqual(page["periods"][0]["days"][0]["subject"], "Math")

    def test_availability_patch_and_delete(self):
        sid, tid = self.s["school"].id, self.s["teacher"].id
        res = self.client.post(
            f"/api/schools/{sid}/teachers/{tid}/availability/",
            {"slot": "Morning", "start_time": "08:00", "end_time": "12:00"}, format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        aid = res.json()["data"]["id"]
        res = self.client.patch(
            f"/api/schools/{sid}/teachers/{tid}/availability/{aid}/", {"slot": "AM"}, format="json"
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(self.client.delete(f"/api/schools/{sid}/teachers/{tid}/availability/{aid}/").status_code, 204)

    @override_settings(TIMETABLE_JOBS_SYNC=True)
    def test_generate_endpoint(self):
        res = self.client.post(f"/api/schools/{self.s['school'].id}/timetables/{self.s['timetable'].id}/generate/",
                               {"time_limit": 10}, format="json")
        self.assertEqual(res.status_code, 202, res.content)
        self.assertEqual(res.json()["status"], "succeeded", res.json())
        self.assertEqual(self.s["timetable"].entries.count(), 3)


class AuthAndHealthTests(TestCase):
    def test_health_is_public(self):
        self.assertEqual(APIClient().get("/api/health/").json(), {"status": "ok"})

    def test_register_and_login(self):
        client = APIClient()
        res = client.post("/api/register/", {
            "email": "new@example.com", "password": "Strong-pass-2026", "first_name": "N", "last_name": "U"
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertNotIn("password", res.json())
        res = client.post("/api/token/", {"username": "new@example.com", "password": "Strong-pass-2026"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertIn("access", res.json())

    def test_register_rejects_weak_password_and_duplicates(self):
        client = APIClient()
        res = client.post("/api/register/", {"email": "w@example.com", "password": "123"}, format="json")
        self.assertEqual(res.status_code, 400)
        User.objects.create_user("dup@example.com", email="dup@example.com", password="x")
        res = client.post("/api/register/", {"email": "dup@example.com", "password": "Strong-pass-2026"}, format="json")
        self.assertEqual(res.status_code, 400)


class SeedDemoTests(TestCase):
    def test_seed_is_repeatable(self):
        call_command("seed_demo", stdout=StringIO())
        call_command("seed_demo", stdout=StringIO())
        school = School.objects.get(name="Amman Demo School")
        self.assertEqual(School.objects.filter(name="Amman Demo School").count(), 1)
        self.assertEqual(school.student_groups.count(), 30)
        self.assertEqual(school.teachers.count(), 55)
        self.assertEqual(school.subjects.count(), 15)
        self.assertEqual(school.classrooms.count(), 39)
        lessons = SchedulePeriod.objects.filter(schedule__school=school, type="lecture").count()
        self.assertEqual(lessons, 7)
        client = APIClient()
        res = client.post("/api/token/", {"username": "admin@demo.mytimetablepal.com",
                                          "password": "DemoSchool-2026"}, format="json")
        self.assertEqual(res.status_code, 200)


class TimetableEntryFormatTests(TestCase):
    def test_entries_use_numeric_day_and_round_trip(self):
        user = User.objects.create_user("fmt@example.com", password="pw-fmt-123!")
        s = make_school(user, "F")
        client = APIClient()
        client.force_authenticate(user)
        base = f"/api/schools/{s['school'].id}/timetables/{s['timetable'].id}"
        entry = client.get(f"{base}/entries/").json()[0]
        self.assertEqual(entry["day_of_week"], 7)
        self.assertEqual(entry["day_name"], "Sunday")
        # What the visual editor sends back must be accepted unchanged.
        payload = {k: entry[k] for k in
                   ("day_of_week", "period", "teacher", "subject", "classroom", "student_group", "covering_teacher")}
        res = client.post(f"{base}/bulk_update_entries/", {"entries": [payload]}, format="json")
        self.assertEqual(res.status_code, 201, res.content)


class SeedIfMissingTests(TestCase):
    def test_if_missing_respects_flag_and_existing_data(self):
        import os
        from unittest import mock
        with mock.patch.dict(os.environ, {"SEED_DEMO": ""}):
            call_command("seed_demo", "--if-missing", stdout=StringIO())
        self.assertFalse(School.objects.exists())
        with mock.patch.dict(os.environ, {"SEED_DEMO": "true"}):
            call_command("seed_demo", "--if-missing", stdout=StringIO())
            school = School.objects.get()
            Classroom.objects.create(school=school, name="Kept", capacity=5)
            call_command("seed_demo", "--if-missing", stdout=StringIO())
        self.assertTrue(Classroom.objects.filter(name="Kept").exists())
