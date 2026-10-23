from datetime import timedelta

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import NotFound
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.access import SchoolAccess, log
from api.views import build_timetable_pages

from ..common import ALL_ROLES, active_timetable, my_children, parse_date, teacher_for, week_bounds
from ..models import (
    AbsenceReport, Announcement, AnnouncementReceipt, AttendanceRecord, CalendarEvent, CoverAssignment, Homework,
    Installment, MessageThread, PickupNotice, Student, TeacherAbsence,
)
from ..serializers import HomeworkSerializer, StudentSerializer
from .attendance import attendance_stats, teacher_lessons
from .fees import money, statement
from decimal import Decimal


def child_today(school, child, day):
    tt = active_timetable(school)
    if not tt or not child.group_id:
        return []
    covers = {c.entry_id: c.covering_teacher.name for c in
              CoverAssignment.objects.filter(date=day, entry__student_group=child.group).select_related("covering_teacher")}
    return [{"period": e.period.name, "start": str(e.period.start_time)[:5], "end": str(e.period.end_time)[:5],
             "subject": e.subject.name, "teacher": covers.get(e.id, e.teacher.name), "room": e.classroom.name,
             "cover": e.id in covers}
            for e in tt.entries.filter(student_group=child.group, day_of_week=day.isoweekday())
            .select_related("period", "subject", "teacher", "classroom").order_by("period__order")]


def child_bus(school, child, day):
    if not school.has_module("transport"):
        return None
    try:
        from transport.services import parent_bus_info
    except ImportError:
        return None
    return parent_bus_info(school, child, day)


class MyChildrenView(APIView):
    """GET /schools/{id}/my/children/ - a parent's overview of their own children only."""
    permission_classes = [IsAuthenticated]

    def get(self, request, school_id):
        access = SchoolAccess(request, school_id, read_roles=("parent",))
        school = access.school
        day = parse_date(request.query_params.get("date"), timezone.localdate())
        start, end = week_bounds(day)
        out = []
        for child in my_children(request.user, school).select_related("group"):
            att = attendance_stats(school, [child], day - timedelta(days=30), day).get(child.id)
            today_att = list(AttendanceRecord.objects.filter(student=child, date=day).select_related("period")
                             .values("status", "period__name"))
            hw = Homework.objects.filter(group=child.group, due_date__gte=start, assigned_date__lte=end) \
                if school.has_module("homework") and child.group_id else Homework.objects.none()
            fees = None
            if school.has_module("fees"):
                st = statement(child)
                fees = {"balance": st["balance"], "overdue": st["overdue"], "next_due": st["next_due"]}
            out.append({
                "child": StudentSerializer(child, context={"school": school, "access": access, "own_child": True}).data,
                "today": child_today(school, child, day),
                "attendance": {"last_30_days": att, "today": today_att},
                "homework": HomeworkSerializer(hw.select_related("subject", "group", "teacher"), many=True).data,
                "fees": fees, "bus": child_bus(school, child, day),
            })
        log(school, request.user, "view", None, summary="Parent viewed children overview",
            model="ops.Student", object_id=",".join(str(c["child"]["id"]) for c in out))
        return Response({"date": day, "children": out, "currency": school.currency})


class MyChildTimetableView(APIView):
    """GET /schools/{id}/my/children/{sid}/timetable/ - the week timetable of the child's class group."""
    permission_classes = [IsAuthenticated]

    def get(self, request, school_id, student_id):
        access = SchoolAccess(request, school_id, read_roles=ALL_ROLES)
        child = my_children(request.user, access.school).filter(id=student_id).first()
        if not child and access.is_staff:
            child = get_object_or_404(Student, id=student_id, school=access.school)
        if not child or not child.group_id:
            raise NotFound()
        tt = active_timetable(access.school)
        if not tt:
            return Response({"pages": [], "days": access.school.week_day_list})
        return Response(build_timetable_pages(tt, "grade", owner_ids={child.group_id}))


class MyTimetableView(APIView):
    """GET /schools/{id}/my/timetable/ - a teacher's own week timetable."""
    permission_classes = [IsAuthenticated]

    def get(self, request, school_id):
        access = SchoolAccess(request, school_id, read_roles=("admin", "staff", "teacher"))
        me = teacher_for(request.user, access.school)
        tt = active_timetable(access.school)
        if not me or not tt:
            return Response({"pages": [], "days": access.school.week_day_list})
        return Response(build_timetable_pages(tt, "teacher", owner_ids={me.id}))


