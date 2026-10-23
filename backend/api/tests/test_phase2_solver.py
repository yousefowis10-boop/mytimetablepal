"""Phase 2: OR-Tools timetable solver - one test per hard constraint, explanations, jobs and API."""
from datetime import date, time

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

from api.models import (
    Classroom, School, Schedule, SchedulePeriod, StudentGroup, Subject, SubjectRequirement, Teacher,
    TeacherAvailablePeriod, Timetable, TimetableEntry,
)
from api.scheduling.solver import (
    Group, Lesson, Period, Problem, Requirement, Room, Subject as S, Teacher as T, precheck, solve, validate,
)
from api.scheduling.synthetic import school_problem
from api.timetable_jobs import build_problem

User = get_user_model()


def periods(n):
    return [Period(i, f"P{i}", i) for i in range(1, n + 1)]


def problem(**kw):
    base = dict(
        days=[7, 1], periods=periods(3), adjacent_pairs=[(1, 2), (2, 3)],
        rooms=[Room(1, "R1", 30), Room(2, "R2", 30)],
        subjects=[S(1, "Math"), S(2, "English")],
        teachers=[T(1, "Ali", frozenset({1})), T(2, "Sara", frozenset({2}))],
        groups=[Group(1, "G1", 25, 1), Group(2, "G2", 25, 2)],
        requirements=[Requirement(1, 1, 2), Requirement(1, 2, 2), Requirement(2, 1, 2), Requirement(2, 2, 2)],
        time_limit=10, workers=2,
    )
    base.update(kw)
    return Problem(**base)


class SolverHardConstraintTests(SimpleTestCase):
    def assertValid(self, p, r):
        self.assertTrue(r.ok, (r.status, r.reasons))
        self.assertEqual(validate(p, r.lessons), [])

    def test_teacher_group_room_never_double_booked(self):
        # Shared teachers, one shared room: every resource is contended.
        p = problem(rooms=[Room(1, "Only room", 30)], groups=[Group(1, "G1", 25, 1), Group(2, "G2", 25, 1)],
                    days=[7, 1, 2], requirements=[Requirement(1, 1, 2), Requirement(1, 2, 1),
                                                  Requirement(2, 1, 2), Requirement(2, 2, 2)])
        r = solve(p)
        self.assertValid(p, r)
        for key in (lambda le: (le.teacher_id, le.day, le.period_id), lambda le: (le.group_id, le.day, le.period_id),
                    lambda le: (le.room_id, le.day, le.period_id)):
            keys = [key(le) for le in r.lessons]
            self.assertEqual(len(keys), len(set(keys)))

    def test_exact_lessons_per_week(self):
        p = problem()
        r = solve(p)
        self.assertValid(p, r)
        for req in p.requirements:
            n = sum(1 for le in r.lessons if (le.group_id, le.subject_id) == (req.group_id, req.subject_id))
            self.assertEqual(n, req.lessons)

    def test_only_qualified_teachers(self):
        p = problem(teachers=[T(1, "Math only", frozenset({1})), T(2, "English only", frozenset({2})),
                              T(3, "Both", frozenset({1, 2}))])
        r = solve(p)
        self.assertValid(p, r)
        quals = {t.id: t.subject_ids for t in p.teachers}
        self.assertTrue(all(le.subject_id in quals[le.teacher_id] for le in r.lessons))

    def test_only_available_periods(self):
        p = problem(teachers=[T(1, "Ali", frozenset({1}), available_period_ids=frozenset({1, 2})),
                              T(2, "Sara", frozenset({2}), available_period_ids=frozenset({3}))],
                    requirements=[Requirement(1, 1, 2), Requirement(1, 2, 1), Requirement(2, 2, 1)])
        r = solve(p)
        self.assertValid(p, r)
        self.assertTrue(all(le.period_id in (1, 2) for le in r.lessons if le.teacher_id == 1))
        self.assertTrue(all(le.period_id == 3 for le in r.lessons if le.teacher_id == 2))

    def test_lab_subject_in_lab_and_room_capacity(self):
        p = problem(rooms=[Room(1, "Small", 20), Room(2, "Big", 35), Room(3, "Lab", 30, "lab")],
                    subjects=[S(1, "Math"), S(2, "Chemistry", "lab")],
                    groups=[Group(1, "G1", 30, 1)],  # home room too small
                    requirements=[Requirement(1, 1, 2), Requirement(1, 2, 2)])
        r = solve(p)
        self.assertValid(p, r)
        for le in r.lessons:
            self.assertEqual(le.room_id, 3 if le.subject_id == 2 else 2)

    def test_locked_lessons_are_kept(self):
        locked = Lesson(1, 1, 1, 1, 7, 1)
        p = problem(fixed=[locked])
        r = solve(p)
        self.assertValid(p, r)
        self.assertNotIn((1, 7, 1), {(le.group_id, le.day, le.period_id) for le in r.lessons})
        self.assertEqual(sum(1 for le in r.lessons if (le.group_id, le.subject_id) == (1, 1)), 1)

    def test_teacher_daily_and_weekly_limits(self):
        p = problem(teachers=[T(1, "Ali", frozenset({1}), max_per_day=1), T(2, "Sara", frozenset({2})),
                              T(3, "Omar", frozenset({1}), max_per_week=1)],
                    days=[7, 1, 2])
        r = solve(p)
        self.assertValid(p, r)
        ali_days = [le.day for le in r.lessons if le.teacher_id == 1]
        self.assertEqual(len(ali_days), len(set(ali_days)))
        self.assertLessEqual(sum(1 for le in r.lessons if le.teacher_id == 3), 1)

    def test_double_periods_are_back_to_back(self):
        p = problem(adjacent_pairs=[(1, 2)],  # break between P2 and P3
                    requirements=[Requirement(1, 1, 2, doubles=1), Requirement(1, 2, 2)])
        r = solve(p)
        self.assertValid(p, r)
        math = sorted((le.day, le.period_id) for le in r.lessons if le.subject_id == 1)
        self.assertEqual(math[0][0], math[1][0])
        self.assertEqual({math[0][1], math[1][1]}, {1, 2})

    def test_deterministic(self):
        p = school_problem(8, 14, time_limit=20, workers=2)
        a, b = solve(p), solve(p)
        self.assertTrue(a.ok)
        self.assertEqual(a.lessons, b.lessons)
        self.assertEqual(validate(p, a.lessons), [])


