import os

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .access import SchoolAccess
from .models import AuditLog, Notification, PushSubscription
from .notify import channel_status


class NotificationsView(APIView):
    """GET /api/notifications/?school=&unread=1 - my notifications. POST {"all": true} or {"ids": [...]} marks read."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = Notification.objects.filter(user=request.user).select_related("school")
        if request.query_params.get("school"):
            qs = qs.filter(school_id=request.query_params["school"])
        unread = qs.filter(read_at__isnull=True).count()
        if request.query_params.get("unread") == "1":
            qs = qs.filter(read_at__isnull=True)
        return Response({"unread": unread, "items": [{
            "id": n.id, "school_id": n.school_id, "school": n.school.name, "kind": n.kind, "title": n.title,
            "body": n.body, "link": n.link, "created_at": n.created_at, "read_at": n.read_at,
        } for n in qs[:100]]})

    def post(self, request):
        qs = Notification.objects.filter(user=request.user, read_at__isnull=True)
        if not request.data.get("all"):
            qs = qs.filter(id__in=request.data.get("ids") or [])
        n = qs.update(read_at=timezone.now())
        return Response({"marked": n})


class PushConfigView(APIView):
    """GET /api/push/ - VAPID public key + which channels are live."""
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        return Response({"vapid_public_key": os.getenv("VAPID_PUBLIC_KEY", ""), "channels": channel_status()})


class PushSubscribeView(APIView):
    """POST/DELETE /api/push/subscribe/ with the browser's PushSubscription JSON."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        sub = request.data
        try:
            endpoint, keys = sub["endpoint"], sub["keys"]
            p256dh, auth = keys["p256dh"], keys["auth"]
        except (KeyError, TypeError):
            return Response({"error": "Invalid subscription."}, status=status.HTTP_400_BAD_REQUEST)
        if not str(endpoint).startswith("https://"):
            return Response({"error": "Invalid endpoint."}, status=status.HTTP_400_BAD_REQUEST)
        PushSubscription.objects.update_or_create(endpoint=endpoint, defaults={
            "user": request.user, "p256dh": p256dh, "auth": auth})
        return Response({"ok": True}, status=status.HTTP_201_CREATED)

    def delete(self, request):
        PushSubscription.objects.filter(user=request.user, endpoint=request.data.get("endpoint", "")).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class AuditLogView(APIView):
    """GET /schools/{id}/audit/?model=&user= - who changed timetables, grades, fees (admin only)."""
    permission_classes = [IsAuthenticated]

    def get(self, request, school_id):
        access = SchoolAccess(request, school_id, read_roles=("admin",))
        qs = AuditLog.objects.filter(school=access.school).select_related("user")
        if request.query_params.get("model"):
            qs = qs.filter(model__icontains=request.query_params["model"])
        if request.query_params.get("action"):
            qs = qs.filter(action=request.query_params["action"])
        return Response([{
            "id": a.id, "at": a.created_at, "user": (a.user.get_full_name() or a.user.username) if a.user else "system",
            "action": a.action, "model": a.model, "object_id": a.object_id, "summary": a.summary, "changes": a.changes,
        } for a in qs[:300]])
