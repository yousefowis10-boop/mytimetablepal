from django.core.management.base import BaseCommand

from api.tasks import run_periodic


class Command(BaseCommand):
    help = "Run scheduled jobs once (announcements, reminders, follow-ups, clean-up)."

    def handle(self, *args, **options):
        run_periodic(force=True)
        self.stdout.write("Periodic jobs done.")
