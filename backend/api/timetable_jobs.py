"""
Glue between the database and the pure solver in api/scheduling/solver.py, plus a simple DB-backed job runner.

Jobs run in a background thread of the web process (no Celery needed at this scale). The job row is the
single source of truth for progress; the frontend polls it. Set TIMETABLE_JOBS_SYNC=1 to run inline (tests).
"""
import logging
import json
import os
import threading
import time
from datetime import timedelta

from django.conf import settings
from django.db import close_old_connections, transaction
from django.utils import timezone

from .i18n import payload, tr
from .scheduling.messages import Msg

from .models import (
    Classroom, SchedulePeriod, SolverSettings, StudentGroup, Subject, SubjectRequirement, Teacher,
    TeacherAvailablePeriod, TimetableEntry, TimetableJob,
)

log = logging.getLogger(__name__)
LESSON_TYPES = ("lecture", "lab")


def store(message):
    """Job messages are kept as JSON so they can be shown in the reader's language."""
    return json.dumps(payload(message)) if isinstance(message, Msg) else str(message)[:500]


def read_message(text):
    if text and text.startswith('{"t"'):
        try:
            return tr(json.loads(text))
        except ValueError:
            return text
    return tr(text) if text else text


def solver_settings_for(school):
    obj, _ = SolverSettings.objects.get_or_create(school=school)
    return obj


def build_problem(timetable, group_ids=None, teacher_ids=None, time_limit=None):
    """Turn a timetable's school data into a solver Problem.

    Locked entries are always kept. When group_ids/teacher_ids are given, every existing entry that involves
    neither a selected group nor a selected teacher is kept too, so only the selection is regenerated.
    Returns (problem, kept_entry_ids).
    """
    from .scheduling import solver as S

    school = timetable.school
    all_periods = list(SchedulePeriod.objects.filter(schedule=timetable.schedule).order_by("order", "id"))
    periods = [p for p in all_periods if p.type in LESSON_TYPES]
    lesson_ids = {p.id for p in periods}
    adjacent = [(a.id, b.id) for a, b in zip(all_periods, all_periods[1:])
                if a.id in lesson_ids and b.id in lesson_ids]
    days = school.week_day_list

    teachers = []
    avail = {}
    for row in TeacherAvailablePeriod.objects.filter(period__schedule=timetable.schedule):
        avail.setdefault(row.teacher_id, set()).add(row.period_id)
    for t in Teacher.objects.filter(school=school).prefetch_related("subjects").order_by("id"):
        teachers.append(S.Teacher(
            id=t.id, name=t.name,
            subject_ids=frozenset(s.id for s in t.subjects.all() if s.school_id == school.id),
            available_period_ids=frozenset(avail[t.id] & lesson_ids) if t.id in avail else None,
            max_per_day=t.max_lessons_per_day, max_per_week=t.max_lessons_per_week,
        ))

    groups = [S.Group(g.id, g.name, g.size, g.classroom_id)
              for g in StudentGroup.objects.filter(school=school).order_by("id")]
    rooms = [S.Room(r.id, r.name, r.capacity, r.room_type)
             for r in Classroom.objects.filter(school=school).order_by("id")]
    subjects = [S.Subject(s.id, s.name, s.requires_room_type or "", s.is_heavy)
                for s in Subject.objects.filter(school=school).order_by("id")]
    requirements = [S.Requirement(r.student_group_id, r.subject_id, r.lectures_per_week, r.double_periods_per_week)
                    for r in SubjectRequirement.objects.filter(student_group__school=school, lectures_per_week__gt=0)
                    .order_by("student_group_id", "subject_id")]

    group_ids = set(group_ids or [])
    teacher_ids = set(teacher_ids or [])
    partial = bool(group_ids or teacher_ids)
    fixed, kept = [], []
    for e in timetable.entries.all().order_by("id"):
        keep = e.locked or (partial and e.student_group_id not in group_ids and e.teacher_id not in teacher_ids)
        if keep and e.day_of_week in days and e.period_id in lesson_ids:
            fixed.append(S.Lesson(e.student_group_id, e.subject_id, e.teacher_id, e.classroom_id,
                                  e.day_of_week, e.period_id))
            kept.append(e.id)

    cfg = solver_settings_for(school)
    problem = S.Problem(
        days=days, periods=[S.Period(p.id, p.name, p.order) for p in periods], adjacent_pairs=adjacent,
        rooms=rooms, subjects=subjects, teachers=teachers, groups=groups, requirements=requirements,
        fixed=fixed, weights=cfg.effective_weights(),
        time_limit=float(time_limit or cfg.time_limit_seconds),
        workers=max(1, min(8, os.cpu_count() or 1)),
    )
    return problem, kept


