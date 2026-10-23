import os
from datetime import date, time, timedelta
from unittest import mock

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import AuditLog, Notification
from ops.models import Guardian, Student, StudentGuardian
from ops.tests.factory import build_school, user
from transport.models import Bus, LeaveTimeOverride, LocationPing, ManualRoute, RouteRun, TransportSettings
from transport.optimizer import BusIn, StopIn, VRPInput, solve
from transport.services import waves


def auth(u):
    c = APIClient()
    c.force_authenticate(u)
    return c


@override_settings(NOTIFY_SYNC=True)
@mock.patch.dict(os.environ, {"ROUTING_PROVIDER_OVERRIDE": "haversine"})
class TransportTests(TestCase):
    def setUp(self):
        self.a = build_school("A")
        self.school = self.a["school"]
        self.sid = self.school.id
        self.base = f"/api/schools/{self.sid}"
        TransportSettings.objects.create(school=self.school, solver_seconds=2, school_start_time=time(7, 45))
        self.bus1 = Bus.objects.create(school=self.school, name="Bus 1", capacity=10, driver=self.a["driver"])
        self.bus2 = Bus.objects.create(school=self.school, name="Bus 2", capacity=10)
        # a few more riders around the school
        for i in range(6):
            s = Student.objects.create(school=self.school, first_name=f"Rider{i}", group=self.a["group2"],
                                       home_lat=31.95 + 0.004 * (i + 1), home_lng=35.9 - 0.003 * i,
                                       uses_bus_morning=True, uses_bus_afternoon=True)
            g = Guardian.objects.create(school=self.school, name=f"G{i}")
            StudentGuardian.objects.create(student=s, guardian=g, is_primary=True)
        self.admin = auth(self.a["admin"])

    def plan(self, direction):
        res = self.admin.post(f"{self.base}/transport/plans/", {"direction": direction}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        return res.json()

    def test_morning_plan_respects_seats_ride_time_and_deadline(self):
        plan = self.plan("morning")[0]
        self.assertEqual(plan["summary"]["status"], "ok", plan["summary"])
        riders = sum(r["students"] for r in plan["routes"])
        self.assertEqual(riders, 7)          # KidA + 6 riders (other child has no bus flag)
        for r in plan["routes"]:
            self.assertLessEqual(r["students"], 10)
            self.assertLessEqual(r["arrive"], "07:35")           # 7:45 start - 10 min buffer
            self.assertTrue(r["stops"][-1]["is_school"])
            self.assertLessEqual(r["minutes"], 60)
            self.assertGreater(float(r["fuel_cost"]), 0)
        self.assertIn("km", plan["summary"]["totals"])

    def test_afternoon_waves_follow_timetable_leaving_times(self):
        # KidA's group ends after L1 on Sundays, the riders' group after L2 -> two waves on a Sunday
        lt = {1: time(8, 45), 2: time(8, 50), 3: time(9, 30)}
        self.assertEqual([len(ids) for _, ids in waves(lt, 15)], [2, 1])
        with mock.patch("transport.services.timezone.localdate", return_value=date(2026, 10, 25)):
            plans = self.plan("afternoon")
        self.assertEqual([p["wave_time"] for p in plans], ["08:50", "09:35"])
        LeaveTimeOverride.objects.create(school=self.school, student=self.a["child"], date=date(2026, 10, 25),
                                         leave_time=None)
        with mock.patch("transport.services.timezone.localdate", return_value=date(2026, 10, 25)):
            plans = self.plan("afternoon")
        self.assertEqual(sum(r["students"] for p in plans for r in p["routes"]), 6)   # KidA not on the bus today

    def test_infeasible_explains_seats(self):
        self.bus1.capacity = 2
        self.bus1.save()
        self.bus2.capacity = 2
        self.bus2.save()
        plan = self.plan("morning")[0]
        self.assertEqual(plan["status"], "infeasible")
        self.assertIn("Not enough seats: 7 children", plan["summary"]["reasons"][0])

    def test_manual_routes_comparison(self):
        riders = list(Student.objects.filter(school=self.school, uses_bus_morning=True).order_by("-home_lat"))
        ManualRoute.objects.create(school=self.school, bus=self.bus1, direction="morning",
                                   student_order=[s.id for s in riders[::2]])
        ManualRoute.objects.create(school=self.school, bus=self.bus2, direction="morning",
                                   student_order=[s.id for s in riders[1::2]])
        comp = self.plan("morning")[0]["summary"]["comparison"]
        self.assertIn("before", comp)
        self.assertGreaterEqual(comp["km_saved"], 0)

    def test_driver_flow_and_parent_privacy(self):
        plan = self.plan("morning")[0]
        driver = auth(self.a["driver"])
        today = driver.get(f"{self.base}/driver/today/").json()
        my_routes = [r for r in plan["routes"] if r["bus"] == "Bus 1"]
        self.assertEqual(len(today["runs"]), len(my_routes))     # only own bus
        if not today["runs"]:
            self.skipTest("Bus 1 not used by this plan")
        run = today["runs"][0]
        parent = auth(self.a["parent"])
        mine = parent.get(f"{self.base}/my/bus/").json()
        trip = mine[0]["trips"][0] if mine else None
        # live position only while the route is running
        if trip:
            self.assertIsNone(trip["live"])
        driver.post(f"{self.base}/driver/runs/{run['run_id']}/start/")
        first = next(s for s in run["stops"] if not s["is_school"])
        driver.post(f"{self.base}/driver/runs/{run['run_id']}/location/", {"lat": first["lat"], "lng": first["lng"]},
                    format="json")
        for s in first["students"]:
            res = driver.post(f"{self.base}/driver/runs/{run['run_id']}/event/",
                              {"kind": "picked_up", "stop": first["id"], "student": s["id"]}, format="json")
            self.assertEqual(res.status_code, 200, res.content)
        kids_on_bus1 = {k["id"] for st in run["stops"] for k in st["students"]}
        if self.a["child"].id in kids_on_bus1:
            info = parent.get(f"{self.base}/my/bus/").json()[0]
            self.assertIsNotNone(info["trips"][0]["live"])
            text = str(info)
            for other in Student.objects.exclude(id=self.a["child"].id):
                self.assertNotIn(other.first_name, text)          # never other children's names
                if other.home_address:
                    self.assertNotIn(other.home_address, text)
            self.assertTrue(Notification.objects.filter(user=self.a["parent"], kind="bus").exists())
            self.assertTrue(AuditLog.objects.filter(model="transport.live").exists())
        # another driver cannot drive this run
        other_driver = user("driver2@ex.com")
        from api.models import Membership
        Membership.objects.create(user=other_driver, school=self.school, role="driver")
        self.assertEqual(auth(other_driver).post(f"{self.base}/driver/runs/{run['run_id']}/start/").status_code, 404)
        self.assertEqual(auth(other_driver).get(f"{self.base}/driver/today/").json()["runs"], [])
        # drivers and parents cannot see the planner
        self.assertEqual(driver.get(f"{self.base}/transport/plans/").status_code, 403)
        self.assertEqual(parent.get(f"{self.base}/transport/plans/").status_code, 403)
        driver.post(f"{self.base}/driver/runs/{run['run_id']}/finish/")
        self.assertEqual(RouteRun.objects.get(id=run["run_id"]).status, "completed")

    def test_location_history_is_deleted_after_retention(self):
        self.plan("morning")
        runs = auth(self.a["driver"]).get(f"{self.base}/driver/today/").json()["runs"]
        if not runs:
            self.skipTest("Bus 1 not used by this plan")
        run = RouteRun.objects.get(id=runs[0]["run_id"])
        old = LocationPing.objects.create(run=run, lat=31.9, lng=35.9)
        LocationPing.objects.filter(id=old.id).update(at=timezone.now() - timedelta(days=8))
        fresh = LocationPing.objects.create(run=run, lat=31.9, lng=35.9)
        from transport.services import purge_old_locations
        purge_old_locations()
        self.assertFalse(LocationPing.objects.filter(id=old.id).exists())
        self.assertTrue(LocationPing.objects.filter(id=fresh.id).exists())

    def test_other_school_cannot_see_buses(self):
        b = build_school("B")
        self.assertEqual(auth(b["admin"]).get(f"{self.base}/transport/buses/").status_code, 404)
        self.assertEqual(auth(b["parent"]).get(f"{self.base}/my/bus/").status_code, 404)


class OptimizerUnitTests(TestCase):
    def test_max_ride_time_is_hard_and_explained(self):
        stops = [StopIn("far", 32.5, 36.5, 1, "Far farm")]
        dur = [[0, 7200], [7200, 0]]
        dist = [[0, 90000], [90000, 0]]
        r = solve(VRPInput("morning", stops, [BusIn(1, "B", 10)], dur, dist, max_ride_seconds=3600, time_limit=1))
        self.assertEqual(r.status, "infeasible")
        self.assertIn("120 minutes from school", r.reasons[0])

    def test_reports_when_fewer_buses_suffice(self):
        stops = [StopIn(str(i), 0, 0, 1, f"S{i}") for i in range(3)]
        n = 4
        dur = [[0 if i == j else 120 for j in range(n)] for i in range(n)]
        r = solve(VRPInput("morning", stops, [BusIn(i, f"B{i}", 10) for i in range(3)], dur, dur, time_limit=1))
        self.assertEqual(r.status, "ok")
        self.assertEqual(r.stats["min_buses"], 1)
        self.assertIn("Only 1 of 3 buses", r.stats["fewer_buses_note"])
