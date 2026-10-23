"""
One notification service for every module (attendance, announcements, covers, fees, buses, admissions).

notify(school, users, kind, title, body, link) always stores an in-app notification and then fans out to
the external channels that are configured. Channels share one tiny interface, so SMS and WhatsApp can be
switched on later by adding credentials - no module code changes.

Configured by environment variables:
  Web push : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...)
  Email    : EMAIL_HOST, EMAIL_PORT, EMAIL_HOST_USER, EMAIL_HOST_PASSWORD, DEFAULT_FROM_EMAIL
  SMS      : SMS_PROVIDER (not connected yet - see README for providers and costs)
  WhatsApp : WHATSAPP_PROVIDER (not connected yet)
"""
import json
import logging
import os
import threading

from django.conf import settings
from django.core.mail import send_mail
from django.db import close_old_connections

from .models import Notification, PushSubscription, UserProfile

log = logging.getLogger(__name__)


class Channel:
    name = "base"

    def enabled(self):
        return False

    def send(self, user, notification):
        raise NotImplementedError


class PushChannel(Channel):
    name = "push"

    def enabled(self):
        return bool(os.getenv("VAPID_PRIVATE_KEY") and os.getenv("VAPID_PUBLIC_KEY"))

    def send(self, user, notification):
        profile = UserProfile.objects.filter(user=user).first()
        if profile and not profile.push_notifications:
            return False
        from pywebpush import WebPushException, webpush
        payload = json.dumps({"title": notification.title, "body": notification.body,
                              "url": notification.link or "/", "kind": notification.kind})
        sent = False
        for sub in PushSubscription.objects.filter(user=user):
            try:
                webpush(
                    subscription_info={"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
                    data=payload, vapid_private_key=os.getenv("VAPID_PRIVATE_KEY"),
                    vapid_claims={"sub": os.getenv("VAPID_SUBJECT", "mailto:admin@example.com")}, ttl=3600,
                )
                sent = True
            except WebPushException as exc:
                status = getattr(getattr(exc, "response", None), "status_code", None)
                if status in (404, 410):
                    sub.delete()          # browser unsubscribed
                else:
                    log.warning("Push failed for user %s: %s", user.id, exc)
        return sent


class EmailChannel(Channel):
    name = "email"

    def enabled(self):
        return bool(getattr(settings, "EMAIL_HOST", "") and settings.EMAIL_HOST != "localhost") or \
            settings.EMAIL_BACKEND.endswith("locmem.EmailBackend")

    def send(self, user, notification):
        profile = UserProfile.objects.filter(user=user).first()
        if not user.email or (profile and not profile.email_notifications):
            return False
        link = notification.link
        if link and link.startswith("/"):
            link = os.getenv("FRONTEND_URL", "").rstrip("/") + link
        body = notification.body + (f"\n\n{link}" if link else "")
        send_mail(f"[{notification.school.name}] {notification.title}", body, None, [user.email],
                  fail_silently=True)
        return True


class NotConnectedChannel(Channel):
    """SMS / WhatsApp placeholder: same interface, intentionally inactive until a provider is chosen."""

    def __init__(self, name, env):
        self.name, self.env = name, env

    def enabled(self):
        return False   # flip on when a provider adapter + credentials exist (see README "SMS & WhatsApp")

    def send(self, user, notification):
        return False


CHANNELS = [PushChannel(), EmailChannel(), NotConnectedChannel("sms", "SMS_PROVIDER"),
            NotConnectedChannel("whatsapp", "WHATSAPP_PROVIDER")]


def _fan_out(notification_ids, channels, threaded=False):
    if threaded:
        close_old_connections()
    try:
        for n in Notification.objects.filter(id__in=notification_ids).select_related("user", "school"):
            sent = ["inapp"]
            for ch in CHANNELS:
                if ch.name in channels and ch.enabled():
                    try:
                        if ch.send(n.user, n):
                            sent.append(ch.name)
                    except Exception:  # noqa: BLE001 - a failing channel must not break the others
                        log.exception("Channel %s failed", ch.name)
            Notification.objects.filter(id=n.id).update(channels_sent=sent)
    finally:
        if threaded:
            close_old_connections()


def notify(school, users, kind, title, body="", link="", data=None, channels=("push", "email")):
    """Create in-app notifications for `users` (deduplicated) and send them on the external channels."""
    seen, rows = set(), []
    for u in users:
        if u is None or u.id in seen:
            continue
        seen.add(u.id)
        rows.append(Notification(school=school, user=u, kind=kind, title=title[:200], body=body, link=link,
                                 data=data or {}, channels_sent=["inapp"]))
    if not rows:
        return []
    created = Notification.objects.bulk_create(rows)
    ids = [n.id for n in created if n.id]
    if ids and channels:
        if getattr(settings, "NOTIFY_SYNC", False):
            _fan_out(ids, channels)
        else:
            threading.Thread(target=_fan_out, args=(ids, channels, True), daemon=True).start()
    return created


def channel_status():
    return {ch.name: ch.enabled() for ch in CHANNELS} | {"inapp": True}
