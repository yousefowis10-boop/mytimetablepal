from datetime import timedelta

from django.contrib.auth.models import User
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.access import SchoolAccess
from api.notify import notify

from ..common import ALL_ROLES, MANAGERS, SchoolModelViewSet, guardian_users, members, my_children, teacher_for
from ..models import (
    FAQ, Announcement, AnnouncementReceipt, CalendarEvent, Message, MessageThread, Student,
)
from ..serializers import (
    AnnouncementSerializer, CalendarEventSerializer, FAQSerializer, MessageSerializer, ThreadSerializer,
)


def audience_users(a):
    school = a.school
    if a.audience == "school":
        return members(school, *ALL_ROLES)
    if a.audience == "staff":
        return members(school, "admin", "staff", "teacher")
    if a.audience == "parents":
        return members(school, "parent")
    if a.audience == "grade":
        students = Student.objects.filter(school=school, is_active=True, group__grade_level=a.grade_level)
        return guardian_users(students)
    if a.audience == "group":
        return guardian_users(Student.objects.filter(school=school, is_active=True, group=a.group))
    if a.audience == "guardian" and a.guardian and a.guardian.user_id:
        return User.objects.filter(id=a.guardian.user_id)
    return User.objects.none()


def dispatch_announcement(a):
    """Materialize recipients (for read receipts) and notify them. Idempotent."""
    with transaction.atomic():
        a = Announcement.objects.select_for_update().get(id=a.id)
        if a.sent_at:
            return a
        users = list(audience_users(a))
        AnnouncementReceipt.objects.bulk_create(
            [AnnouncementReceipt(announcement=a, user=u) for u in users], ignore_conflicts=True)
        a.sent_at = timezone.now()
        a.save(update_fields=["sent_at"])
    notify(a.school, [u for u in users if u.id != a.author_id], "announcement", a.title,
           a.body[:300], link="/inbox", data={"announcement": a.id})
    return a


def dispatch_due_announcements():
    for a in Announcement.objects.filter(sent_at__isnull=True, publish_at__lte=timezone.now()).select_related("school"):
        if not a.school.is_suspended:
            dispatch_announcement(a)


class AnnouncementViewSet(SchoolModelViewSet):
    model = Announcement
    serializer_class = AnnouncementSerializer
    module = "communication"
    write_roles = MANAGERS + ("teacher",)

    def get_queryset(self):
        qs = Announcement.objects.filter(school=self.get_school()).select_related("author")
        access = self.get_access()
        if not access.is_manager:
            qs = qs.filter(author=self.request.user)
        return qs

    def perform_create(self, serializer):
        access = self.get_access()
        group = serializer.validated_data.get("group")
        if not access.is_manager:
            teacher = teacher_for(self.request.user, access.school)
            if not teacher or not group or not group.timetable_entries.filter(teacher=teacher).exists():
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied("You can only message groups you teach.")
        a = serializer.save(school=access.school, author=self.request.user)
        if a.publish_at <= timezone.now():
            dispatch_announcement(a)

    def perform_update(self, serializer):
        if serializer.instance.sent_at:
            from rest_framework.exceptions import ValidationError
            raise ValidationError("This announcement was already sent and can no longer be edited.")
        a = serializer.save()
        if a.publish_at <= timezone.now():
            dispatch_announcement(a)

    @action(detail=True, methods=["get"])
    def receipts(self, request, pk=None, school_id=None):
        a = self.get_object()
        rows = a.receipts.select_related("user").order_by("read_at", "user__first_name")
        return Response([{"name": r.user.get_full_name() or r.user.username, "read_at": r.read_at} for r in rows])


class InboxView(APIView):
    """GET /schools/{id}/inbox/ - announcements sent to me. POST .../inbox/{receipt}/read/"""
    permission_classes = [IsAuthenticated]

    def get(self, request, school_id):
        access = SchoolAccess(request, school_id, read_roles=ALL_ROLES, module="communication")
        rows = (AnnouncementReceipt.objects.filter(user=request.user, announcement__school=access.school)
                .select_related("announcement", "announcement__author").order_by("-announcement__publish_at")[:200])
        return Response([{
            "id": r.id, "read_at": r.read_at, "title": r.announcement.title, "body": r.announcement.body,
            "urgent": r.announcement.urgent, "published": r.announcement.publish_at,
            "author": (r.announcement.author.get_full_name() or r.announcement.author.username)
            if r.announcement.author else "",
        } for r in rows])

    def post(self, request, school_id, pk=None):
        SchoolAccess(request, school_id, read_roles=ALL_ROLES, write_roles=ALL_ROLES, module="communication")
        r = get_object_or_404(AnnouncementReceipt, id=pk, user=request.user, announcement__school_id=school_id)
        if not r.read_at:
            r.read_at = timezone.now()
            r.save(update_fields=["read_at"])
        return Response({"read_at": r.read_at})


