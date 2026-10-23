"""Arabic / English on the server: every message is translated, API errors follow the app language,
notifications follow the recipient's language."""
import subprocess
import sys
from datetime import date
from pathlib import Path

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

from api.i18n import render
from api.models import Notification, School, UserProfile
from api.notify import notify
from api.scheduling.messages import Msg

ROOT = Path(__file__).resolve().parents[2]
User = get_user_model()


class TranslationCoverageTests(SimpleTestCase):
    def test_every_backend_message_has_arabic(self):
        res = subprocess.run([sys.executable, str(ROOT / "scripts" / "i18n.py"), "check"], capture_output=True,
                             text=True, cwd=ROOT, encoding="utf-8")
        self.assertEqual(res.returncode, 0, res.stdout)

    def test_msg_renders_in_both_languages(self):
        m = Msg("%(name)s was marked absent on %(day)s.", name="Lina", day=date(2026, 10, 25))
        self.assertEqual(str(m), "Lina was marked absent on 2026-10-25.")
        self.assertEqual(render(m, "en"), "Lina was marked absent on Sunday 25 October.")
        self.assertIn("الأحد 25 تشرين الأول", render(m, "ar"))


@override_settings(NOTIFY_SYNC=True)
class LanguageBehaviourTests(TestCase):
    def test_api_errors_follow_accept_language(self):
        c = APIClient()
        res = c.post("/api/signup/school/", {"school_name": "X", "first_name": "A", "email": "bad",
                                             "password": "123"}, format="json", HTTP_ACCEPT_LANGUAGE="ar")
        self.assertEqual(res.status_code, 400)
        self.assertIn("بريد", str(res.json()["email"]))   # Django's own Arabic message
        res = c.post("/api/signup/school/", {"school_name": "X", "first_name": "A", "email": "a@b.com",
                                             "password": "123"}, format="json", HTTP_ACCEPT_LANGUAGE="en")
        self.assertIn("too short", str(res.json()["password"]))

    def test_notifications_use_each_recipients_language(self):
        owner = User.objects.create_user("o@ex.com", password="x")
        school = School.objects.create(name="S", address="A", established_year=2000, principal_name="P", user=owner,
                                       default_language="ar")
        ar_user = User.objects.create_user("ar@ex.com", password="x")
        en_user = User.objects.create_user("en@ex.com", password="x")
        UserProfile.objects.create(user=en_user, language="en")
        notify(school, [ar_user, en_user], "test", Msg("Fee overdue"), Msg("%(n)s lesson(s) need a cover.", n=2))
        self.assertEqual(Notification.objects.get(user=en_user).title, "Fee overdue")
        self.assertEqual(Notification.objects.get(user=ar_user).title, "رسوم متأخرة")   # school default: Arabic
