"""Server-side translation helpers (Arabic / English).

- API responses follow the request language (Accept-Language, set by the app) via LocaleMiddleware.
- Notifications are written in each recipient's own language (profile, else the school default).
- Optimizer explanations are stored as templates + parameters and translated when they are read.
"""
from datetime import date, datetime, time

from django.utils import timezone, translation
from django.utils.translation import gettext

from .scheduling.messages import Msg

SUPPORTED = ("ar", "en")
AR_MONTHS = ["كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول",
             "تشرين الثاني", "كانون الأول"]
AR_DAYS = ["الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"]
EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
             "November", "December"]
EN_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def format_value(value, lang=None):
    """Dates and times written the way people read them in Jordan, in either language."""
    lang = lang or translation.get_language() or "en"
    ar = lang.startswith("ar")
    if isinstance(value, datetime):
        value = timezone.localtime(value) if timezone.is_aware(value) else value
        return f"{format_value(value.date(), lang)} {value:%H:%M}"
    if isinstance(value, date):
        days, months = (AR_DAYS, AR_MONTHS) if ar else (EN_DAYS, EN_MONTHS)
        return f"{days[value.weekday()]} {value.day} {months[value.month - 1]}"
    if isinstance(value, time):
        return value.strftime("%H:%M")
    if isinstance(value, Msg):
        return tr(value)
    return value


def payload(value):
    """JSON-safe form of a message for storing in the DB (keeps it translatable)."""
    if isinstance(value, Msg):
        return value.as_payload()
    if isinstance(value, (list, tuple)):
        return [payload(v) for v in value]
    return value


def tr(value):
    """Translate a message (Msg, stored payload, plain string or list of them) into the active language."""
    if isinstance(value, list):
        return [tr(v) for v in value]
    if isinstance(value, Msg):
        params = {k: format_value(v) for k, v in value.params.items()}
        template = value.template
    elif isinstance(value, dict) and "t" in value:
        params = {k: tr(v) if isinstance(v, dict) else v for k, v in (value.get("p") or {}).items()}
        template = value["t"]
    elif isinstance(value, str) and value:
        return gettext(value)
    else:
        return value
    try:
        return gettext(template) % params if params else gettext(template)
    except (KeyError, ValueError, TypeError):
        return template % params if params else template


def render(value, lang):
    with translation.override(lang):
        return tr(value)


def user_language(user, school=None):
    lang = getattr(getattr(user, "profile", None), "language", "") or ""
    if lang not in SUPPORTED:
        lang = getattr(school, "default_language", "") or "ar"
    return lang if lang in SUPPORTED else "ar"
