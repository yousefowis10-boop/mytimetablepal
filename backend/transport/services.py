"""Transport services (filled in by phase 4)."""
from datetime import timedelta

from django.utils import timezone


def parent_bus_info(school, child, day):
    return None


def driver_today(school, user, day):
    return {"runs": []}


def purge_old_locations():
    from .models import LocationPing, TransportSettings
    for s in TransportSettings.objects.all():
        LocationPing.objects.filter(run__school_id=s.school_id,
                                    at__lt=timezone.now() - timedelta(days=s.location_retention_days)).delete()