class CalendarEventViewSet(SchoolModelViewSet):
    model = CalendarEvent
    serializer_class = CalendarEventSerializer
    read_roles = ALL_ROLES
    module = "communication"

    def get_queryset(self):
        qs = CalendarEvent.objects.filter(school=self.get_school())
        p = self.request.query_params
        if p.get("from"):
            qs = qs.filter(end_date__gte=p["from"])
        if p.get("to"):
            qs = qs.filter(start_date__lte=p["to"])
        return qs

    @action(detail=False, methods=["post"], url_path="no-school")
    def no_school(self, request, school_id=None):
        """POST {"date": "YYYY-MM-DD", "reason": "..."} - calendar entry + urgent message to everyone."""
        school = self.get_school()
        from ..common import parse_date
        day = parse_date(request.data.get("date"), timezone.localdate() + timedelta(days=1))
        reason = str(request.data.get("reason", ""))[:300]
        event = CalendarEvent.objects.create(school=school, title=f"No school - {reason}" if reason else "No school",
                                             kind="no_school", start_date=day, end_date=day, description=reason)
        a = Announcement.objects.create(school=school, author=request.user, title=f"No school on {day:%A %d %B}",
                                        body=reason or "School is closed on this day.", audience="school", urgent=True)
        dispatch_announcement(a)
        return Response({"event": event.id, "announcement": a.id}, status=status.HTTP_201_CREATED)


class FAQViewSet(SchoolModelViewSet):
    model = FAQ
    serializer_class = FAQSerializer
    read_roles = ALL_ROLES
    module = "communication"


class ThreadViewSet(SchoolModelViewSet):
    """Parents write to the school; admin/staff answer. Parents only ever see their own threads."""
    model = MessageThread
    serializer_class = ThreadSerializer
    read_roles = MANAGERS + ("parent",)
    write_roles = MANAGERS + ("parent",)
    module = "communication"
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        qs = MessageThread.objects.filter(school=self.get_school()).select_related("parent", "student") \
            .prefetch_related("messages__author")
        if not self.get_access().is_manager:
            qs = qs.filter(parent=self.request.user)
        return qs

    def perform_create(self, serializer):
        access = self.get_access()
        student = serializer.validated_data.get("student")
        if student and not my_children(self.request.user, access.school).filter(id=student.id).exists():
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"student": "Unknown student."})
        body = serializer.validated_data.pop("body", "")
        thread = serializer.save(school=access.school, parent=self.request.user)
        if body:
            Message.objects.create(thread=thread, author=self.request.user, body=body)
        notify(access.school, members(access.school, *MANAGERS), "message", f"New message: {thread.subject}",
               body[:200], link="/messages")

    @action(detail=True, methods=["post"])
    def reply(self, request, pk=None, school_id=None):
        thread = self.get_object()
        body = str(request.data.get("body", "")).strip()
        if not body:
            return Response({"error": "Write a message."}, status=400)
        msg = Message.objects.create(thread=thread, author=request.user, body=body)
        thread.status = "open"
        thread.save(update_fields=["status", "updated_at"])
        if request.user.id == thread.parent_id:
            notify(thread.school, members(thread.school, *MANAGERS), "message", f"Reply: {thread.subject}",
                   body[:200], link="/messages")
        else:
            notify(thread.school, [thread.parent], "message", f"Reply from school: {thread.subject}", body[:200],
                   link="/messages")
        return Response(MessageSerializer(msg).data, status=201)

    @action(detail=True, methods=["post"])
    def close(self, request, pk=None, school_id=None):
        thread = self.get_object()
        thread.status = "closed"
        thread.save(update_fields=["status"])
        return Response({"status": "closed"})
