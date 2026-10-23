"""School buses: settings, buses, optimized routes, daily runs and live tracking."""
from datetime import time

from django.contrib.auth.models import User
from django.db import models

from api.models import School
from ops.models import Student

PROVIDERS = [
    ("osrm", "OSRM (OpenStreetMap) - URL in ROUTING_OSRM_URL"),
    ("ors", "OpenRouteService - key in ROUTING_ORS_KEY"),
    ("google", "Google Routes API - key in ROUTING_GOOGLE_KEY"),
    ("haversine", "Straight-line estimate (offline fallback)"),
]


class TransportSettings(models.Model):
    school = models.OneToOneField(School, related_name="transport_settings", on_delete=models.CASCADE)
    school_start_time = models.TimeField(default=time(7, 45))
    arrival_buffer_minutes = models.PositiveIntegerField(default=10, help_text="Arrive this long before school starts")
    max_ride_minutes = models.PositiveIntegerField(default=60)
    stop_minutes = models.FloatField(default=1.0, help_text="Time spent at each stop")
    siblings_share_stop = models.BooleanField(default=True)
    walk_to_stop = models.BooleanField(default=False, help_text="Group nearby homes into shared stops")
    walk_radius_m = models.PositiveIntegerField(default=300)
    weight_distance = models.PositiveIntegerField(default=1, help_text="Cost of 1 km")
    weight_ride_time = models.PositiveIntegerField(default=1, help_text="Cost of 1 child-minute on the bus")
    afternoon_wave_minutes = models.PositiveIntegerField(default=15, help_text="Children leaving within this window share a wave")
    provider = models.CharField(max_length=20, choices=PROVIDERS, default="osrm")
    location_retention_days = models.PositiveIntegerField(default=7)
    eta_notify_minutes = models.PositiveIntegerField(default=5)
    late_notify_minutes = models.PositiveIntegerField(default=10)
    solver_seconds = models.PositiveIntegerField(default=20)


class Bus(models.Model):
    school = models.ForeignKey(School, related_name="buses", on_delete=models.CASCADE)
    name = models.CharField(max_length=60)
    plate = models.CharField(max_length=30, blank=True, default="")
    capacity = models.PositiveIntegerField(default=30)
    driver = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="buses")
    driver_name = models.CharField(max_length=150, blank=True, default="")
    driver_phone = models.CharField(max_length=40, blank=True, default="")
    fuel_l_per_100km = models.FloatField(default=18.0)
    fuel_price_per_l = models.DecimalField(max_digits=6, decimal_places=3, default=0.9)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class LeaveTimeOverride(models.Model):
    """A child leaves at a different time on one day (afternoon routes)."""
    school = models.ForeignKey(School, on_delete=models.CASCADE)
    student = models.ForeignKey(Student, related_name="leave_overrides", on_delete=models.CASCADE)
    date = models.DateField()
    leave_time = models.TimeField(null=True, blank=True, help_text="Empty = not on the bus that day")

    class Meta:
        unique_together = ("student", "date")


class RoutePlan(models.Model):
    DIRECTIONS = [("morning", "Morning (to school)"), ("afternoon", "Afternoon (home)")]
    school = models.ForeignKey(School, related_name="route_plans", on_delete=models.CASCADE)
    direction = models.CharField(max_length=10, choices=DIRECTIONS)
    date = models.DateField(null=True, blank=True, help_text="Empty = the regular plan for every day")
    wave_time = models.TimeField(null=True, blank=True, help_text="Departure time of an afternoon wave")
    status = models.CharField(max_length=20, default="ok")
    summary = models.JSONField(default=dict, blank=True)
    created_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    is_current = models.BooleanField(default=True)

    class Meta:
        ordering = ["-created_at"]


class Route(models.Model):
    plan = models.ForeignKey(RoutePlan, related_name="routes", on_delete=models.CASCADE)
    bus = models.ForeignKey(Bus, related_name="routes", on_delete=models.CASCADE)
    depart_time = models.TimeField()
    arrive_time = models.TimeField()
    total_km = models.FloatField(default=0)
    total_minutes = models.FloatField(default=0)
    fuel_litres = models.FloatField(default=0)
    fuel_cost = models.DecimalField(max_digits=10, decimal_places=3, default=0)
    student_minutes = models.FloatField(default=0, help_text="Sum of ride minutes of all children")
    geometry = models.JSONField(default=list, blank=True, help_text="[[lat, lng], ...] for the map")


class RouteStop(models.Model):
    route = models.ForeignKey(Route, related_name="stops", on_delete=models.CASCADE)
    order = models.PositiveIntegerField()
    lat = models.FloatField()
    lng = models.FloatField()
    label = models.CharField(max_length=200, blank=True, default="")
    eta = models.TimeField()
    is_school = models.BooleanField(default=False)
    students = models.ManyToManyField(Student, related_name="route_stops", blank=True)

    class Meta:
        ordering = ["order"]


class ManualRoute(models.Model):
    """The routes a school uses today, entered by the admin, for a before/after comparison."""
    school = models.ForeignKey(School, related_name="manual_routes", on_delete=models.CASCADE)
    bus = models.ForeignKey(Bus, on_delete=models.CASCADE)
    direction = models.CharField(max_length=10, choices=RoutePlan.DIRECTIONS)
    student_order = models.JSONField(default=list, help_text="Student ids in stop order")


class RouteRun(models.Model):
    """One bus driving one route on one day; live tracking happens here."""
    STATUSES = [("planned", "Planned"), ("active", "Running"), ("completed", "Completed")]
    school = models.ForeignKey(School, related_name="route_runs", on_delete=models.CASCADE)
    route = models.ForeignKey(Route, related_name="runs", on_delete=models.CASCADE)
    date = models.DateField()
    driver = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name="+")
    status = models.CharField(max_length=10, choices=STATUSES, default="planned")
    started_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    last_lat = models.FloatField(null=True, blank=True)
    last_lng = models.FloatField(null=True, blank=True)
    last_seen = models.DateTimeField(null=True, blank=True)
    delay_minutes = models.FloatField(default=0)
    next_stop_order = models.PositiveIntegerField(default=1)
    notified = models.JSONField(default=dict, blank=True, help_text="Which ETA/late messages were sent")

    class Meta:
        unique_together = ("route", "date")


class RunEvent(models.Model):
    KINDS = [("picked_up", "Picked up"), ("dropped_off", "Dropped off"), ("absent", "Absent"),
             ("stop_arrived", "Arrived at stop")]
    run = models.ForeignKey(RouteRun, related_name="events", on_delete=models.CASCADE)
    stop = models.ForeignKey(RouteStop, null=True, on_delete=models.SET_NULL)
    student = models.ForeignKey(Student, null=True, blank=True, on_delete=models.CASCADE)
    kind = models.CharField(max_length=20, choices=KINDS)
    at = models.DateTimeField(auto_now_add=True)


class LocationPing(models.Model):
    """Raw GPS from the driver's phone. Deleted after TransportSettings.location_retention_days."""
    run = models.ForeignKey(RouteRun, related_name="pings", on_delete=models.CASCADE)
    lat = models.FloatField()
    lng = models.FloatField()
    accuracy = models.FloatField(null=True, blank=True)
    at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["at"])]


class DistanceCache(models.Model):
    provider = models.CharField(max_length=20)
    key = models.CharField(max_length=64, unique=True, help_text="sha256 of the ordered coordinates")
    durations = models.JSONField()
    distances = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)
