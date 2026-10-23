"""Deterministic synthetic schools for tests and benchmarks (no Django)."""
import math
import random

from .solver import Group, Period, Problem, Requirement, Room, Subject, Teacher

# code: (name, room type, heavy)
SUBJECTS = {
    "ARB": ("Arabic", "", False),
    "ENG": ("English", "", False),
    "MATH": ("Mathematics", "", True),
    "SCI": ("Science", "", False),
    "PHY": ("Physics", "lab", True),
    "CHEM": ("Chemistry", "lab", True),
    "BIO": ("Biology", "lab", False),
    "ISL": ("Islamic Education", "", False),
    "SOC": ("Social Studies", "", False),
    "HIST": ("History", "", False),
    "GEO": ("Geography", "", False),
    "CS": ("Computer Science", "computer_lab", False),
    "PE": ("Physical Education", "gym", False),
    "ART": ("Art", "", False),
    "FR": ("French", "", False),
}
# code: (lessons, doubles)
PRIMARY_PLAN = {"ARB": (7, 0), "ENG": (5, 0), "MATH": (6, 0), "SCI": (4, 0), "ISL": (3, 0), "SOC": (2, 0),
                "CS": (2, 0), "PE": (2, 0), "ART": (3, 1)}
SECONDARY_PLAN = {"ARB": (5, 0), "ENG": (5, 0), "MATH": (6, 0), "PHY": (3, 1), "CHEM": (3, 1), "BIO": (2, 0),
                  "ISL": (3, 0), "HIST": (2, 0), "GEO": (1, 0), "CS": (2, 0), "PE": (1, 0), "FR": (1, 0)}
SECOND_SUBJECT = {"SCI": "BIO", "PHY": "SCI", "CHEM": "SCI", "HIST": "SOC", "GEO": "SOC", "SOC": "HIST"}

DAYS = [7, 1, 2, 3, 4]


def school_problem(groups=30, teachers=55, time_limit=60.0, seed=2026, workers=8):
    """A school shaped like the seeded demo school: Sun-Thu, 7 lessons/day with breaks after 3 and 5.

    Grades are split 60/40 between primary and secondary plans; teachers are spread over subjects in
    proportion to demand; special rooms are sized so the instance is feasible but tight.
    """
    rng = random.Random(seed)
    periods = [Period(i, f"Lesson {i}", order) for i, order in zip(range(1, 8), (1, 2, 3, 5, 6, 8, 9))]
    adjacent = [(1, 2), (2, 3), (4, 5), (6, 7)]
    subjects = [Subject(i, name, rt, heavy) for i, (code, (name, rt, heavy)) in enumerate(SUBJECTS.items(), 1)]
    sid = {code: i for i, code in enumerate(SUBJECTS, 1)}

    n_primary = round(groups * 0.6)
    plans = [PRIMARY_PLAN] * n_primary + [SECONDARY_PLAN] * (groups - n_primary)
    rooms = [Room(i, f"Room {100 + i}", 32, "regular") for i in range(1, groups + 1)]
    gs, reqs = [], []
    for i, plan in enumerate(plans, 1):
        gs.append(Group(i, f"Group {i}", rng.randint(22, 30), home_room_id=i))
        for code, (lessons, doubles) in plan.items():
            reqs.append(Requirement(i, sid[code], lessons, doubles))

    demand = {code: 0 for code in SUBJECTS}
    for plan in plans:
        for code, (lessons, _) in plan.items():
            demand[code] += lessons
    slots = len(DAYS) * len(periods)

    def add_rooms(rtype, label, need, capacity=30):
        nonlocal rooms
        count = max(1, math.ceil(need / (slots * 0.8)))
        start = len(rooms) + 1
        rooms += [Room(start + k, f"{label} {k + 1}", capacity, rtype) for k in range(count)]

    add_rooms("lab", "Science Lab", demand["PHY"] + demand["CHEM"] + demand["BIO"])
    add_rooms("computer_lab", "Computer Lab", demand["CS"])
    add_rooms("gym", "Sports Area", demand["PE"], capacity=60)

    # Every subject gets enough teachers to cover its demand (~26 lessons each, part-timers included);
    # remaining teachers go where demand per teacher is highest. `teachers` is a minimum.
    counts = {code: max(1, math.ceil(d / 26)) for code, d in demand.items() if d}
    while sum(counts.values()) < teachers:
        counts[max(counts, key=lambda c: demand[c] / counts[c])] += 1
    teachers = sum(counts.values())
    lesson_ids = frozenset(p.id for p in periods)
    ts, tid = [], 1
    part_timers = set(rng.sample(range(1, teachers + 1), max(1, teachers // 10)))
    for code, n in counts.items():
        for _ in range(n):
            subj = {sid[code]}
            if code in SECOND_SUBJECT:
                subj.add(sid[SECOND_SUBJECT[code]])
            avail = lesson_ids - {6, 7} if tid in part_timers else None
            ts.append(Teacher(tid, f"Teacher {tid} ({code})", frozenset(subj), avail, max_per_day=6))
            tid += 1
    return Problem(days=DAYS, periods=periods, adjacent_pairs=adjacent, rooms=rooms, subjects=subjects,
                   teachers=ts, groups=gs, requirements=reqs, time_limit=time_limit, seed=seed, workers=workers)
