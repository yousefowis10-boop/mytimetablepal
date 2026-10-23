from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.access import SchoolAccess
from api.notify import notify

from ..common import MANAGERS, guardian_users, my_children, parse_date
from ..models import PickupNotice, Student
from ..serializers import PickupNoticeSerializer

STAFF = ("admin", "staff", "teacher")


class MyPickupView(APIView):
    """GET/POST /schools/{id}/my/pickup/?date= - a parent says who picks each child up today."""
    permission_classes = [IsAuthenticated]

    def get(self, request, school_id):
        access = SchoolAccess(request, school_id, read_roles=("parent",), module="pickup")
        day = parse_date(request.query_params.get("date"), timezone.localdate())
        kids = my_children(request.user, access.school)
        notices = {n.student_id: n for n in PickupNotice.objects.filter(student__in=kids, date=day)}
        return Response([{
            "student": k.id, "name": k.full_name, "pickup_permissions": k.pickup_permissions,
            "default_mode": "bus" if k.uses_bus_afternoon else "parent",
            "notice": PickupNoticeSerializer(notices[k.id]).data if k.id in notices else None,
        } for k in kids])

    def post(self, request, school_id):
        access = SchoolAccess(request, school_id, read_roles=("parent",), write_roles=("parent",), module="pickup")
        student = my_children(request.user, access.school).filter(id=request.data.get("student")).first()
        if not student:
            raise ValidationError({"student": "Unknown student."})
        s = PickupNoticeSerializer(data={**request.data, "student": student.id})
        s.is_valid(raise_exception=True)
        if s.validated_data["mode"] == "other" and not s.validated_data.get("person_name"):
            raise ValidationError({"person_name": "Who is picking up?"})
        notice, _ = PickupNotice.objects.update_or_create(
            student=student, date=s.validated_data["date"],
            defaults={"school": access.school, "mode": s.validated_data["mode"],
                      "person_name": s.validated_data.get("person_name", ""), "note": s.validated_data.get("note", ""),
                      "created_by": request.user})
        return Response(PickupNoticeSerializer(notice).data, status=201)


class DismissalView(APIView):
    """GET /schools/{id}/dismissal/?date=&group= - live list for staff. POST {"student", "handed_to"} hands over."""
    permission_classes = [IsAuthenticated]

    def get(self, request, school_id):
        access = SchoolAccess(request, school_id, read_roles=STAFF, module="pickup")
        day = parse_date(request.query_params.get("date"), timezone.localdate())
        students = Student.objects.filter(school=access.school, is_active=True).select_related("group")
        if request.query_params.get("group"):
            students = students.filter(group_id=request.query_params["group"])
        notices = {n.student_id: n for n in PickupNotice.objects.filter(school=access.school, date=day)}
        rows = []
        for s in students.order_by("group__name", "first_name"):
            n = notices.get(s.id)
            mode = n.mode if n else ("bus" if s.uses_bus_afternoon else "parent")
            rows.append({"student": s.id, "name": s.full_name, "group": s.group.name if s.group else "",
                         "mode": mode, "person_name": n.person_name if n else "", "note": n.note if n else "",
                         "parent_confirmed": bool(n), "handed_over_at": n.handed_over_at if n else None,
                         "handed_over_to": n.handed_over_to if n else "",
                         "allowed_people": [p.get("name") for p in s.pickup_permissions or []]})
        done = sum(1 for r in rows if r["handed_over_at"])
        return Response({"date": day, "total": len(rows), "handed_over": done, "students": rows})

    def post(self, request, school_id):
        access = SchoolAccess(request, school_id, read_roles=STAFF, write_roles=STAFF, module="pickup")
        student = get_object_or_404(Student, id=request.data.get("student"), school=access.school)
        day = parse_date(request.data.get("date"), timezone.localdate())
        notice, _ = PickupNotice.objects.get_or_create(
            student=student, date=day,
            defaults={"school": access.school, "mode": "bus" if student.uses_bus_afternoon else "parent"})
        if request.data.get("undo"):
            notice.handed_over_at = None
            notice.handed_over_to = ""
            notice.handed_over_by = None
        else:
            notice.handed_over_at = timezone.now()
            notice.handed_over_by = request.user
            notice.handed_over_to = str(request.data.get("handed_to") or notice.person_name or notice.get_mode_display())[:150]
        notice.save()
        if notice.handed_over_at:
            notify(access.school, guardian_users([student]), "pickup", f"{student.first_name} has left school",
                   f"Handed over to {notice.handed_over_to} at {timezone.localtime(notice.handed_over_at):%H:%M}.",
                   link="/children", channels=("push",))
        return Response(PickupNoticeSerializer(notice).data)
