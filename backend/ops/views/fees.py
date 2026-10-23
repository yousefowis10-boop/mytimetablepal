from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Max, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.access import SchoolAccess, log
from api.notify import notify

from ..common import ALL_ROLES, MANAGERS, SchoolModelViewSet, guardian_users, my_children
from ..models import FeePlan, Installment, Payment, Student, StudentFee, StudentGuardian
from ..serializers import FeePlanSerializer, PaymentSerializer, StudentFeeSerializer

ZERO = Decimal("0")


def money(value):
    """Exact 3-decimal string (JOD fils) - never a float."""
    return str(Decimal(value).quantize(Decimal("0.001")))


def reallocate(student):
    """Spread all of a student's payments over their installments, oldest due date first."""
    total = Payment.objects.filter(student=student).aggregate(s=Sum("amount"))["s"] or ZERO
    with transaction.atomic():
        for inst in Installment.objects.filter(fee__student=student).select_for_update().order_by("due_date", "id"):
            pay = min(total, inst.amount)
            if inst.paid != pay:
                inst.paid = pay
                inst.save(update_fields=["paid"])
            total -= pay
    return total   # credit left over (overpayment)


def statement(student):
    fees = StudentFee.objects.filter(student=student).prefetch_related("installments").order_by("created_at")
    today = timezone.localdate()
    insts = [i for f in fees for i in f.installments.all()]
    billed = sum((f.amount - f.discount for f in fees), ZERO)
    paid = Payment.objects.filter(student=student).aggregate(s=Sum("amount"))["s"] or ZERO
    overdue = sum((i.outstanding for i in insts if i.due_date < today), ZERO)
    next_due = min((i for i in insts if i.outstanding > 0), key=lambda i: i.due_date, default=None)
    return {
        "billed": money(billed), "paid": money(paid), "balance": money(billed - paid),
        "overdue": money(max(overdue, ZERO)),
        "next_due": {"date": next_due.due_date, "amount": money(next_due.outstanding)} if next_due else None,
        "fees": StudentFeeSerializer(fees, many=True).data,
        "payments": PaymentSerializer(Payment.objects.filter(student=student), many=True).data,
    }


class FeePlanViewSet(SchoolModelViewSet):
    model = FeePlan
    serializer_class = FeePlanSerializer
    module = "fees"
    read_roles = MANAGERS
    audit_model = True

    @action(detail=True, methods=["post"])
    def apply(self, request, pk=None, school_id=None):
        """POST {"group_ids": [...]} or {"grade_level": 3} or {"student_ids": [...]}: bill these students."""
        plan = self.get_object()
        school = plan.school
        students = Student.objects.filter(school=school, is_active=True)
        d = request.data
        if d.get("student_ids"):
            students = students.filter(id__in=d["student_ids"])
        elif d.get("group_ids"):
            students = students.filter(group_id__in=d["group_ids"])
        elif d.get("grade_level"):
            students = students.filter(group__grade_level=d["grade_level"])
        else:
            raise ValidationError("Choose students, groups or a grade.")
        created = skipped = 0
        with transaction.atomic():
            for s in students:
                if StudentFee.objects.filter(student=s, plan=plan).exists():
                    skipped += 1
                    continue
                for item in plan.items:
                    amount = Decimal(str(item["amount"]))
                    fee = StudentFee.objects.create(school=school, student=s, plan=plan,
                                                    category=item.get("category", "tuition"),
                                                    description=item.get("description", plan.name), amount=amount)
                    insts = item.get("installments") or [{"due_date": item["due_date"], "amount": item["amount"]}]
                    for x in insts:
                        Installment.objects.create(fee=fee, due_date=x["due_date"], amount=Decimal(str(x["amount"])))
                reallocate(s)
                created += 1
        log(school, request.user, "update", plan, summary=f"Fee plan '{plan.name}' applied to {created} students")
        return Response({"billed_students": created, "already_billed": skipped})


class StudentFeeViewSet(SchoolModelViewSet):
    model = StudentFee
    serializer_class = StudentFeeSerializer
    module = "fees"
    read_roles = MANAGERS
    audit_model = True

    def get_queryset(self):
        qs = StudentFee.objects.filter(school=self.get_school()).select_related("student").prefetch_related("installments")
        if self.request.query_params.get("student"):
            qs = qs.filter(student_id=self.request.query_params["student"])
        return qs

    def perform_create(self, serializer):
        fee = serializer.save(school=self.get_school())
        reallocate(fee.student)
        self.audit("create", fee)

    def perform_update(self, serializer):
        super().perform_update(serializer)
        reallocate(serializer.instance.student)

    def perform_destroy(self, instance):
        student = instance.student
        super().perform_destroy(instance)
        reallocate(student)


def next_receipt_number(school):
    year = timezone.localdate().year
    prefix = f"R{year}-"
    last = Payment.objects.filter(school=school, receipt_number__startswith=prefix).aggregate(m=Max("receipt_number"))["m"]
    n = int(last.split("-")[1]) + 1 if last else 1
    return f"{prefix}{n:05d}"


