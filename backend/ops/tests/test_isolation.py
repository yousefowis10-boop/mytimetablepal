"""Proof that data never crosses families, roles or schools."""
from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import Membership, Plan
from ops.models import AbsenceReport, MessageThread, Payment, StudentFee

from .factory import build_school, user


def client_for(u):
    c = APIClient()
    c.force_authenticate(u)
    return c


@override_settings(NOTIFY_SYNC=True, TIMETABLE_JOBS_SYNC=True)
class ParentIsolationTests(TestCase):
    def setUp(self):
        self.a = build_school("A")
        self.sid = self.a["school"].id
        self.parent = client_for(self.a["parent"])
        StudentFee.objects.create(school=self.a["school"], student=self.a["other_child"], description="Tuition",
                                  amount=100)

    def test_parent_sees_only_own_children(self):
        data = self.parent.get(f"/api/schools/{self.sid}/my/children/").json()
        names = [c["child"]["full_name"] for c in data["children"]]
        self.assertEqual(names, ["KidA One"])
        child = data["children"][0]["child"]
        self.assertNotIn("medical_notes", child)      # staff-only
        self.assertNotIn("allergies", child)
        self.assertEqual(child["home_address"], "Secret street 1")   # own child's address is fine

    def test_parent_cannot_reach_other_family(self):
        other = self.a["other_child"].id
        for url in [f"/api/schools/{self.sid}/students/{other}/report-card/",
                    f"/api/schools/{self.sid}/students/{other}/fees/",
                    f"/api/schools/{self.sid}/my/children/{other}/timetable/"]:
            with self.subTest(url=url):
                self.assertIn(self.parent.get(url).status_code, (403, 404))
        # Staff-only lists are closed to parents entirely
        for url in ["students", "guardians", "payments", "fees/balances", "attendance/report", "at-risk",
                    "dismissal", "applicants", "audit", "invitations"]:
            with self.subTest(url=url):
                self.assertEqual(self.parent.get(f"/api/schools/{self.sid}/{url}/").status_code, 403)

    def test_parent_cannot_act_for_other_child(self):
        other = self.a["other_child"].id
        res = self.parent.post(f"/api/schools/{self.sid}/absence-reports/",
                               {"student": other, "date_from": "2026-11-01", "date_to": "2026-11-01", "reason": "x"},
                               format="json")
        self.assertEqual(res.status_code, 400)
        res = self.parent.post(f"/api/schools/{self.sid}/my/pickup/",
                               {"student": other, "date": "2026-11-01", "mode": "parent"}, format="json")
        self.assertEqual(res.status_code, 400)
        res = self.parent.post(f"/api/schools/{self.sid}/threads/",
                               {"subject": "Hi", "body": "x", "student": other}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertFalse(AbsenceReport.objects.exists())

    def test_parent_threads_and_reports_are_private(self):
        MessageThread.objects.create(school=self.a["school"], parent=self.a["other_parent"], subject="Private")
        AbsenceReport.objects.create(school=self.a["school"], student=self.a["other_child"],
                                     date_from=timezone.localdate(), date_to=timezone.localdate(), reason="flu")
        self.assertEqual(self.parent.get(f"/api/schools/{self.sid}/threads/").json(), [])
        self.assertEqual(self.parent.get(f"/api/schools/{self.sid}/absence-reports/").json(), [])

    def test_notifications_are_per_user(self):
        from api.notify import notify
        notify(self.a["school"], [self.a["other_parent"]], "test", "For the other parent")
        self.assertEqual(self.parent.get("/api/notifications/").json()["items"], [])


@override_settings(NOTIFY_SYNC=True)
class SchoolIsolationTests(TestCase):
    def setUp(self):
        self.a = build_school("A")
        self.b = build_school("B")

    def test_admin_of_a_cannot_touch_school_b(self):
        c = client_for(self.a["admin"])
        sid = self.b["school"].id
        child = self.b["child"].id
        urls = ["", "students/", f"students/{child}/", "guardians/", "teachers/", "groups/", "timetables/",
                "announcements/", "calendar/", "faqs/", "threads/", "absence-reports/", "teacher-absences/",
                "homework/", "terms/", "assessments/", "exam-periods/", "fee-plans/", "student-fees/", "payments/",
                "applicants/", "dashboard/", "setup/", "invitations/", "audit/", "inbox/", "covers/", "at-risk/",
                "fees/balances/", "dismissal/", f"students/{child}/report-card/", f"students/{child}/fees/",
                "attendance/report/", "export/attendance/", "import/students/", "solver-settings/",
                f"timetables/{self.b['tt'].id}/entries/"]
        for u in urls:
            with self.subTest(url=u):
                self.assertEqual(c.get(f"/api/schools/{sid}/{u}").status_code, 404)
        self.assertEqual(c.post(f"/api/schools/{sid}/students/", {"first_name": "X"}, format="json").status_code, 404)
        self.assertEqual(c.patch(f"/api/schools/{sid}/", {"name": "Hacked"}, format="json").status_code, 404)
        self.assertEqual(c.get(f"/api/timetables/{self.b['tt'].id}/json/").status_code, 404)
        self.assertEqual(c.get(f"/api/groups/{self.b['group'].id}/requirements/").status_code, 404)
        self.assertEqual(c.get(f"/api/periods/{self.b['p1'].id}/teacher_availability/").status_code, 404)
        self.assertEqual([s["id"] for s in c.get("/api/schools/").json()], [self.a["school"].id])

    def test_cannot_reference_other_schools_objects(self):
        c = client_for(self.a["admin"])
        sid = self.a["school"].id
        res = c.post(f"/api/schools/{sid}/students/", {"first_name": "X", "group": self.b["group"].id}, format="json")
        self.assertEqual(res.status_code, 400)
        res = c.post(f"/api/schools/{sid}/payments/", {"student": self.b["child"].id, "amount": "10"}, format="json")
        self.assertEqual(res.status_code, 400)
        res = c.post(f"/api/schools/{sid}/announcements/", {"title": "t", "body": "b", "audience": "guardian",
                                                            "guardian": self.b["guardian"].id}, format="json")
        self.assertEqual(res.status_code, 400)
        res = c.post(f"/api/schools/{sid}/invitations/", {"role": "teacher", "teacher": self.b["teacher"].id},
                     format="json")
        self.assertEqual(res.status_code, 400)
        self.assertFalse(Payment.objects.exists())

    def test_platform_owner_sees_totals_not_children(self):
        owner = user("owner@ex.com")
        owner.is_superuser = True
        owner.save()
        c = client_for(owner)
        data = c.get("/api/platform/schools/").json()
        self.assertEqual(data["totals"]["schools"], 2)
        self.assertEqual({r["students"] for r in data["schools"]}, {2})
        self.assertNotIn("Kid", str(data))     # no children's names anywhere
        self.assertEqual(c.get(f"/api/schools/{self.a['school'].id}/students/").status_code, 404)
        self.assertEqual(client_for(self.a["admin"]).get("/api/platform/schools/").status_code, 403)


@override_settings(NOTIFY_SYNC=True)
class RoleTests(TestCase):
    def setUp(self):
        self.a = build_school("A")
        self.sid = self.a["school"].id

    def test_teacher_limits(self):
        t = client_for(self.a["teacher_user"])
        self.assertEqual(t.get(f"/api/schools/{self.sid}/students/").status_code, 200)
        student = t.get(f"/api/schools/{self.sid}/students/{self.a['child'].id}/").json()
        self.assertEqual(student["medical_notes"], "Asthma")     # staff can see medical notes
        self.assertEqual(t.patch(f"/api/schools/{self.sid}/", {"name": "x"}, format="json").status_code, 403)
        self.assertEqual(t.get(f"/api/schools/{self.sid}/payments/").status_code, 403)
        self.assertEqual(t.post(f"/api/schools/{self.sid}/students/", {"first_name": "X"}, format="json").status_code, 403)
        self.assertEqual(t.get(f"/api/schools/{self.sid}/audit/").status_code, 403)

    def test_driver_and_staff_limits(self):
        d = client_for(self.a["driver"])
        self.assertEqual(d.get(f"/api/schools/{self.sid}/students/").status_code, 403)
        self.assertEqual(d.get(f"/api/schools/{self.sid}/my/children/").status_code, 403)
        s = client_for(self.a["staff"])
        self.assertEqual(s.get(f"/api/schools/{self.sid}/payments/").status_code, 200)
        self.assertEqual(s.patch(f"/api/schools/{self.sid}/", {"name": "x"}, format="json").status_code, 403)
        self.assertEqual(s.get(f"/api/schools/{self.sid}/audit/").status_code, 403)

    def test_suspended_trial_and_modules(self):
        school = self.a["school"]
        admin = client_for(self.a["admin"])
        school.plan = Plan.objects.get(code="basic")
        school.save()
        self.assertEqual(admin.get(f"/api/schools/{self.sid}/payments/").status_code, 403)   # fees not in Basic
        self.assertEqual(admin.get(f"/api/schools/{self.sid}/homework/").status_code, 200)
        school.status, school.trial_ends_at = "trial", timezone.now() - timedelta(days=1)
        school.save()
        self.assertEqual(admin.get(f"/api/schools/{self.sid}/students/").status_code, 200)   # read-only
        self.assertEqual(admin.post(f"/api/schools/{self.sid}/students/", {"first_name": "X"},
                                    format="json").status_code, 403)
        school.status = "suspended"
        school.save()
        self.assertEqual(admin.get(f"/api/schools/{self.sid}/students/").status_code, 403)

    def test_student_limit_from_plan(self):
        plan = Plan.objects.get(code="basic")
        plan.max_students = 2
        plan.save()
        self.a["school"].plan = plan
        self.a["school"].save()
        res = client_for(self.a["admin"]).post(f"/api/schools/{self.sid}/students/", {"first_name": "Third"},
                                               format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("plan allows 2", str(res.json()))
