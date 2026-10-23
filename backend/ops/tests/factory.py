"""Builds a small but complete school for tests."""
from datetime import date, time

from django.contrib.auth import get_user_model

from api.models import (
    Classroom, Membership, Plan, School, Schedule, SchedulePeriod, StudentGroup, Subject, SubjectRequirement,
    Teacher, Timetable, TimetableEntry,
)
from ops.models import Guardian, Student, StudentGuardian

User = get_user_model()

TODAY = date(2026, 10, 25)   # a Sunday


def user(email, password="Pw-strong-2026"):
    return User.objects.create_user(username=email, email=email, password=password, first_name=email.split("@")[0])


def build_school(label):
    admin = user(f"admin{label}@ex.com")
    school = School.objects.create(name=f"School {label}", address="Amman", established_year=2000,
                                   principal_name="P", user=admin, phone="06", latitude=31.95, longitude=35.9)
    staff = user(f"staff{label}@ex.com")
    Membership.objects.create(user=staff, school=school, role="staff")

    sched = Schedule.objects.create(school=school, name="Main")
    p1 = SchedulePeriod.objects.create(schedule=sched, name="L1", start_time=time(8), end_time=time(8, 45), order=1)
    p2 = SchedulePeriod.objects.create(schedule=sched, name="L2", start_time=time(8, 45), end_time=time(9, 30), order=2)
    room = Classroom.objects.create(school=school, name=f"R{label}", capacity=30)
    math = Subject.objects.create(school=school, name="Math", code="M")
    eng = Subject.objects.create(school=school, name="English", code="E")
    group = StudentGroup.objects.create(school=school, name=f"Grade 5-{label}", classroom=room, grade_level=5, size=20)
    group2 = StudentGroup.objects.create(school=school, name=f"Grade 6-{label}", classroom=room, grade_level=6, size=20)
    SubjectRequirement.objects.create(student_group=group, subject=math, lectures_per_week=2)

    teacher_user = user(f"teacher{label}@ex.com")
    Membership.objects.create(user=teacher_user, school=school, role="teacher")
    teacher = Teacher.objects.create(school=school, name=f"Ali {label}", experience=3, user=teacher_user)
    teacher.subjects.add(math)
    other_teacher = Teacher.objects.create(school=school, name=f"Sara {label}", experience=3)
    other_teacher.subjects.add(math, eng)
    tt = Timetable.objects.create(schedule=sched, school=school, name="TT", effective_date_start=date(2026, 9, 1),
                                  effective_date_end=date(2027, 6, 1))
    entry = TimetableEntry.objects.create(timetable=tt, student_group=group, day_of_week=7, period=p1,
                                          teacher=teacher, subject=math, classroom=room)
    TimetableEntry.objects.create(timetable=tt, student_group=group2, day_of_week=7, period=p2,
                                  teacher=other_teacher, subject=eng, classroom=room)

    parent_user = user(f"parent{label}@ex.com")
    Membership.objects.create(user=parent_user, school=school, role="parent")
    guardian = Guardian.objects.create(school=school, name=f"Parent {label}", phone="079", user=parent_user,
                                       email=parent_user.email)
    child = Student.objects.create(school=school, first_name=f"Kid{label}", last_name="One", group=group,
                                   medical_notes="Asthma", allergies="Nuts", home_lat=31.96, home_lng=35.91,
                                   home_address="Secret street 1", uses_bus_morning=True, uses_bus_afternoon=True)
    StudentGuardian.objects.create(student=child, guardian=guardian, is_primary=True)

    other_parent = user(f"otherparent{label}@ex.com")
    Membership.objects.create(user=other_parent, school=school, role="parent")
    other_guardian = Guardian.objects.create(school=school, name=f"Other {label}", user=other_parent)
    other_child = Student.objects.create(school=school, first_name=f"Other{label}", group=group,
                                         home_lat=31.97, home_lng=35.92, home_address="Other street 9")
    StudentGuardian.objects.create(student=other_child, guardian=other_guardian, is_primary=True)

    driver = user(f"driver{label}@ex.com")
    Membership.objects.create(user=driver, school=school, role="driver")
    return dict(school=school, admin=admin, staff=staff, teacher_user=teacher_user, teacher=teacher,
                other_teacher=other_teacher, parent=parent_user, guardian=guardian, child=child,
                other_parent=other_parent, other_child=other_child, driver=driver, group=group, group2=group2,
                tt=tt, entry=entry, p1=p1, p2=p2, room=room, math=math, eng=eng)