class SolverExplanationTests(SimpleTestCase):
    def test_precheck_reports_teacher_availability_in_plain_language(self):
        p = problem(days=[7, 1, 2], periods=periods(4),
                    teachers=[T(1, "Ali", frozenset({1}), available_period_ids=frozenset({1})),
                              T(2, "Sara", frozenset({2}))],
                    groups=[Group(1, "Grade 9-B", 25, 1)],
                    requirements=[Requirement(1, 1, 6)])
        r = solve(p)
        self.assertEqual(r.status, "infeasible")
        self.assertTrue(any("Grade 9-B needs 6 Math lessons" in x and "available in 3 free periods" in x
                            for x in r.reasons), r.reasons)

    def test_precheck_other_reasons(self):
        reasons = precheck(problem(
            subjects=[S(1, "Math"), S(2, "Physics", "lab"), S(3, "Music")],
            requirements=[Requirement(1, 2, 1), Requirement(1, 3, 1), Requirement(2, 1, 9)]))
        text = " ".join(reasons)
        self.assertIn("needs a science lab for Physics", text)
        self.assertIn("no teacher is qualified to teach Music", text)
        self.assertIn("G2 needs 9 lessons a week but the week only has 6 lesson periods", text)

    def test_unsat_core_explains_hidden_conflict(self):
        # Each check passes on its own, but both lessons can only happen in period 1.
        p = problem(days=[7], periods=periods(2), adjacent_pairs=[],
                    teachers=[T(1, "Ali", frozenset({1}), available_period_ids=frozenset({1})),
                              T(2, "Sara", frozenset({2}), available_period_ids=frozenset({1}))],
                    groups=[Group(1, "Grade 5-A", 25, 1)],
                    requirements=[Requirement(1, 1, 1), Requirement(1, 2, 1)])
        self.assertEqual(precheck(p), [])
        r = solve(p)
        self.assertEqual(r.status, "infeasible")
        self.assertIn("cannot all be placed together", r.reasons[0])
        self.assertIn("Grade 5-A", r.reasons[0])


