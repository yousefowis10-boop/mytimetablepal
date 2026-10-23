from django.apps import AppConfig


class ApiConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'api'

    def ready(self):
        from . import signals  # noqa: F401
        # Background scheduler for reminders etc. Only in the web server (RUN_SCHEDULER=1), never in tests.
        from .tasks import start_scheduler
        start_scheduler()
