from datetime import timedelta

from django.db import migrations
from django.utils import timezone

ALL = ["timetable", "communication", "attendance", "substitutes", "homework", "grades", "exams", "fees",
       "admissions", "pickup", "transport"]
PLANS = [
    # code, name, max students, modules, JOD / month, is_trial, order
    ("trial", "Free trial (30 days)", 300, ALL, 0, True, 0),
    ("basic", "Basic", 300, ["timetable", "communication", "attendance", "substitutes", "homework"], 49, False, 1),
    ("standard", "Standard", 1000, ["timetable", "communication", "attendance", "substitutes", "homework",
                                    "grades", "exams", "admissions", "pickup"], 129, False, 2),
    ("premium", "Premium", 5000, ALL, 249, False, 3),
]


def forwards(apps, schema_editor):
    Plan = apps.get_model("api", "Plan")
    School = apps.get_model("api", "School")
    Membership = apps.get_model("api", "Membership")
    for code, name, max_students, modules, price, is_trial, order in PLANS:
        Plan.objects.update_or_create(code=code, defaults=dict(
            name=name, max_students=max_students, modules=modules, price_jod_month=price,
            is_trial=is_trial, sort_order=order))
    trial = Plan.objects.get(code="trial")
    for school in School.objects.all():
        school.plan = trial
        school.status = "trial"
        school.trial_ends_at = timezone.now() + timedelta(days=30)
        school.save(update_fields=["plan", "status", "trial_ends_at"])
        Membership.objects.get_or_create(user_id=school.user_id, school=school, role="admin")


class Migration(migrations.Migration):
    dependencies = [("api", "0013_platform_tenancy")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
