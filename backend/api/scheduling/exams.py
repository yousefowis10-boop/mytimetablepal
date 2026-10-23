"""
Exam timetabling (pure Python + OR-Tools, no Django).

1. CP-SAT puts every exam into one (date, session) slot: a group never sits two exams at once, at most
   `max_per_day` exams per group per day, never more simultaneous sittings than rooms / invigilators, and
   (soft) a group's exams are spread so they do not land on consecutive days.
2. Each sitting (exam x group) gets the smallest free room that holds the group, then the least-loaded free
   teacher as invigilator (preferring one who does not teach that subject to that group).
"""
from collections import defaultdict
from dataclasses import dataclass, field

from ortools.sat.python import cp_model

from .messages import Msg


@dataclass(frozen=True)
class ExamIn:
    id: int
    name: str
    group_ids: tuple
    subject_teacher_ids: frozenset = frozenset()   # teachers of this subject for these groups


@dataclass
class ExamProblem:
    slots: list            # [(date, session_index)] in chronological order
    exams: list
    groups: dict           # id -> (name, size)
    rooms: list            # [(id, name, capacity)]
    teachers: list         # [(id, name)]
    max_per_day: int = 1
    time_limit: float = 20.0


@dataclass
class ExamResult:
    status: str
    placements: dict = field(default_factory=dict)       # exam id -> (date, session_index)
    sittings: list = field(default_factory=list)          # (exam id, group id, room id, teacher id)
    reasons: list = field(default_factory=list)
    stats: dict = field(default_factory=dict)


def precheck(p: ExamProblem):
    reasons = []
    if not p.slots:
        return [Msg("The exam period has no sessions. Add dates and at least one session per day.")]
    per_group = defaultdict(int)
    for e in p.exams:
        for g in e.group_ids:
            per_group[g] += 1
    days = len({d for d, _ in p.slots})
    for g, n in per_group.items():
        cap = min(len(p.slots), days * p.max_per_day)
        if n > cap:
            reasons.append(Msg("%(group)s has %(n)s exams but the exam period allows at most %(cap)s "
                               "(%(days)s days x %(per_day)s per day).", group=p.groups[g][0], n=n, cap=cap,
                               days=days, per_day=p.max_per_day))
    caps = sorted((c for _, _, c in p.rooms), reverse=True)
    for g, (name, size) in p.groups.items():
        if per_group.get(g) and (not caps or caps[0] < size):
            reasons.append(Msg("No room holds %(group)s (%(size)s students).", group=name, size=size))
    capacity = min(len(p.rooms), len(p.teachers))
    for e in p.exams:
        if len(e.group_ids) > capacity:
            reasons.append(Msg("%(exam)s is sat by %(groups)s groups at the same time, but only %(rooms)s room(s) "
                               "and %(teachers)s invigilator(s) are available.", exam=e.name, groups=len(e.group_ids),
                               rooms=len(p.rooms), teachers=len(p.teachers)))
    sittings = sum(len(e.group_ids) for e in p.exams)
    if sittings > len(p.slots) * min(len(p.rooms), len(p.teachers)):
        reasons.append(Msg("%(sittings)s sittings need a room and an invigilator, but %(sessions)s sessions x "
                           "%(capacity)s rooms/invigilators is not enough.", sittings=sittings, sessions=len(p.slots),
                           capacity=min(len(p.rooms), len(p.teachers))))
    return reasons


def solve_exams(p: ExamProblem) -> ExamResult:
    reasons = precheck(p)
    if reasons:
        return ExamResult("infeasible", reasons=reasons)
    m = cp_model.CpModel()
    x = {(e.id, s): m.NewBoolVar(f"x_{e.id}_{s}") for e in p.exams for s in range(len(p.slots))}
    for e in p.exams:
        m.AddExactlyOne(x[e.id, s] for s in range(len(p.slots)))
    by_group = defaultdict(list)
    for e in p.exams:
        for g in e.group_ids:
            by_group[g].append(e)
    day_slots = defaultdict(list)
    for s, (d, _) in enumerate(p.slots):
        day_slots[d].append(s)
    days = sorted(day_slots)
    capacity = min(len(p.rooms), len(p.teachers))
    for s in range(len(p.slots)):
        m.Add(sum(len(e.group_ids) * x[e.id, s] for e in p.exams) <= capacity)
    penalties = []
    for g, exams in by_group.items():
        for s in range(len(p.slots)):
            m.Add(sum(x[e.id, s] for e in exams) <= 1)
        day_used = {}
        for d in days:
            n = sum(x[e.id, s] for e in exams for s in day_slots[d])
            m.Add(n <= p.max_per_day)
            used = m.NewBoolVar(f"u_{g}_{d}")
            m.Add(n >= 1).OnlyEnforceIf(used)
            m.Add(n == 0).OnlyEnforceIf(used.Not())
            day_used[d] = used
        for d1, d2 in zip(days, days[1:]):
            if (d2 - d1).days == 1:
                both = m.NewBoolVar(f"b_{g}_{d1}")
                m.AddBoolAnd([day_used[d1], day_used[d2]]).OnlyEnforceIf(both)
                m.AddBoolOr([day_used[d1].Not(), day_used[d2].Not(), both])
                penalties.append(both)
    m.Minimize(sum(penalties) if penalties else 0)
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = p.time_limit
    solver.parameters.num_workers = 8
    solver.parameters.random_seed = 7
    st = solver.Solve(m)
    if st not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return ExamResult("infeasible", reasons=[
            Msg("The exams cannot be fitted without a clash. Add exam days or sessions, or allow more exams per day.")],
            stats={"status": solver.StatusName(st)})
    placements = {}
    for (eid, s), v in x.items():
        if solver.Value(v):
            placements[eid] = s
    # Rooms and invigilators, slot by slot.
    load = defaultdict(int)
    sittings, problems = [], []
    rooms_sorted = sorted(p.rooms, key=lambda r: (r[2], r[0]))
    for s in range(len(p.slots)):
        here = [e for e in p.exams if placements[e.id] == s]
        free_rooms = list(rooms_sorted)
        busy_teachers = set()
        demands = sorted(((e, g) for e in here for g in e.group_ids), key=lambda eg: -p.groups[eg[1]][1])
        for e, g in demands:
            size = p.groups[g][1]
            room = next((r for r in free_rooms if r[2] >= size), None)
            if room is None:
                problems.append(Msg("No free room for %(group)s (%(exam)s).", group=p.groups[g][0], exam=e.name))
                continue
            free_rooms.remove(room)
            candidates = [t for t in p.teachers if t[0] not in busy_teachers]
            candidates.sort(key=lambda t: (t[0] in e.subject_teacher_ids, load[t[0]], t[0]))
            teacher = candidates[0]
            busy_teachers.add(teacher[0])
            load[teacher[0]] += 1
            sittings.append((e.id, g, room[0], teacher[0]))
    if problems:
        return ExamResult("infeasible", reasons=problems)
    return ExamResult(
        "optimal" if st == cp_model.OPTIMAL else "feasible",
        placements={eid: p.slots[s] for eid, s in placements.items()}, sittings=sittings,
        stats={"consecutive_days": int(solver.ObjectiveValue()) if penalties else 0,
               "max_invigilations": max(load.values()) if load else 0, "seconds": round(solver.WallTime(), 2)})
