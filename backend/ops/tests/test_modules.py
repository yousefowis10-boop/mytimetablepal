import io
from datetime import date, timedelta
from decimal import Decimal
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from openpyxl import Workbook, load_workbook
from rest_framework.test import APIClient

from api.models import AuditLog, Notification, TeacherAvailablePeriod, TimetableEntry
from ops.models import (
    Announcement, AnnouncementReceipt, Applicant, AttendanceRecord, Exam, ExamPeriod, Installment, Payment, Student,
    TeacherAbsence, Term,
)

from .factory import TODAY, build_school


def auth(u):
    c = APIClient()
    c.force_authenticate(u)
    return c


@override_settings(NOTIFY_SYNC=True)
class AttendanceAndCoverTests(TestCase):
    def setUp(self):
        self.a = build_school("A")
        self.sid = self.a["school"].id
        self.base = f"/api/schools/{self.sid}"

    def test_teacher_takes_attendance_and_parent_is_notified(self):
        t = auth(self.a["teacher_user"])
        today = t.get(f"{self.base}/teacher/today/?date={TODAY}").json()
        self.assertEqual(len(today["lessons"]), 1)
        self.assertFalse(today["lessons"][0]["attendance_taken"])
        q = f"group={self.a['group'].id}&date={TODAY}&period={self.a['p1'].id}"
        sheet = t.get(f"{self.base}/attendance/sheet/?{q}").json()
        self.assertEqual(len(sheet["students"]), 2)
        res = t.post(f"{self.base}/attendance/sheet/", {
            "group": self.a["group"].id, "date": str(TODAY), "period": self.a["p1"].id,
            "records": [{"student": self.a["child"].id, "status": "absent"},
                        {"student": self.a["other_child"].id, "status": "present"}]}, format="json")
        self.assertEqual(res.json()["parents_notified"], 1)
        n = Notification.objects.get(user=self.a["parent"], kind="attendance")
        self.assertIn("absent", n.title)
        self.assertFalse(Notification.objects.filter(user=self.a["other_parent"]).exists())
        # Saving again does not notify twice
        t.post(f"{self.base}/attendance/sheet/", {"group": self.a["group"].id, "date": str(TODAY),
                                                  "period": self.a["p1"].id,
                                                  "records": [{"student": self.a["child"].id, "status": "absent"}]},
               format="json")
        self.assertEqual(Notification.objects.filter(user=self.a["parent"], kind="attendance").count(), 1)
        # Teacher cannot take attendance for a group they don't teach
        bad = t.get(f"{self.base}/attendance/sheet/?group={self.a['group2'].id}&date={TODAY}&period={self.a['p2'].id}")
        self.assertEqual(bad.status_code, 403)
        report = auth(self.a["admin"]).get(f"{self.base}/attendance/report/?kind=monthly&month=2026-10").json()
        flagged = {r["student"]: r["flagged"] for r in report["students"]}
        self.assertTrue(flagged["KidA One"])

    def test_parent_absence_report_shows_as_excused(self):
        p = auth(self.a["parent"])
        res = p.post(f"{self.base}/absence-reports/", {"student": self.a["child"].id, "date_from": str(TODAY),
                                                       "date_to": str(TODAY), "reason": "Dentist"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        sheet = auth(self.a["teacher_user"]).get(
            f"{self.base}/attendance/sheet/?group={self.a['group'].id}&date={TODAY}&period={self.a['p1'].id}").json()
        mine = next(s for s in sheet["students"] if s["id"] == self.a["child"].id)
        self.assertEqual(mine["status"], "excused")
        self.assertTrue(Notification.objects.filter(user=self.a["admin"], kind="absence_report").exists())

    def test_substitute_suggestion_and_one_click_approval(self):
        admin = auth(self.a["admin"])
        res = admin.post(f"{self.base}/teacher-absences/", {"teacher": self.a["teacher"].id, "date": str(TODAY),
                                                            "reason": "Sick"}, format="json")
        absence_id = res.json()["id"]
        detail = admin.get(f"{self.base}/teacher-absences/{absence_id}/").json()
        lesson = detail["lessons"][0]
        best = lesson["suggestions"][0]
        self.assertEqual(best["name"], "Sara A")            # free in L1 and qualified for Math
        self.assertTrue(best["qualified"])
        res = admin.post(f"{self.base}/teacher-absences/{absence_id}/approve/",
                         {"entry": lesson["entry"], "teacher": best["teacher_id"]}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        entry = TimetableEntry.objects.get(id=lesson["entry"])
        self.assertEqual(entry.covering_teacher, self.a["other_teacher"])   # uses the existing field
        load = admin.get(f"{self.base}/covers/?from={TODAY}&to={TODAY}").json()
        self.assertEqual(load["load"], [{"teacher": "Sara A", "covers": 1}])
        # The absent teacher can't be picked, and a teacher can't report someone else absent
        bad = admin.post(f"{self.base}/teacher-absences/{absence_id}/approve/",
                         {"entry": lesson["entry"], "teacher": self.a["teacher"].id}, format="json")
        self.assertEqual(bad.status_code, 400)
        res = auth(self.a["teacher_user"]).post(f"{self.base}/teacher-absences/",
                                                {"teacher": self.a["other_teacher"].id, "date": str(TODAY)}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_availability_is_respected_by_suggestions(self):
        TeacherAvailablePeriod.objects.create(teacher=self.a["other_teacher"], period=self.a["p2"])
        admin = auth(self.a["admin"])
        absence_id = admin.post(f"{self.base}/teacher-absences/", {"teacher": self.a["teacher"].id,
                                                                   "date": str(TODAY)}, format="json").json()["id"]
        lesson = admin.get(f"{self.base}/teacher-absences/{absence_id}/").json()["lessons"][0]
        self.assertEqual(lesson["suggestions"], [])


@override_settings(NOTIFY_SYNC=True)
class AcademicTests(TestCase):
    def setUp(self):
        self.a = build_school("A")
        self.sid = self.a["school"].id
        self.base = f"/api/schools/{self.sid}"
        self.admin = auth(self.a["admin"])

    def test_homework_reaches_parents_weekly_view(self):
        t = auth(self.a["teacher_user"])
        res = t.post(f"{self.base}/homework/", {"group": self.a["group"].id, "subject": self.a["math"].id,
                                                "title": "Page 12", "assigned_date": str(TODAY),
                                                "due_date": str(TODAY + timedelta(days=2))}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        res = t.post(f"{self.base}/homework/", {"group": self.a["group2"].id, "subject": self.a["eng"].id,
                                                "title": "x", "due_date": str(TODAY)}, format="json")
        self.assertEqual(res.status_code, 403)    # not their class
        kids = auth(self.a["parent"]).get(f"{self.base}/my/children/?date={TODAY}").json()["children"]
        self.assertEqual([h["title"] for h in kids[0]["homework"]], ["Page 12"])
        self.assertEqual(kids[0]["today"][0]["subject"], "Math")

    def test_gradebook_report_card_and_at_risk(self):
        self.a["school"].grading_scale = [{"min": 90, "label": "A"}, {"min": 50, "label": "D"}, {"min": 0, "label": "F"}]
        self.a["school"].save()
        term = Term.objects.create(school=self.a["school"], name="Term 1", start_date=date(2026, 9, 1),
                                   end_date=date(2027, 1, 15))
        t = auth(self.a["teacher_user"])
        scores = [95, 90, 40, 30]
        for i, score in enumerate(scores):
            a = t.post(f"{self.base}/assessments/", {"term": term.id, "group": self.a["group"].id,
                                                     "subject": self.a["math"].id, "name": f"Quiz {i}",
                                                     "date": str(date(2026, 10, 1) + timedelta(days=i)),
                                                     "max_score": 100}, format="json").json()
            res = t.post(f"{self.base}/assessments/{a['id']}/grades/",
                         {"grades": [{"student": self.a["child"].id, "score": score}]}, format="json")
            self.assertEqual(res.status_code, 200, res.content)
        bad = t.post(f"{self.base}/assessments/{a['id']}/grades/", {"grades": [{"student": self.a["child"].id,
                                                                                "score": 150}]}, format="json")
        self.assertEqual(bad.status_code, 400)
        card = auth(self.a["parent"]).get(f"{self.base}/students/{self.a['child'].id}/report-card/").json()
        self.assertEqual(card["subjects"][0]["percentage"], 63.8)
        self.assertEqual(card["subjects"][0]["letter"], "D")
        risk = self.admin.get(f"{self.base}/at-risk/").json()["students"]
        kinds = {r["kind"] for r in risk[0]["reasons"]}
        self.assertIn("trend", kinds)
        self.assertTrue(AuditLog.objects.filter(model="ops.Grade").exists())

    def test_exam_schedule_has_no_clashes(self):
        from api.models import Classroom
        Classroom.objects.create(school=self.a["school"], name="Hall", capacity=40)
        ep = self.admin.post(f"{self.base}/exam-periods/", {
            "name": "Midterms", "start_date": "2026-11-01", "end_date": "2026-11-05",
            "sessions": [{"start": "09:00", "end": "11:00"}], "max_exams_per_day": 1}, format="json").json()
        for subj in (self.a["math"], self.a["eng"]):
            res = self.admin.post(f"{self.base}/exams/", {"exam_period": ep["id"], "subject": subj.id,
                                                         "groups": [self.a["group"].id, self.a["group2"].id]},
                                  format="json")
            self.assertEqual(res.status_code, 201, res.content)
        out = self.admin.post(f"{self.base}/exam-periods/{ep['id']}/schedule/").json()
        self.assertIn(out["result"]["status"], ("optimal", "feasible"), out)
        days = [e["date"] for e in out["exams"]]
        self.assertEqual(len(set(days)), 2)                      # one exam per group per day
        for e in out["exams"]:
            self.assertEqual(len({s["room"] for s in e["sittings"]}), 2)   # one room per group
        for e in out["exams"]:
            self.assertEqual(len(e["sittings"]), 2)
            self.assertEqual(len({s["invigilator"] for s in e["sittings"]}), 2)


@override_settings(NOTIFY_SYNC=True)
class FeesAdmissionsPickupTests(TestCase):
    def setUp(self):
        self.a = build_school("A")
        self.sid = self.a["school"].id
        self.base = f"/api/schools/{self.sid}"
        self.staff = auth(self.a["staff"])

    def test_fee_plan_payments_balances_and_reminders(self):
        plan = self.staff.post(f"{self.base}/fee-plans/", {"name": "Grade 5", "items": [
            {"category": "tuition", "description": "Tuition", "amount": "1200.000",
             "installments": [{"due_date": str(TODAY - timedelta(days=10)), "amount": "600.000"},
                              {"due_date": str(TODAY + timedelta(days=2)), "amount": "600.000"}]},
            {"category": "books", "description": "Books", "amount": "85.500", "due_date": str(TODAY)}]},
            format="json").json()
        res = self.staff.post(f"{self.base}/fee-plans/{plan['id']}/apply/", {"group_ids": [self.a["group"].id]},
                              format="json")
        self.assertEqual(res.json()["billed_students"], 2)
        again = self.staff.post(f"{self.base}/fee-plans/{plan['id']}/apply/", {"group_ids": [self.a["group"].id]},
                                format="json")
        self.assertEqual(again.json()["already_billed"], 2)
        pay = self.staff.post(f"{self.base}/payments/", {"student": self.a["child"].id, "amount": "700.000",
                                                        "method": "cash"}, format="json").json()
        self.assertTrue(pay["receipt_number"].startswith("R"))
        insts = list(Installment.objects.filter(fee__student=self.a["child"]).order_by("due_date"))
        # oldest due first: tuition 1 (600), then books due today (85.5), then the rest of tuition 2
        self.assertEqual([i.paid for i in insts], [Decimal("600"), Decimal("85.5"), Decimal("14.5")])
        st = auth(self.a["parent"]).get(f"{self.base}/students/{self.a['child'].id}/fees/").json()
        self.assertEqual(Decimal(st["balance"]), Decimal("585.500"))
        fam = self.staff.get(f"{self.base}/fees/balances/?by=family").json()
        self.assertEqual(len(fam["rows"]), 2)
        self.assertEqual(fam["totals"]["balance"], "1871.000")   # 2 x 1285.500 - 700
        receipt = self.staff.get(f"{self.base}/payments/{pay['id']}/receipt/").json()
        self.assertEqual(receipt["school"]["currency"], "JOD")
        # reminders: one "due soon" and one "overdue" (other child)
        from ops.views.fees import send_fee_reminders
        with mock.patch("ops.views.fees.timezone.localdate", return_value=TODAY):
            send_fee_reminders()
            send_fee_reminders()
        kinds = sorted(Notification.objects.filter(user=self.a["other_parent"], kind__startswith="fee")
                       .values_list("kind", flat=True))
        self.assertEqual(kinds, ["fee_overdue", "fee_reminder", "fee_reminder"])   # once per installment, never repeated
        # deleting a payment re-allocates
        self.staff.delete(f"{self.base}/payments/{pay['id']}/")
        self.assertEqual(Installment.objects.filter(fee__student=self.a["child"], paid__gt=0).count(), 0)
        self.assertTrue(AuditLog.objects.filter(model="ops.Payment", action="delete").exists())

    def test_admissions_pipeline_and_enrolment(self):
        app = self.staff.post(f"{self.base}/applicants/", {
            "child_name": "Yazan Saleh", "guardian_name": "Maha Saleh", "guardian_phone": "0790000001",
            "grade_applying": 5, "next_follow_up": str(timezone.localdate())}, format="json").json()
        from ops.views.admissions import admissions_follow_ups
        admissions_follow_ups()
        admissions_follow_ups()
        self.assertEqual(Notification.objects.filter(user=self.a["admin"], kind="admissions").count(), 1)
        self.staff.patch(f"{self.base}/applicants/{app['id']}/", {"stage": "accepted"}, format="json")
        res = self.staff.post(f"{self.base}/applicants/{app['id']}/enroll/", {"group": self.a["group"].id}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        s = Student.objects.get(first_name="Yazan")
        self.assertEqual(s.guardians.get().name, "Maha Saleh")
        pipe = self.staff.get(f"{self.base}/applicants/pipeline/").json()
        self.assertEqual(pipe["counts"]["enrolled"], 1)

    def test_pickup_and_dismissal(self):
        p = auth(self.a["parent"])
        res = p.post(f"{self.base}/my/pickup/", {"student": self.a["child"].id, "date": str(timezone.localdate()),
                                                 "mode": "other", "person_name": "Uncle Sami"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        lst = self.staff.get(f"{self.base}/dismissal/").json()
        mine = next(r for r in lst["students"] if r["student"] == self.a["child"].id)
        self.assertEqual((mine["mode"], mine["person_name"]), ("other", "Uncle Sami"))
        other = next(r for r in lst["students"] if r["student"] == self.a["other_child"].id)
        self.assertEqual(other["mode"], "parent")
        self.staff.post(f"{self.base}/dismissal/", {"student": self.a["child"].id}, format="json")
        self.assertEqual(self.staff.get(f"{self.base}/dismissal/").json()["handed_over"], 1)
        self.assertTrue(Notification.objects.filter(user=self.a["parent"], kind="pickup").exists())


@override_settings(NOTIFY_SYNC=True)
class CommsImportExportDashboardTests(TestCase):
    def setUp(self):
        self.a = build_school("A")
        self.sid = self.a["school"].id
        self.base = f"/api/schools/{self.sid}"
        self.admin = auth(self.a["admin"])

    def test_announcements_targeting_receipts_and_schedule(self):
        res = self.admin.post(f"{self.base}/announcements/", {"title": "Trip", "body": "Grade 5 trip",
                                                              "audience": "grade", "grade_level": 5}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        a = Announcement.objects.get(title="Trip")
        self.assertEqual(set(a.receipts.values_list("user__email", flat=True)), {"parentA@ex.com", "otherparentA@ex.com"})
        inbox = auth(self.a["parent"]).get(f"{self.base}/inbox/").json()
        auth(self.a["parent"]).post(f"{self.base}/inbox/{inbox[0]['id']}/read/")
        stats = self.admin.get(f"{self.base}/announcements/").json()[0]["stats"]
        self.assertEqual(stats, {"recipients": 2, "read": 1})
        # scheduled for later: not sent until due
        later = self.admin.post(f"{self.base}/announcements/", {
            "title": "Later", "body": "x", "audience": "staff",
            "publish_at": (timezone.now() + timedelta(hours=1)).isoformat()}, format="json").json()
        self.assertIsNone(later["sent_at"])
        Announcement.objects.filter(id=later["id"]).update(publish_at=timezone.now() - timedelta(minutes=1))
        from ops.views.comms import dispatch_due_announcements
        dispatch_due_announcements()
        self.assertTrue(AnnouncementReceipt.objects.filter(announcement_id=later["id"], user=self.a["teacher_user"]).exists())
        # no school tomorrow + FAQ
        res = self.admin.post(f"{self.base}/calendar/no-school/", {"reason": "Snow"}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(auth(self.a["parent"]).get(f"{self.base}/calendar/").json()[0]["kind"], "no_school")
        self.admin.post(f"{self.base}/faqs/", {"question": "When does school start?", "answer": "7:45"}, format="json")
        self.assertEqual(len(auth(self.a["parent"]).get(f"{self.base}/faqs/").json()), 1)

    def test_parent_message_thread(self):
        p = auth(self.a["parent"])
        t = p.post(f"{self.base}/threads/", {"subject": "Bus late", "body": "Bus was late today",
                                             "student": self.a["child"].id}, format="json").json()
        auth(self.a["staff"]).post(f"{self.base}/threads/{t['id']}/reply/", {"body": "We are checking."}, format="json")
        thread = p.get(f"{self.base}/threads/{t['id']}/").json()
        self.assertEqual([m["from_school"] for m in thread["messages"]], [False, True])

    def test_excel_import_preview_then_commit(self):
        wb = Workbook()
        ws = wb.active
        from ops.views.data_io import COLUMNS
        ws.append(COLUMNS["students"])
        ws.append(["Rami", "Khalil", "S-9", "Grade 5-A", "2016-02-01", "M", "Hani Khalil", "0791112223", "", "Father"])
        ws.append(["Bad", "Row", "", "No such group"])
        buf = io.BytesIO()
        wb.save(buf)

        def upload(commit):
            f = SimpleUploadedFile("students.xlsx", buf.getvalue())
            return self.admin.post(f"{self.base}/import/students/", {"file": f, "commit": commit}, format="multipart").json()

        preview = upload("0")
        self.assertFalse(preview["committed"])
        self.assertEqual(preview["errors"][0]["line"], 3)
        self.assertFalse(Student.objects.filter(first_name="Rami").exists())   # dry run changes nothing
        ws.delete_rows(3)
        buf = io.BytesIO()
        wb.save(buf)
        done = upload("1")
        self.assertTrue(done["committed"], done)
        rami = Student.objects.get(first_name="Rami")
        self.assertEqual(rami.guardians.get().phone, "0791112223")
        tpl = self.admin.get(f"{self.base}/import/teachers/")
        self.assertEqual(load_workbook(io.BytesIO(tpl.content)).active["A1"].value, "name")

    def test_exports_are_excel(self):
        AttendanceRecord.objects.create(school=self.a["school"], student=self.a["child"], date=TODAY, status="absent")
        for kind in ("attendance/?from=2026-10-01&to=2026-10-31", "grades/", "fees/", "timetable/?type=teacher"):
            res = self.admin.get(f"{self.base}/export/{kind}")
            self.assertEqual(res.status_code, 200, (kind, res.content[:200]))
            wb = load_workbook(io.BytesIO(res.content))
            self.assertTrue(wb.worksheets)

    def test_dashboards_per_role(self):
        d = self.admin.get(f"{self.base}/dashboard/").json()
        self.assertIn("admin", d)
        self.assertEqual(d["admin"]["students"], 2)
        t = auth(self.a["teacher_user"]).get(f"{self.base}/dashboard/").json()
        self.assertIn("teacher", t)
        self.assertNotIn("admin", t)
        p = auth(self.a["parent"]).get(f"{self.base}/dashboard/").json()
        self.assertEqual([c["name"] for c in p["parent"]["children"]], ["KidA One"])
        self.assertNotIn("teacher", p)
