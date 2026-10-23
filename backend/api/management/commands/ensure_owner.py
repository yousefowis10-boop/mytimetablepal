"""Create/update the platform owner from PLATFORM_OWNER_EMAIL / PLATFORM_OWNER_PASSWORD (runs on every start)."""
import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Ensure the platform owner account exists."

    def handle(self, *args, **options):
        email, password = os.getenv("PLATFORM_OWNER_EMAIL"), os.getenv("PLATFORM_OWNER_PASSWORD")
        if not email or not password:
            self.stdout.write("PLATFORM_OWNER_EMAIL / PLATFORM_OWNER_PASSWORD not set; skipping.")
            return
        User = get_user_model()
        user, created = User.objects.get_or_create(username=email.lower(), defaults={"email": email.lower()})
        user.is_superuser = user.is_staff = True
        if created or not user.check_password(password):
            user.set_password(password)
        user.save()
        self.stdout.write(f"Platform owner {'created' if created else 'ok'}: {email}")