def save_lessons(timetable, kept_ids, lessons):
    with transaction.atomic():
        timetable.entries.exclude(id__in=kept_ids).delete()
        TimetableEntry.objects.bulk_create([
            TimetableEntry(timetable=timetable, student_group_id=le.group_id, subject_id=le.subject_id,
                           teacher_id=le.teacher_id, classroom_id=le.room_id, day_of_week=le.day,
                           period_id=le.period_id)
            for le in lessons
        ])


def run_job(job_id, threaded=False):
    from .scheduling.solver import solve

    if threaded:
        close_old_connections()
    job = TimetableJob.objects.select_related("timetable__school", "timetable__schedule").get(id=job_id)
    TimetableJob.objects.filter(id=job_id).update(status="running", started_at=timezone.now(), progress=1,
                                                  message=store(Msg("Preparing data")))
    last = [0.0]

    def progress(frac, message):
        now = time.monotonic()
        if now - last[0] < 1.0 and frac < 0.99:
            return
        last[0] = now
        TimetableJob.objects.filter(id=job_id).update(progress=min(99, int(frac * 100)), message=store(message))

    try:
        params = job.params or {}
        problem, kept = build_problem(job.timetable, params.get("group_ids"), params.get("teacher_ids"),
                                      params.get("time_limit"))
        result = solve(problem, on_progress=progress)
        result_payload = {
            "status": result.status, "score": result.score, "violations": result.violations,
            "reasons": payload(result.reasons), "stats": result.stats, "lessons": len(result.lessons), "kept": len(kept),
        }
        if result.ok:
            save_lessons(job.timetable, kept, result.lessons)
            status, message = "succeeded", Msg("Placed %(n)s lessons (kept %(k)s).", n=len(result.lessons), k=len(kept))
        elif result.status == "infeasible":
            status, message = "infeasible", Msg("No valid timetable exists with the current data.")
        else:
            status, message = "failed", (result.reasons or [Msg("Solver stopped without a timetable.")])[0]
        TimetableJob.objects.filter(id=job_id).update(status=status, progress=100, message=store(message),
                                                      result=result_payload, finished_at=timezone.now())
    except Exception as exc:  # noqa: BLE001 - surface any crash on the job row
        log.exception("Timetable job %s crashed", job_id)
        TimetableJob.objects.filter(id=job_id).update(status="failed", progress=100, finished_at=timezone.now(),
                                                      message=store(Msg("Generator error: %(error)s", error=str(exc)[:300])))
    finally:
        if threaded:
            close_old_connections()


def start_job(timetable, user, params):
    job = TimetableJob.objects.create(timetable=timetable, created_by=user, params=params, message=store(Msg("Queued")))
    if getattr(settings, "TIMETABLE_JOBS_SYNC", False):
        run_job(job.id)
    else:
        threading.Thread(target=run_job, args=(job.id, True), daemon=True, name=f"timetable-job-{job.id}").start()
    job.refresh_from_db()
    return job


def expire_stale(job):
    """A job still 'running' long after its time limit means the server restarted mid-solve."""
    if job.status in ("queued", "running"):
        limit = (job.params or {}).get("time_limit") or 60
        started = job.started_at or job.created_at
        if timezone.now() - started > timedelta(seconds=float(limit) * 3 + 300):
            job.status, job.progress = "failed", 100
            job.message = store(Msg("The generator was interrupted (server restart). Please run it again."))
            job.finished_at = timezone.now()
            job.save(update_fields=["status", "progress", "message", "finished_at"])
    return job