def make_school(user, label="A"):
    school = School.objects.create(name=f"School {label}", address="Amman", established_year=2000,
                                   principal_name="P", user=user)
    sched = Schedule.objects.create(school=school, name="Main")
    p1 = SchedulePeriod.objects.create(schedule=sched, name="L1", start_time=time(8), end_time=time(8, 45), order=1)
    p2 = SchedulePeriod.objects.create(schedule=sched, name="L2", start_time=time(8, 45), end_time=time(9, 30), order=2)
    SchedulePeriod.objects.create(schedule=sched, name="Break", start_time=time(9, 30), end_time=time(9, 50),
                                  type="break", order=3)
    p3 = SchedulePeriod.objects.create(schedule=sched, name="L3", start_time=time(9, 50), end_time=time(10, 35), order=4)
    room1 = Classroom.objects.create(school=school, name="R1", capacity=30)
    room2 = Classroom.objects.create(school=school, name="R2", capacity=30)
    math = Subject.objects.create(school=school, name="Math", code="M", is_heavy=True)
    eng = Subject.objects.create(school=school, name="English", code="E")
    t1 = Teacher.objects.create(school=school, name="Ali", experience=3)
    t1.subjects.add(math)
    t2 = Teacher.objects.create(school=school, name="Sara", experience=3)
    t2.subjects.add(eng)
    g1 = StudentGroup.objects.create(school=school, name="G1", classroom=room1, size=25)
    g2 = StudentGroup.objects.create(school=school, name="G2", classroom=room2, size=25)
    for g in (g1, g2):
        SubjectRequirement.objects.create(student_group=g, subject=math, lectures_per_week=3)
        SubjectRequirement.objects.create(student_group=g, subject=eng, lectures_per_week=3)
    TeacherAvailablePeriod.objects.create(teacher=t1, period=p1)
    TeacherAvailablePeriod.objects.create(teacher=t1, period=p2)
    TeacherAvailablePeriod.objects.create(teacher=t1, period=p3)
    tt = Timetable.objects.create(schedule=sched, school=school, name="TT",
                                  effective_date_start=date(2026, 9, 1), effective_date_end=date(2027, 1, 1))
    return dict(school=school, tt=tt, periods=(p1, p2, p3), g1=g1, g2=g2, t1=t1, t2=t2, math=math, eng=eng,
                room1=room1, room2=room2)


