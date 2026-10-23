from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.models import Invitation, Membership, School
from ops.models import Guardian

from .factory import build_school, user


def auth(u):
    c = APIClient()
    c.force_authenticate(u)
    return c


@override_settings(NOTIFY_SYNC=True)
class PlatformTests(TestCase):
    def test_school_signup_starts_trial_and_checklist(self):
        c = APIClient()
        res = c.post("/api/signup/school/", {"school_name": "Al-Noor School", "city": "Irbid", "first_name": "Huda",
                                             "email": "huda@noor.jo", "password": "Noor-school-2026"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        school = School.objects.get(name="Al-Noor School")
        self.assertEqual(school.status, "trial")
        self.assertTrue(school.plan.is_trial)
        c.credentials(HTTP_AUTHORIZATION=f"Bearer {res.json()['access']}")
        me = c.get("/api/me/").json()
        self.assertEqual(me["schools"][0]["roles"], ["admin"])
        self.assertIn("transport", me["schools"][0]["modules"])
        setup = c.get(f"/api/schools/{school.id}/setup/").json()
        self.assertEqual(setup["total"], 10)
        self.assertLess(setup["done"], 3)
        # Same email cannot sign up twice
        res = APIClient().post("/api/signup/school/", {"school_name": "X", "first_name": "H", "email": "huda@noor.jo",
                                                       "password": "Noor-school-2026"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_invitation_links_parent_and_teacher_across_two_schools(self):
        a, b = build_school("A"), build_school("B")
        admin_a = auth(a["admin"])
        g = Guardian.objects.create(school=a["school"], name="New Parent")
        a["child"].guardians.add(g)
        inv = admin_a.post(f"/api/schools/{a['school'].id}/invitations/", {"role": "parent", "guardian_id": g.id},
                           format="json").json()
        preview = APIClient().get(f"/api/invitations/{inv['code']}/").json()
        self.assertEqual(preview["school"], "School A")
        res = APIClient().post("/api/invitations/accept/", {"code": inv["code"], "email": "newparent@ex.com",
                                                            "password": "Parent-2026-x"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        g.refresh_from_db()
        self.assertEqual(g.user.email, "newparent@ex.com")
        # Code is single use
        self.assertEqual(APIClient().post("/api/invitations/accept/", {"code": inv["code"], "email": "z@ex.com",
                                                                      "password": "Parent-2026-x"}, format="json").status_code, 400)

        # The same teacher account joins school B too and can switch between them.
        inv_b = auth(b["admin"]).post(f"/api/schools/{b['school'].id}/invitations/",
                                      {"role": "teacher", "teacher": b["other_teacher"].id}, format="json").json()
        res = auth(a["teacher_user"]).post("/api/invitations/accept/", {"code": inv_b["code"]}, format="json")
        self.assertEqual(res.status_code, 200)
        me = auth(a["teacher_user"]).get("/api/me/").json()
        self.assertEqual(sorted(s["name"] for s in me["schools"]), ["School A", "School B"])
        b["other_teacher"].refresh_from_db()
        self.assertEqual(b["other_teacher"].user, a["teacher_user"])

    def test_owner_panel_actions(self):
        a = build_school("A")
        owner = user("owner@ex.com")
        owner.is_superuser = True
        owner.save()
        c = auth(owner)
        sid = a["school"].id
        self.assertEqual(c.post(f"/api/platform/schools/{sid}/suspend/", {"reason": "unpaid"}, format="json").json()["status"],
                         "suspended")
        self.assertEqual(auth(a["admin"]).get(f"/api/schools/{sid}/students/").status_code, 403)
        self.assertEqual(c.post(f"/api/platform/schools/{sid}/set-plan/", {"plan": "standard"}, format="json").json()["status"],
                         "suspended")
        c.post(f"/api/platform/schools/{sid}/activate/")
        self.assertEqual(auth(a["admin"]).get(f"/api/schools/{sid}/students/").status_code, 200)
        a["school"].refresh_from_db()
        self.assertEqual(a["school"].plan.code, "standard")
        self.assertFalse(a["school"].has_module("fees"))
        res = c.post(f"/api/platform/schools/{sid}/extend-trial/", {"days": 10}, format="json")
        self.assertEqual(res.json()["status"], "trial")
        plans = APIClient().get("/api/plans/").json()
        self.assertEqual([p["code"] for p in plans["plans"]], ["trial", "basic", "standard", "premium"])

    def test_branding_settings_validation(self):
        a = build_school("A")
        c = auth(a["admin"])
        sid = a["school"].id
        ok = c.patch(f"/api/schools/{sid}/", {"currency": "jod", "brand_color": "#123abc", "week_days": "7,1,2,3,4",
                                              "grading_scale": [{"min": 50, "label": "D"}, {"min": 90, "label": "A"}],
                                              "logo": "data:image/png;base64,iVBORw0KGgo="}, format="json")
        self.assertEqual(ok.status_code, 200, ok.content)
        self.assertEqual(ok.json()["currency"], "JOD")
        self.assertEqual(ok.json()["grading_scale"][0]["label"], "A")
        bad = c.patch(f"/api/schools/{sid}/", {"logo": "data:image/svg+xml;base64,PHN2Zz4="}, format="json")
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(c.patch(f"/api/schools/{sid}/", {"status": "active"}, format="json").json()["status"], "trial")

    def test_admin_can_create_second_school(self):
        a = build_school("A")
        res = auth(a["admin"]).post("/api/schools/", {"name": "Branch 2"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertTrue(Membership.objects.filter(user=a["admin"], school__name="Branch 2", role="admin").exists())
