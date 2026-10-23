"""
Periodic jobs: scheduled announcements, fee reminders, admissions follow-ups, cover clean-up and deletion of
old bus locations. They run every minute from a background thread in the web process (RUN_SCHEDULER=1) or
via `python manage.py run_periodic` from a cron. A DB lock makes sure only one worker runs them at a time.
"""
import logging
import os
import threading
import time
from datetime import timedelta

from django.db import close_old_connections, transaction
from django.utils import timezone

from .models import TaskLock

log = logging.getLogger(__name__)
INTERVAL = 60


def _jobs():
    from ops.views.admissions import admissions_follow_ups
    from ops.views.comms import dispatch_due_announcements
    from ops.views.fees import send_fee_reminders
    from ops.views.staffing import clear_past_covers
    from transport.services import purge_old_locations
    return [dispatch_due_announcements, send_fee_reminders, admissions_follow_ups, clear_past_covers,
            purge_old_locations]


def run_periodic(force=False):
    with transaction.atomic():
        lock, _ = TaskLock.objects.select_for_update().get_or_create(name="periodic")
        now = timezone.now()
        if not force and lock.last_run and now - lock.last_run < timedelta(seconds=INTERVAL - 5):
            return False
        lock.last_run = now
        lock.save(update_fields=["last_run"])
    for job in _jobs():
        try:
            job()
        except Exception:  # noqa: BLE001 - one failing job must not stop the others
            log.exception("Periodic job %s failed", job.__name__)
    return True


def _loop():
    time.sleep(15)
    while True:
        try:
            close_old_connections()
            run_periodic()
        except Exception:  # noqa: BLE001
            log.exception("Scheduler tick failed")
        finally:
            close_old_connections()
        time.sleep(INTERVAL)


_started = False


def start_scheduler():
    global _started
    if _started or os.getenv("RUN_SCHEDULER") != "1":
        return
    _started = True
    threading.Thread(target=_loop, daemon=True, name="periodic-scheduler").start()