class PaymentViewSet(SchoolModelViewSet):
    """Cash / transfer / cheque payments recorded by staff. No online card processing in this version."""
    model = Payment
    serializer_class = PaymentSerializer
    module = "fees"
    read_roles = MANAGERS
    audit_model = True
    http_method_names = ["get", "post", "delete", "head", "options"]

    def get_queryset(self):
        qs = Payment.objects.filter(school=self.get_school()).select_related("student", "received_by")
        p = self.request.query_params
        if p.get("student"):
            qs = qs.filter(student_id=p["student"])
        if p.get("from"):
            qs = qs.filter(date__gte=p["from"])
        if p.get("to"):
            qs = qs.filter(date__lte=p["to"])
        return qs

    def perform_create(self, serializer):
        school = self.get_school()
        with transaction.atomic():
            payment = serializer.save(school=school, received_by=self.request.user,
                                      receipt_number=next_receipt_number(school))
            reallocate(payment.student)
        self.audit("create", payment)
        notify(school, guardian_users([payment.student]), "fee_payment", "Payment received",
               f"{payment.amount} {school.currency} for {payment.student.full_name}. "
               f"Receipt {payment.receipt_number}.", link="/fees", channels=("push", "email"))

    def perform_destroy(self, instance):
        student = instance.student
        super().perform_destroy(instance)
        reallocate(student)

    @action(detail=True, methods=["get"])
    def receipt(self, request, pk=None, school_id=None):
        p = self.get_object()
        school = p.school
        st = statement(p.student)
        return Response({
            "school": {"name": school.name, "logo": school.logo, "address": school.address, "phone": school.phone,
                       "currency": school.currency, "brand_color": school.brand_color},
            "payment": PaymentSerializer(p).data, "balance_after": st["balance"],
            "student": {"name": p.student.full_name, "group": p.student.group.name if p.student.group else ""},
        })


class FeeBalancesView(APIView):
    """GET /schools/{id}/fees/balances/?by=family|student&overdue=1 - outstanding balances."""
    permission_classes = [IsAuthenticated]

    def get(self, request, school_id):
        access = SchoolAccess(request, school_id, read_roles=MANAGERS, module="fees")
        school = access.school
        today = timezone.localdate()
        billed = defaultdict(lambda: ZERO)
        for f in StudentFee.objects.filter(school=school).values("student_id", "amount", "discount"):
            billed[f["student_id"]] += f["amount"] - f["discount"]
        paid = defaultdict(lambda: ZERO)
        for p in Payment.objects.filter(school=school).values("student_id").annotate(s=Sum("amount")):
            paid[p["student_id"]] = p["s"]
        overdue = defaultdict(lambda: ZERO)
        for i in Installment.objects.filter(fee__school=school, due_date__lt=today).select_related("fee"):
            overdue[i.fee.student_id] += i.outstanding
        students = {s.id: s for s in Student.objects.filter(school=school).select_related("group")}
        rows = []
        for sid in set(billed) | set(paid):
            s = students.get(sid)
            if not s:
                continue
            rows.append({"student_id": sid, "student": s.full_name, "group": s.group.name if s.group else "",
                         "billed": billed[sid], "paid": paid[sid], "balance": billed[sid] - paid[sid],
                         "overdue": max(overdue[sid], ZERO)})
        if request.query_params.get("by") == "family":
            primary = {}
            for link in StudentGuardian.objects.filter(student__school=school).select_related("guardian") \
                    .order_by("-is_primary", "id"):
                primary.setdefault(link.student_id, link.guardian)
            fam = {}
            for r in rows:
                g = primary.get(r["student_id"])
                key = g.id if g else f"s{r['student_id']}"
                f = fam.setdefault(key, {"family": g.name if g else r["student"], "phone": g.phone if g else "",
                                         "children": [], "billed": ZERO, "paid": ZERO, "balance": ZERO, "overdue": ZERO})
                f["children"].append(r["student"])
                for k in ("billed", "paid", "balance", "overdue"):
                    f[k] += r[k]
            rows = list(fam.values())
        if request.query_params.get("overdue") == "1":
            rows = [r for r in rows if r["overdue"] > 0]
        rows.sort(key=lambda r: -r["balance"])
        keys = ("billed", "paid", "balance", "overdue")
        totals = {k: money(sum((r[k] for r in rows), ZERO)) for k in keys}
        for r in rows:
            for k in keys:
                r[k] = money(r[k])
        return Response({"currency": school.currency, "rows": rows, "totals": totals})


class StudentStatementView(APIView):
    """GET /schools/{id}/students/{sid}/fees/ - staff, or the child's own parents."""
    permission_classes = [IsAuthenticated]

    def get(self, request, school_id, student_id):
        access = SchoolAccess(request, school_id, read_roles=MANAGERS + ("parent",), module="fees")
        student = get_object_or_404(Student, id=student_id, school=access.school)
        if not access.is_manager and not my_children(request.user, access.school).filter(id=student.id).exists():
            raise NotFound()
        return Response({"currency": access.school.currency, "student": student.full_name, **statement(student)})


def send_fee_reminders():
    """Once per installment: N days before the due date, and N days after if still unpaid."""
    today = timezone.localdate()
    qs = Installment.objects.filter(paid__lt=models_F("amount")).select_related("fee__student", "fee__school")
    for inst in qs:
        school = inst.fee.school
        if school.is_suspended or not school.has_module("fees"):
            continue
        s = inst.fee.student
        if not inst.reminder_before_sent and today <= inst.due_date <= today + timedelta(days=school.fee_reminder_days_before):
            notify(school, guardian_users([s]), "fee_reminder", "Fee due soon",
                   f"{inst.outstanding} {school.currency} for {s.full_name} ({inst.fee.description}) is due on "
                   f"{inst.due_date:%d %B}.", link="/fees")
            Installment.objects.filter(id=inst.id).update(reminder_before_sent=True)
        elif not inst.reminder_after_sent and inst.due_date + timedelta(days=school.fee_reminder_days_after) <= today:
            notify(school, guardian_users([s]), "fee_overdue", "Fee overdue",
                   f"{inst.outstanding} {school.currency} for {s.full_name} ({inst.fee.description}) was due on "
                   f"{inst.due_date:%d %B}.", link="/fees")
            Installment.objects.filter(id=inst.id).update(reminder_after_sent=True)


def models_F(name):
    from django.db.models import F
    return F(name)