@override_settings(TIMETABLE_JOBS_SYNC=True)
class GenerationApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("owner@example.com", password="x-Strong-123")
        self.s = make_school(self.user)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.base = f"/api/schools/{self.s['school'].id}/timetables/{self.s['tt'].id}"

    def test_generate_job_runs_and_respects_rules(self):
        res = self.client.post(f"{self.base}/generate/", {"time_limit": 10}, format="json")
        self.assertEqual(res.status_code, 202, res.content)
        job = res.json()
        self.assertEqual(job["status"], "succeeded", job)
        self.assertEqual(job["progress"], 100)
        self.assertIsNotNone(job["result"]["score"])
        self.assertIn("teacher_gaps", job["result"]["violations"])
        entries = list(self.s["tt"].entries.select_related("period"))
        self.assertEqual(len(entries), 12)
        self.assertTrue(all(e.period.type in ("lecture", "lab") for e in entries))   # never in breaks
        self.assertTrue(all(e.day_of_week in (7, 1, 2, 3, 4) for e in entries))       # Sun-Thu
        polled = self.client.get(f"{self.base}/jobs/{job['id']}/").json()
        self.assertEqual(polled["status"], "succeeded")
        self.assertEqual(len(self.client.get(f"{self.base}/jobs/").json()), 1)

    def test_locked_entry_survives_regeneration_and_partial_regenerate(self):
        p1, p2, _ = self.s["periods"]
        locked = TimetableEntry.objects.create(
            timetable=self.s["tt"], student_group=self.s["g1"], day_of_week=7, period=p1, teacher=self.s["t1"],
            subject=self.s["math"], classroom=self.s["room1"], locked=True)
        self.client.post(f"{self.base}/generate/", {"time_limit": 10}, format="json")
        self.assertTrue(TimetableEntry.objects.filter(id=locked.id, day_of_week=7, period=p1).exists())
        self.assertEqual(self.s["tt"].entries.count(), 12)

        g2_before = set(self.s["tt"].entries.filter(student_group=self.s["g2"]).values_list("id", flat=True))
        res = self.client.post(f"{self.base}/generate/", {"group_ids": [self.s["g1"].id], "time_limit": 10},
                               format="json")
        self.assertEqual(res.json()["status"], "succeeded", res.json())
        g2_after = set(self.s["tt"].entries.filter(student_group=self.s["g2"]).values_list("id", flat=True))
        self.assertEqual(g2_before, g2_after)   # untouched group kept exactly
        self.assertTrue(TimetableEntry.objects.filter(id=locked.id).exists())

    def test_infeasible_job_explains_why(self):
        req = SubjectRequirement.objects.get(student_group=self.s["g1"], subject=self.s["math"])
        req.lectures_per_week = 20
        req.save()
        job = self.client.post(f"{self.base}/generate/", {}, format="json").json()
        self.assertEqual(job["status"], "infeasible")
        self.assertTrue(any("G1 needs" in r for r in job["result"]["reasons"]), job)
        pre = self.client.get(f"{self.base}/precheck/").json()
        self.assertFalse(pre["ok"])
        self.assertEqual(self.s["tt"].entries.count(), 0)   # nothing saved

    def test_solver_settings_roundtrip_and_validation(self):
        url = f"/api/schools/{self.s['school'].id}/solver-settings/"
        data = self.client.get(url).json()
        self.assertEqual(data["time_limit_seconds"], 60)
        res = self.client.put(url, {"weights": {"teacher_gaps": 9}, "time_limit_seconds": 30}, format="json")
        self.assertEqual(res.json()["weights"]["teacher_gaps"], 9)
        self.assertEqual(res.json()["time_limit_seconds"], 30)
        self.assertEqual(self.client.put(url, {"weights": {"nope": 1}}, format="json").status_code, 400)
        problem_, _ = build_problem(self.s["tt"])
        self.assertEqual(problem_.weights["teacher_gaps"], 9)
        self.assertEqual(problem_.time_limit, 30)

    def test_build_problem_maps_data(self):
        p, kept = build_problem(self.s["tt"])
        self.assertEqual([x.name for x in p.periods], ["L1", "L2", "L3"])     # break excluded
        p1, p2, p3 = self.s["periods"]
        self.assertEqual(p.adjacent_pairs, [(p1.id, p2.id)])                     # no double across the break
        teachers = {t.id: t for t in p.teachers}
        self.assertEqual(teachers[self.s["t1"].id].available_period_ids, frozenset({p1.id, p2.id, p3.id}))
        self.assertIsNone(teachers[self.s["t2"].id].available_period_ids)       # not configured = always
        self.assertEqual(kept, [])

    def test_other_school_cannot_generate_or_read_jobs(self):
        other = User.objects.create_user("other@example.com", password="x-Strong-123")
        client = APIClient()
        client.force_authenticate(other)
        self.assertEqual(client.post(f"{self.base}/generate/").status_code, 404)
        self.assertEqual(client.get(f"{self.base}/jobs/").status_code, 404)
        self.assertEqual(client.get(f"/api/schools/{self.s['school'].id}/solver-settings/").status_code, 404)
        self.assertEqual(client.post(f"/api/timetables/{self.s['tt'].id}/generate/").status_code, 404)

    def test_old_entries_still_display(self):
        p1, _, _ = self.s["periods"]
        TimetableEntry.objects.create(timetable=self.s["tt"], student_group=self.s["g1"], day_of_week=1, period=p1,
                                      teacher=self.s["t2"], subject=self.s["eng"], classroom=self.s["room1"])
        data = self.client.get(f"/api/timetables/{self.s['tt'].id}/json/?type=grade").json()
        self.assertEqual(data["pages"][0]["periods"][0]["days"][1]["subject"], "English")
        entry = self.client.get(f"{self.base}/entries/").json()[0]
        self.assertFalse(entry["locked"])