class DashboardView(APIView):
    """GET /schools/{id}/dashboard/ - one bundle per role the user has in this school."""
    permission_classes = [IsAuthenticated]

    def get(self, request, school_id):
        access = SchoolAccess(request, school_id, read_roles=ALL_ROLES)
        school = access.school
        today = timezone.localdate()
        out = {"date": today, "roles": sorted(access.roles), "modules": sorted(school.enabled_modules)}
        if access.is_manager:
            from .academics import at_risk_students
            absent_today = AttendanceRecord.objects.filter(school=school, date=today, status="absent") \
                .values("student").distinct().count()
            absences = TeacherAbsence.objects.filter(school=school, date=today).select_related("teacher")
            from .staffing import affected_entries
            uncovered = 0
            for a in absences:
                covered = set(a.covers.values_list("entry_id", flat=True))
                uncovered += sum(1 for e in affected_entries(a) if e.id not in covered)
            overdue = [i for i in Installment.objects.filter(fee__school=school, due_date__lt=today)
                       .select_related("fee") if i.outstanding > 0]
            out["admin"] = {
                "students": Student.objects.filter(school=school, is_active=True).count(),
                "max_students": school.max_students,
                "students_absent_today": absent_today,
                "absence_reports_today": AbsenceReport.objects.filter(school=school, date_from__lte=today,
                                                                      date_to__gte=today).count(),
                "teachers_absent_today": [{"id": a.id, "teacher": a.teacher.name} for a in absences],
                "uncovered_lessons": uncovered,
                "overdue_fees": {"count": len({i.fee.student_id for i in overdue}),
                                 "amount": money(sum((i.outstanding for i in overdue), Decimal(0)))} if school.has_module("fees") else None,
                "at_risk": at_risk_students(school)[:10] if school.has_module("grades") else [],
                "open_messages": MessageThread.objects.filter(school=school, status="open").count(),
                "recent_announcements": list(Announcement.objects.filter(school=school).order_by("-publish_at")
                                             .values("id", "title", "publish_at", "sent_at")[:5]),
                "upcoming_events": list(CalendarEvent.objects.filter(school=school, end_date__gte=today)
                                        .values("id", "title", "kind", "start_date", "end_date")[:5]),
                "dismissal": {"handed_over": PickupNotice.objects.filter(school=school, date=today,
                                                                          handed_over_at__isnull=False).count()},
                "trial_ends_at": school.trial_ends_at if school.status == "trial" else None,
            }
        if access.has("teacher"):
            me = teacher_for(request.user, school)
            lessons = teacher_lessons(me, today) if me else []
            per_day = school.attendance_mode == "day"
            rows = []
            for e, is_cover in lessons:
                taken = AttendanceRecord.objects.filter(
                    student__group=e.student_group, date=today,
                    **({"period__isnull": True} if per_day else {"period": e.period})).exists()
                rows.append({"entry": e.id, "period": e.period.name, "period_id": e.period_id,
                             "start": str(e.period.start_time)[:5], "group": e.student_group.name,
                             "group_id": e.student_group_id, "subject": e.subject.name, "room": e.classroom.name,
                             "is_cover": is_cover, "attendance_taken": taken})
            start, end = week_bounds(today)
            out["teacher"] = {
                "linked": bool(me), "name": me.name if me else None, "lessons_today": rows,
                "attendance_to_take": sum(1 for r in rows if not r["attendance_taken"]),
                "homework_this_week": HomeworkSerializer(
                    Homework.objects.filter(teacher=me, due_date__gte=start, assigned_date__lte=end)
                    .select_related("group", "subject", "teacher"), many=True).data if me else [],
                "covers_this_week": CoverAssignment.objects.filter(covering_teacher=me, date__gte=start,
                                                                   date__lte=end).count() if me else 0,
            }
        if access.has("parent"):
            out["parent"] = {
                "children": [{"id": c.id, "name": c.full_name, "group": c.group.name if c.group else ""}
                             for c in my_children(request.user, school).select_related("group")],
                "unread": AnnouncementReceipt.objects.filter(user=request.user, announcement__school=school,
                                                             read_at__isnull=True).count(),
            }
        if access.has("driver") and school.has_module("transport"):
            from transport.services import driver_today
            out["driver"] = driver_today(school, request.user, today)
        return Response(out)
