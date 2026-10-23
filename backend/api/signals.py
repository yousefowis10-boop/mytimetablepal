from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Membership, School


@receiver(post_save, sender=School)
def owner_is_admin(sender, instance, created, **kwargs):
    """Whoever creates a school is its first admin."""
    if created and instance.user_id:
        Membership.objects.get_or_create(user_id=instance.user_id, school=instance, role="admin")
