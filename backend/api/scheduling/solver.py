"""
Timetable optimizer built on Google OR-Tools CP-SAT.

Pure Python: no Django imports, so it can be unit-tested and benchmarked on plain data.

Two stages:
  1. Teacher assignment - decide which qualified teacher(s) teach each group's subject, preferring
     one teacher per group+subject and an even load between teachers of the same subject.
  2. Placement - put every lesson into a (day, period) slot and a room so that no group, teacher or
     room is double-booked, teachers are only used when available, doubles are back-to-back, and the
     weighted soft-constraint penalty is as small as possible within the time limit.

Hard constraints are never relaxed. If no valid timetable exists, `solve()` returns
status "infeasible" with plain-language reasons (pre-check first, then an unsat-core diagnosis).
"""
from __future__ import annotations

import math
import time
from collections import defaultdict
from dataclasses import dataclass, field

from ortools.sat.python import cp_model

INTERLEAVE = True
DET_PER_SECOND = 0.3

DEFAULT_WEIGHTS = {
    "spread": 10,
    "teacher_gaps": 3,
    "heavy_late": 2,
    "room_change": 1,
    "teacher_split": 8,
    "load_balance": 1,
}

ROOM_TYPE_LABELS = {
    "regular": "regular classroom",
    "lab": "science lab",
    "computer_lab": "computer lab",
    "gym": "gym / sports area",
    "other": "special room",
}

DAY_NAMES = {1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday", 7: "Sunday"}


# ---------------------------------------------------------------- input / output types
@dataclass(frozen=True)
class Period:
    id: int
    name: str
    order: int


@dataclass(frozen=True)
class Room:
    id: int
    name: str
    capacity: int
    room_type: str = "regular"


@dataclass(frozen=True)
class Subject:
    id: int
    name: str
    requires_room_type: str = ""
    heavy: bool = False


@dataclass(frozen=True)
class Teacher:
    id: int
    name: str
    subject_ids: frozenset
    # Period ids the teacher can teach in (every day). None = availability not configured = always.
    available_period_ids: frozenset | None = None
    max_per_day: int | None = None
    max_per_week: int | None = None


@dataclass(frozen=True)
class Group:
    id: int
    name: str
    size: int
    home_room_id: int | None = None


@dataclass(frozen=True)
class Requirement:
    group_id: int
    subject_id: int
    lessons: int
    doubles: int = 0


@dataclass(frozen=True)
class Lesson:
    group_id: int
    subject_id: int
    teacher_id: int
    room_id: int
    day: int
    period_id: int


@dataclass
class Problem:
    days: list
    periods: list              # lesson periods only (lecture/lab), any order; sorted by `order` internally
    adjacent_pairs: list       # (period_id, period_id) that are back-to-back with no break between
    rooms: list
    subjects: list
    teachers: list
    groups: list
    requirements: list
    fixed: list = field(default_factory=list)   # locked / kept lessons the solver must not move
    weights: dict = field(default_factory=dict)
    time_limit: float = 60.0
    seed: int = 12345
    workers: int = 8


@dataclass
class Result:
    status: str                       # optimal | feasible | infeasible | timeout | error
    lessons: list = field(default_factory=list)   # new lessons (fixed ones are not repeated)
    reasons: list = field(default_factory=list)
    violations: dict = field(default_factory=dict)
    score: float | None = None
    stats: dict = field(default_factory=dict)

    @property
    def ok(self):
        return self.status in ("optimal", "feasible")


class _Index:
    """Name lookups and derived data shared by the pre-check, model and validator."""

    def __init__(self, p: Problem):
        self.p = p
        self.periods = sorted(p.periods, key=lambda x: x.order)
        self.period_pos = {per.id: i for i, per in enumerate(self.periods)}
        self.days = list(p.days)
        self.slots = [(d, per.id) for d in self.days for per in self.periods]
        self.room = {r.id: r for r in p.rooms}
        self.subject = {s.id: s for s in p.subjects}
        self.teacher = {t.id: t for t in p.teachers}
        self.group = {g.id: g for g in p.groups}
        self.weights = dict(DEFAULT_WEIGHTS)
        self.weights.update(p.weights or {})
        valid_pairs = set()
        for a, b in p.adjacent_pairs:
            if a in self.period_pos and b in self.period_pos:
                if self.period_pos[a] > self.period_pos[b]:
                    a, b = b, a
                valid_pairs.add((a, b))
        self.pairs = sorted(valid_pairs, key=lambda ab: self.period_pos[ab[0]])
        self.home_count = defaultdict(int)
        for g in p.groups:
            if g.home_room_id is not None:
                self.home_count[g.home_room_id] += 1
        self.homes = set(self.home_count)

        self.fixed_group = set()
        self.fixed_teacher = set()
        self.fixed_room = set()
        self.fixed_count = defaultdict(int)          # (group, subject) -> fixed lessons
        self.fixed_teacher_load = defaultdict(int)
        self.fixed_teacher_day = defaultdict(int)
        self.fixed_pair_teacher = defaultdict(set)   # (group, subject) -> teachers already teaching it
        for f in p.fixed:
            self.fixed_group.add((f.group_id, f.day, f.period_id))
            self.fixed_teacher.add((f.teacher_id, f.day, f.period_id))
            self.fixed_room.add((f.room_id, f.day, f.period_id))
            self.fixed_count[(f.group_id, f.subject_id)] += 1
            self.fixed_teacher_load[f.teacher_id] += 1
            self.fixed_teacher_day[(f.teacher_id, f.day)] += 1
            self.fixed_pair_teacher[(f.group_id, f.subject_id)].add(f.teacher_id)

    def teacher_available(self, t: Teacher, period_id):
        return t.available_period_ids is None or period_id in t.available_period_ids

    def teacher_slots(self, t: Teacher):
        return [(d, pid) for d, pid in self.slots
                if self.teacher_available(t, pid) and (t.id, d, pid) not in self.fixed_teacher]

    def teacher_capacity(self, t: Teacher):
        free = len(self.teacher_slots(t))
        if t.max_per_day is not None:
            per_day = defaultdict(int)
            for d, _ in self.teacher_slots(t):
                per_day[d] += 1
            free = sum(min(n, max(0, t.max_per_day - self.fixed_teacher_day[(t.id, d)])) for d, n in per_day.items())
        if t.max_per_week is not None:
            free = min(free, max(0, t.max_per_week - self.fixed_teacher_load[t.id]))
        return free

    def qualified(self, subject_id):
        return [t for t in sorted(self.p.teachers, key=lambda x: x.id) if subject_id in t.subject_ids]

    def remaining(self, req: Requirement):
        return max(0, req.lessons - self.fixed_count[(req.group_id, req.subject_id)])

    def room_candidates(self, req: Requirement):
        """Rooms a lesson of this requirement may use, home room first. Never exceeds capacity."""
        g = self.group[req.group_id]
        s = self.subject[req.subject_id]
        fits = [r for r in sorted(self.p.rooms, key=lambda r: (r.capacity, r.id)) if r.capacity >= g.size]
        if s.requires_room_type:
            return [r for r in fits if r.room_type == s.requires_room_type], None
        home = self.room.get(g.home_room_id) if g.home_room_id is not None else None
        home_ok = home is not None and home.capacity >= g.size
        if home_ok and self.home_count[home.id] == 1:
            return [home], home.id
        spares = [r for r in fits if r.room_type == "regular" and r.id not in self.homes]
        if not spares:
            spares = [r for r in fits if r.room_type == "regular" and (not home_ok or r.id != home.id)]
        cands = ([home] if home_ok else []) + spares[:4]
        return cands, (home.id if home_ok else None)


# ---------------------------------------------------------------- pre-check
def precheck(p: Problem) -> list:
    """Cheap checks for obviously impossible input. Returns plain-language reasons (empty = OK)."""
    ix = _Index(p)
    reasons = []
    lesson_slots = len(ix.slots)
    if not ix.periods or not ix.days:
        return ["The bell schedule has no lesson periods (or the school week has no days), so nothing can be scheduled."]

    group_total = defaultdict(int)
    for req in p.requirements:
        group_total[req.group_id] += req.lessons
    for gid, total in sorted(group_total.items()):
        g = ix.group[gid]
        if total > lesson_slots:
            reasons.append(f"{g.name} needs {total} lessons a week but the week only has {lesson_slots} lesson periods.")

    room_type_demand = defaultdict(int)
    subject_demand = defaultdict(int)
    for req in sorted(p.requirements, key=lambda r: (ix.group[r.group_id].name, ix.subject[r.subject_id].name)):
        g, s = ix.group[req.group_id], ix.subject[req.subject_id]
        rem = ix.remaining(req)
        if req.lessons and rem == 0:
            continue
        teachers = ix.qualified(req.subject_id)
        if not teachers:
            reasons.append(f"{g.name} needs {s.name} but no teacher is qualified to teach {s.name}.")
            continue
        rooms, _ = ix.room_candidates(req)
        if not rooms:
            if s.requires_room_type:
                label = ROOM_TYPE_LABELS.get(s.requires_room_type, s.requires_room_type)
                reasons.append(f"{g.name} ({g.size} students) needs a {label} for {s.name}, "
                               f"but no {label} holds {g.size} students.")
            else:
                reasons.append(f"{g.name} has {g.size} students but no classroom is big enough.")
        if req.doubles:
            if 2 * req.doubles > req.lessons:
                reasons.append(f"{g.name} {s.name} asks for {req.doubles} double periods "
                               f"({2 * req.doubles} lessons) but has only {req.lessons} lessons a week.")
            if not ix.pairs:
                reasons.append("The bell schedule has no two back-to-back lesson periods, so double periods "
                               f"(asked for {g.name} {s.name}) are impossible.")
        free_group_slots = {(d, pid) for d, pid in ix.slots if (g.id, d, pid) not in ix.fixed_group}
        teacher_slots = set()
        for t in teachers:
            teacher_slots.update(ix.teacher_slots(t))
        usable = len(free_group_slots & teacher_slots)
        if usable < rem:
            names = " / ".join(t.name for t in teachers[:3]) + (" ..." if len(teachers) > 3 else "")
            reasons.append(f"{g.name} needs {rem} {s.name} lessons but the only {s.name} teachers ({names}) "
                           f"are available in {usable} free periods for that group.")
        if s.requires_room_type:
            room_type_demand[s.requires_room_type] += rem
        subject_demand[req.subject_id] += rem

    for sid, demand in sorted(subject_demand.items()):
        s = ix.subject[sid]
        teachers = ix.qualified(sid)
        capacity = sum(ix.teacher_capacity(t) for t in teachers)
        if teachers and demand > capacity:
            reasons.append(f"{s.name} needs {demand} lessons a week in total, but its {len(teachers)} qualified "
                           f"teacher(s) can give at most {capacity} (availability and weekly limits).")

    for rtype, demand in sorted(room_type_demand.items()):
        rooms = [r for r in p.rooms if r.room_type == rtype]
        free = sum(1 for r in rooms for d, pid in ix.slots if (r.id, d, pid) not in ix.fixed_room)
        if demand > free:
            label = ROOM_TYPE_LABELS.get(rtype, rtype)
            reasons.append(f"Lessons needing a {label}: {demand} a week, but the {len(rooms)} {label}(s) "
                           f"offer only {free} free periods.")
    return reasons


# ---------------------------------------------------------------- stage 1: teacher assignment
def _assign_teachers(ix: _Index, time_limit: float, seed: int, workers: int):
    """Returns ({req_index: [(teacher_id, count)]}, stats, reasons)."""
    p = ix.p
    m = cp_model.CpModel()
    n, uses = {}, {}
    load_terms = defaultdict(list)
    reqs = [(i, r) for i, r in enumerate(p.requirements) if ix.remaining(r) > 0]
    split_terms = []
    for i, req in reqs:
        rem = ix.remaining(req)
        q = ix.qualified(req.subject_id)
        for t in q:
            n[i, t.id] = m.NewIntVar(0, rem, f"n_{i}_{t.id}")
            uses[i, t.id] = m.NewBoolVar(f"u_{i}_{t.id}")
            m.Add(n[i, t.id] <= rem * uses[i, t.id])
            m.Add(n[i, t.id] >= uses[i, t.id])
            load_terms[t.id].append(n[i, t.id])
        m.Add(sum(n[i, t.id] for t in q) == rem)
        if req.doubles:
            m.Add(sum(uses[i, t.id] for t in q) == 1)
        # Continuity: one teacher is the norm; each extra teacher (or a teacher different from the one
        # already teaching kept lessons of this group/subject) costs a penalty.
        extra = m.NewIntVar(0, len(q), f"extra_{i}")
        m.Add(extra >= sum(uses[i, t.id] for t in q) - 1)
        split_terms.append(extra)
        for t in q:
            prior = ix.fixed_pair_teacher[(req.group_id, req.subject_id)]
            if prior and t.id not in prior:
                split_terms.append(uses[i, t.id])

    loads = {}
    for t in p.teachers:
        cap = ix.teacher_capacity(t)
        terms = load_terms.get(t.id, [])
        loads[t.id] = m.NewIntVar(0, max(cap, 0), f"load_{t.id}")
        m.Add(loads[t.id] == (sum(terms) if terms else 0))

    balance_terms = []
    for s in p.subjects:
        q = [t for t in ix.qualified(s.id) if load_terms.get(t.id)]
        if len(q) < 2:
            continue
        hi = m.NewIntVar(0, len(ix.slots), f"hi_{s.id}")
        lo = m.NewIntVar(0, len(ix.slots), f"lo_{s.id}")
        m.AddMaxEquality(hi, [loads[t.id] for t in q])
        m.AddMinEquality(lo, [loads[t.id] for t in q])
        balance_terms.append(hi - lo)

    w = ix.weights
    m.Minimize(w["teacher_split"] * sum(split_terms) + w["load_balance"] * sum(balance_terms))
    solver = cp_model.CpSolver()
    solver.parameters.max_deterministic_time = time_limit * DET_PER_SECOND
    solver.parameters.max_time_in_seconds = time_limit * 1.3
    solver.parameters.num_workers = workers
    solver.parameters.random_seed = seed
    solver.parameters.interleave_search = INTERLEAVE
    status = solver.Solve(m)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None, {"stage1_status": solver.StatusName(status)}, [
            "Not enough teacher time: the qualified teachers' availability and weekly limits cannot cover every "
            "group's lessons at once. Add teachers, widen availability, or reduce lessons per week."
        ]
    plan = defaultdict(list)
    for (i, tid), var in sorted(n.items()):
        c = solver.Value(var)
        if c:
            plan[i].append((tid, c))
    splits = sum(1 for i, _ in reqs if len(plan[i]) > 1)
    imbalance = int(sum(solver.Value(e) for e in balance_terms)) if balance_terms else 0
    return plan, {"stage1_status": solver.StatusName(status), "teacher_split": splits,
                  "load_balance": imbalance, "stage1_seconds": round(solver.WallTime(), 2)}, []


# ---------------------------------------------------------------- stage 2: placement
class _Progress(cp_model.CpSolverSolutionCallback):
    def __init__(self, on_solution):
        super().__init__()
        self.on_solution = on_solution
        self.count = 0

    def on_solution_callback(self):
        self.count += 1
        if self.on_solution:
            self.on_solution(self.count, self.ObjectiveValue(), self.WallTime())


def _build_placement(ix: _Index, plan, diagnostic=False, strict_spread=True):
    p = ix.p
    m = cp_model.CpModel()
    w = ix.weights
    units = []          # (req_index, req, teacher, count, doubles)
    for i, req in enumerate(p.requirements):
        for tid, count in plan.get(i, []):
            units.append((i, req, ix.teacher[tid], count, req.doubles if len(plan[i]) == 1 else 0))

    x = {}
    room_vars = {}      # (u, slot) -> [(room_id, var)]
    group_at = defaultdict(list)
    teacher_at = defaultdict(list)
    room_at = defaultdict(list)
    penalties = defaultdict(list)
    assumptions = {}
    dbl = {}

    for u, (i, req, t, count, doubles) in enumerate(units):
        g = ix.group[req.group_id]
        cands, home_id = ix.room_candidates(req)
        allowed = [
            s for s in ix.slots
            if ix.teacher_available(t, s[1])
            and (t.id, s[0], s[1]) not in ix.fixed_teacher
            and (g.id, s[0], s[1]) not in ix.fixed_group
            and any((r.id, s[0], s[1]) not in ix.fixed_room for r in cands)
        ]
        for s in allowed:
            x[u, s] = m.NewBoolVar(f"x_{u}_{s[0]}_{s[1]}")
            group_at[(g.id,) + s].append(x[u, s])
            teacher_at[(t.id,) + s].append(x[u, s])
            free_rooms = [r for r in cands if (r.id, s[0], s[1]) not in ix.fixed_room]
            if len(free_rooms) == 1:
                room_vars[u, s] = [(free_rooms[0].id, x[u, s])]
                room_at[(free_rooms[0].id,) + s].append(x[u, s])
            else:
                rv = []
                for r in free_rooms:
                    y = m.NewBoolVar(f"y_{u}_{s[0]}_{s[1]}_{r.id}")
                    rv.append((r.id, y))
                    room_at[(r.id,) + s].append(y)
                    if home_id is not None and r.id != home_id:
                        penalties["room_change"].append(y)
                m.Add(sum(v for _, v in rv) == x[u, s])
                room_vars[u, s] = rv
            if ix.subject[req.subject_id].heavy and ix.period_pos[s[1]] >= math.ceil(len(ix.periods) / 2):
                penalties["heavy_late"].append(x[u, s])

        total = sum(x[u, s] for s in allowed) if allowed else 0
        if diagnostic:
            lit = m.NewBoolVar(f"req_{u}")
            assumptions[lit.Index()] = u
            m.Add(total == count).OnlyEnforceIf(lit)
            m.AddAssumption(lit)
        else:
            m.Add(total == count)

        if doubles:
            day_pairs = []
            for d in ix.days:
                for a, b in ix.pairs:
                    if (u, (d, a)) in x and (u, (d, b)) in x:
                        v = m.NewBoolVar(f"dbl_{u}_{d}_{a}_{b}")
                        m.AddImplication(v, x[u, (d, a)])
                        m.AddImplication(v, x[u, (d, b)])
                        # Same room for both halves of a double.
                        ra = dict(room_vars[u, (d, a)])
                        rb = dict(room_vars[u, (d, b)])
                        for rid in set(ra) | set(rb):
                            if rid in ra and rid in rb:
                                m.Add(ra[rid] == rb[rid]).OnlyEnforceIf(v)
                            elif rid in ra:
                                m.Add(ra[rid] == 0).OnlyEnforceIf(v)
                            else:
                                m.Add(rb[rid] == 0).OnlyEnforceIf(v)
                        dbl[u, d, a, b] = v
                        day_pairs.append((d, a, b, v))
            if diagnostic:
                lit = m.NewBoolVar(f"dbl_req_{u}")
                assumptions[lit.Index()] = u
                m.Add(sum(v for *_, v in day_pairs) == doubles).OnlyEnforceIf(lit)
                m.AddAssumption(lit)
            else:
                m.Add(sum(v for *_, v in day_pairs) == doubles)
            for d in ix.days:
                for per in ix.periods:
                    touching = [v for dd, a, b, v in day_pairs if dd == d and per.id in (a, b)]
                    if len(touching) > 1:
                        m.Add(sum(touching) <= 1)

    # No double-booking.
    for vs in group_at.values():
        if len(vs) > 1:
            m.Add(sum(vs) <= 1)
    for vs in teacher_at.values():
        if len(vs) > 1:
            m.Add(sum(vs) <= 1)
    for vs in room_at.values():
        if len(vs) > 1:
            m.Add(sum(vs) <= 1)

    # Teacher daily limits and gaps.
    by_teacher = defaultdict(list)
    for u, unit in enumerate(units):
        by_teacher[unit[2].id].append(u)
    for tid, us in by_teacher.items():
        t = ix.teacher[tid]
        for d in ix.days:
            day_busy = []
            for per in ix.periods:
                s = (d, per.id)
                terms = [x[u, s] for u in us if (u, s) in x]
                fixed = 1 if (tid, d, per.id) in ix.fixed_teacher else 0
                day_busy.append((terms, fixed))
            if t.max_per_day is not None:
                m.Add(sum(v for terms, _ in day_busy for v in terms) + sum(f for _, f in day_busy) <= t.max_per_day)
            if w["teacher_gaps"] > 0 and sum(len(terms) + f for terms, f in day_busy) >= 2:
                k = len(day_busy)
                busy = [sum(terms) + f for terms, f in day_busy]
                before = [None] * k
                after = [None] * k
                for j in range(1, k):
                    b = m.NewBoolVar(f"bef_{tid}_{d}_{j}")
                    m.Add(b >= busy[j - 1])
                    if before[j - 1] is not None:
                        m.Add(b >= before[j - 1])
                    before[j] = b
                for j in range(k - 2, -1, -1):
                    a = m.NewBoolVar(f"aft_{tid}_{d}_{j}")
                    m.Add(a >= busy[j + 1])
                    if after[j + 1] is not None:
                        m.Add(a >= after[j + 1])
                    after[j] = a
                for j in range(1, k - 1):
                    gap = m.NewBoolVar(f"gap_{tid}_{d}_{j}")
                    m.Add(gap >= before[j] + after[j] - 1 - busy[j])
                    penalties["teacher_gaps"].append(gap)

    # Spread: the same subject at most once a day per group, except deliberate doubles.
    by_pair = defaultdict(list)
    for u, (i, req, *_rest) in enumerate(units):
        by_pair[(req.group_id, req.subject_id)].append(u)
    for (gid, sid), us in by_pair.items():
        req = next(r for r in p.requirements if r.group_id == gid and r.subject_id == sid)
        # Strict: never repeat a subject in a day unless the week is too short for it (or it's a double).
        per_day = math.ceil(req.lessons / max(1, len(ix.days)))
        cap = per_day if strict_spread else max(2, per_day)
        for d in ix.days:
            day_x = [x[u, (d, per.id)] for u in us for per in ix.periods if (u, (d, per.id)) in x]
            fixed_today = sum(1 for f in p.fixed if f.group_id == gid and f.subject_id == sid and f.day == d)
            if not day_x:
                continue
            day_dbl = [v for (uu, dd, a, b), v in dbl.items() if uu in us and dd == d]
            cnt = sum(day_x) + fixed_today
            m.Add(cnt <= cap + sum(day_dbl))
            excess = m.NewIntVar(0, len(ix.periods), f"exc_{gid}_{sid}_{d}")
            m.Add(excess >= cnt - 1 - sum(day_dbl))
            penalties["spread"].append(excess)

    objective = sum(w[k] * sum(v) for k, v in penalties.items() if v and w.get(k, 0))
    m.Minimize(objective if not isinstance(objective, int) else 0)
    return m, units, x, room_vars, penalties, assumptions


def _diagnose(ix: _Index, plan, seconds: float):
    m, units, *_rest, assumptions = _build_placement(ix, plan, diagnostic=True, strict_spread=False)
    m.ClearObjective()
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = seconds
    solver.parameters.num_workers = 1
    status = solver.Solve(m)
    if status != cp_model.INFEASIBLE:
        return []
    core = solver.SufficientAssumptionsForInfeasibility()
    seen, reasons = set(), []
    for lit in core:
        u = assumptions.get(lit)
        if u is None:
            continue
        _, req, t, count, doubles = units[u]
        key = (req.group_id, req.subject_id)
        if key in seen:
            continue
        seen.add(key)
        g, s = ix.group[req.group_id], ix.subject[req.subject_id]
        extra = f" ({doubles} as double periods)" if doubles else ""
        reasons.append(f"{g.name}: {req.lessons} {s.name} lessons{extra} with {t.name}")
    if not reasons:
        return []
    return ["These lessons cannot all be placed together without a clash "
            "(same group, teacher or room at the same time, or outside teacher availability): "
            + "; ".join(reasons[:12]) + (" ..." if len(reasons) > 12 else "") + "."]


def _polish(ix: _Index, lessons: list, strict: bool, max_passes: int = 12, wall_limit: float = 60.0):
    """Deterministic hill-climbing after CP-SAT: move/swap a group's lessons between its own slots when that
    lowers the weighted penalty and keeps every hard rule. Lessons of requirements with doubles stay put."""
    p, w = ix.p, ix.weights
    t_end = time.monotonic() + wall_limit
    k = len(ix.periods)
    late_from = math.ceil(k / 2)
    reqs = {(r.group_id, r.subject_id): r for r in p.requirements}
    frozen = {key for key, r in reqs.items() if r.doubles}
    les = list(lessons)
    g_at, t_at, r_at = {}, {}, {}
    for f in p.fixed:
        g_at[(f.group_id, f.day, f.period_id)] = -1
        t_at[(f.teacher_id, f.day, f.period_id)] = -1
        r_at[(f.room_id, f.day, f.period_id)] = -1
    for i, le in enumerate(les):
        g_at[(le.group_id, le.day, le.period_id)] = i
        t_at[(le.teacher_id, le.day, le.period_id)] = i
        r_at[(le.room_id, le.day, le.period_id)] = i
    fixed_by_gsd = defaultdict(int)
    for f in p.fixed:
        fixed_by_gsd[(f.group_id, f.subject_id, f.day)] += 1

    def cap(g, sub):
        per_day = math.ceil(reqs[(g, sub)].lessons / max(1, len(ix.days)))
        return per_day if strict else max(2, per_day)

    def teacher_day_cost(tid, d):
        idx = [j for j, per in enumerate(ix.periods) if (tid, d, per.id) in t_at]
        return w["teacher_gaps"] * ((idx[-1] - idx[0] + 1 - len(idx)) if idx else 0)

    def subject_day_count(g, sub, d):
        n = fixed_by_gsd[(g, sub, d)]
        for per in ix.periods:
            i = g_at.get((g, d, per.id))
            if i is not None and i >= 0 and les[i].subject_id == sub:
                n += 1
        return n

    def spread_cost(g, sub, d):
        return w["spread"] * max(0, subject_day_count(g, sub, d) - 1)

    def heavy_cost(le):
        late = ix.period_pos[le.period_id] >= late_from
        return w["heavy_late"] * (1 if ix.subject[le.subject_id].heavy and late else 0)

    def local_cost(items, tdays, gsd):
        return (sum(heavy_cost(les[i]) for i in items)
                + sum(teacher_day_cost(t, d) for t, d in tdays)
                + sum(spread_cost(g, sub, d) for g, sub, d in gsd))

    def can_place(le, d, pid, ignore):
        if not ix.teacher_available(ix.teacher[le.teacher_id], pid):
            return False
        for occ in (t_at.get((le.teacher_id, d, pid)), r_at.get((le.room_id, d, pid))):
            if occ is not None and occ not in ignore:
                return False
        return True

    def remove(i):
        le = les[i]
        del g_at[(le.group_id, le.day, le.period_id)]
        del t_at[(le.teacher_id, le.day, le.period_id)]
        del r_at[(le.room_id, le.day, le.period_id)]

    def put(i, d, pid):
        le = les[i]
        les[i] = Lesson(le.group_id, le.subject_id, le.teacher_id, le.room_id, d, pid)
        g_at[(le.group_id, d, pid)] = i
        t_at[(le.teacher_id, d, pid)] = i
        r_at[(le.room_id, d, pid)] = i

    def still_valid(items):
        for i in items:
            le = les[i]
            if subject_day_count(le.group_id, le.subject_id, le.day) > cap(le.group_id, le.subject_id):
                return False
            t = ix.teacher[le.teacher_id]
            if t.max_per_day is not None:
                if sum(1 for per in ix.periods if (t.id, le.day, per.id) in t_at) > t.max_per_day:
                    return False
        return True

    slots = [(d, per.id) for d in ix.days for per in ix.periods]
    groups = sorted({le.group_id for le in les})
    improved_total, passes = 0, 0
    for passes in range(1, max_passes + 1):
        improved = 0
        for g in groups:
            for a_idx, (da, pa) in enumerate(slots):
                ia = g_at.get((g, da, pa))
                if ia is None or ia < 0 or (g, les[ia].subject_id) in frozen:
                    continue
                for db, pb in slots[a_idx + 1:]:
                    if time.monotonic() > t_end:
                        break
                    ib = g_at.get((g, db, pb))
                    if ib is not None and (ib < 0 or (g, les[ib].subject_id) in frozen):
                        continue
                    ia = g_at[(g, da, pa)]
                    A = les[ia]
                    B = les[ib] if ib is not None else None
                    items = [ia] + ([ib] if B else [])
                    tdays = {(A.teacher_id, da), (A.teacher_id, db)}
                    gsd = {(g, A.subject_id, da), (g, A.subject_id, db)}
                    if B:
                        tdays |= {(B.teacher_id, da), (B.teacher_id, db)}
                        gsd |= {(g, B.subject_id, da), (g, B.subject_id, db)}
                    ignore = set(items)
                    if not can_place(A, db, pb, ignore) or (B and not can_place(B, da, pa, ignore)):
                        continue
                    before = local_cost(items, tdays, gsd)
                    for i in items:
                        remove(i)
                    put(ia, db, pb)
                    if B:
                        put(ib, da, pa)
                    if still_valid(items) and local_cost(items, tdays, gsd) < before:
                        improved += 1
                        break   # slot a now holds another lesson; continue with the next slot
                    for i in items:
                        remove(i)
                    put(ia, da, pa)
                    if B:
                        put(ib, db, pb)
        improved_total += improved
        if not improved or time.monotonic() > t_end:
            break
    return les, {"polish_moves": improved_total, "polish_passes": passes}


def _violations(ix: _Index, lessons: list):
    """Soft-constraint counts of a complete timetable (fixed + new)."""
    allx = list(ix.p.fixed) + list(lessons)
    late_from = math.ceil(len(ix.periods) / 2)
    by_t = defaultdict(list)
    by_gsd = defaultdict(list)
    heavy = room_change = 0
    for le in allx:
        pos = ix.period_pos[le.period_id]
        by_t[(le.teacher_id, le.day)].append(pos)
        by_gsd[(le.group_id, le.subject_id, le.day)].append(pos)
        if ix.subject[le.subject_id].heavy and pos >= late_from:
            heavy += 1
        g = ix.group[le.group_id]
        if (not ix.subject[le.subject_id].requires_room_type and g.home_room_id is not None
                and le.room_id != g.home_room_id):
            room_change += 1
    gaps = sum(max(pos) - min(pos) + 1 - len(pos) for pos in by_t.values())
    reqs = {(r.group_id, r.subject_id): r for r in ix.p.requirements}
    pair_pos = {(ix.period_pos[a], ix.period_pos[b]) for a, b in ix.pairs}
    spread = 0
    for (g, sub, d), pos in by_gsd.items():
        pos = sorted(pos)
        doubles_today = 0
        if reqs.get((g, sub)) and reqs[(g, sub)].doubles:
            j = 0
            while j + 1 < len(pos):
                if (pos[j], pos[j + 1]) in pair_pos:
                    doubles_today += 1
                    j += 2
                else:
                    j += 1
        spread += max(0, len(pos) - 1 - doubles_today)
    unavoidable = sum(max(0, r.lessons - r.doubles - len(ix.days)) for r in ix.p.requirements)
    return {"spread": spread, "spread_unavoidable": unavoidable, "teacher_gaps": gaps,
            "heavy_late": heavy, "room_change": room_change}


def solve(p: Problem, on_progress=None) -> Result:
    """on_progress(fraction 0..1, message) is called during the solve (from the solver thread)."""
    t0 = time.monotonic()
    reasons = precheck(p)
    if reasons:
        return Result("infeasible", reasons=reasons, stats={"seconds": round(time.monotonic() - t0, 2)})
    ix = _Index(p)
    limit = max(1.0, float(p.time_limit))
    stage1_limit = min(5.0, max(1.0, limit * 0.1))
    if on_progress:
        on_progress(0.02, "Assigning teachers")
    plan, stats, reasons = _assign_teachers(ix, stage1_limit, p.seed, p.workers)
    if plan is None:
        return Result("infeasible", reasons=reasons, stats=stats)

    if on_progress:
        on_progress(0.1, "Placing lessons")

    def run(strict, seconds, lo, hi):
        model, units_, x_, room_vars_, penalties_, _ = _build_placement(ix, plan, strict_spread=strict)
        solver_ = cp_model.CpSolver()
        # Deterministic budget so the same input gives the same timetable; the wall clock is only a safety
        # net. CP-SAT's deterministic time runs at roughly a third of wall time on this model.
        solver_.parameters.max_deterministic_time = seconds * DET_PER_SECOND
        solver_.parameters.max_time_in_seconds = seconds * 1.3
        solver_.parameters.num_workers = p.workers
        solver_.parameters.random_seed = p.seed
        solver_.parameters.interleave_search = INTERLEAVE

        def cb(count, objective, wall):
            if on_progress:
                on_progress(lo + (hi - lo) * min(1.0, wall / seconds), f"Found solution #{count} (penalty {int(objective)})")

        st = solver_.Solve(model, _Progress(cb))
        stats["variables"] = len(model.Proto().variables)
        stats["constraints"] = len(model.Proto().constraints)
        return st, solver_, units_, x_, room_vars_, penalties_

    remaining = max(1.0, limit - (time.monotonic() - t0))
    status, solver, units, x, room_vars, penalties = run(True, remaining, 0.1, 0.95)
    stats["spread_mode"] = "strict"
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        # Strict spreading impossible (or not found in time): allow repeats in a day, penalised.
        remaining = max(limit * 0.25, limit - (time.monotonic() - t0))
        status, solver, units, x, room_vars, penalties = run(False, remaining, 0.5, 0.98)
        stats["spread_mode"] = "relaxed"
    stats["status"] = solver.StatusName(status)
    stats["seconds"] = round(time.monotonic() - t0, 2)
    if status == cp_model.INFEASIBLE:
        diag = _diagnose(ix, plan, min(30.0, limit))
        return Result("infeasible", reasons=diag or [
            "No timetable satisfies all the rules together. Check teacher availability, room types and "
            "lessons per week for the busiest groups and teachers."
        ], stats=stats)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return Result("timeout", reasons=[
            f"No valid timetable was found within {int(limit)} seconds. Try a longer time limit, or check the "
            "busiest teachers and rooms."
        ], stats=stats)

    lessons = []
    for (u, s), var in x.items():
        if solver.Value(var):
            _, req, t, _, _ = units[u]
            room_id = next(rid for rid, v in room_vars[u, s] if solver.Value(v))
            lessons.append(Lesson(req.group_id, req.subject_id, t.id, room_id, s[0], s[1]))
    lessons.sort(key=lambda le: (le.group_id, le.day, ix.period_pos[le.period_id]))
    if on_progress:
        on_progress(0.97, "Polishing")
    lessons, polish_stats = _polish(ix, lessons, strict=stats["spread_mode"] == "strict",
                                    wall_limit=max(10.0, limit))
    stats.update(polish_stats)
    stats["seconds"] = round(time.monotonic() - t0, 2)

    violations = _violations(ix, lessons)
    violations["teacher_split"] = stats.get("teacher_split", 0)
    violations["load_balance"] = stats.get("load_balance", 0)
    total_lessons = max(1, len(lessons) + len(p.fixed))
    weighted = sum(ix.weights.get(key, 0) * v for key, v in violations.items() if key != "spread_unavoidable")
    weighted -= ix.weights.get("spread", 0) * violations["spread_unavoidable"]
    score = round(100.0 / (1.0 + max(0, weighted) / total_lessons), 1)
    return Result("optimal" if status == cp_model.OPTIMAL else "feasible", lessons=lessons,
                  violations=violations, score=score, stats=stats)


# ---------------------------------------------------------------- independent validator
def validate(p: Problem, lessons: list) -> list:
    """Hard-constraint check of a complete timetable (fixed + new lessons). Returns problems found."""
    ix = _Index(p)
    allx = list(p.fixed) + list(lessons)
    problems = []
    seen_g, seen_t, seen_r = {}, {}, {}
    for le in allx:
        for seen, key, what in ((seen_g, (le.group_id, le.day, le.period_id), "group"),
                                (seen_t, (le.teacher_id, le.day, le.period_id), "teacher"),
                                (seen_r, (le.room_id, le.day, le.period_id), "room")):
            if key in seen:
                problems.append(f"{what} double-booked at {key}")
            seen[key] = le
        t = ix.teacher[le.teacher_id]
        if le.subject_id not in t.subject_ids:
            problems.append(f"{t.name} not qualified for subject {le.subject_id}")
        if not ix.teacher_available(t, le.period_id):
            problems.append(f"{t.name} not available in period {le.period_id}")
        if le.period_id not in ix.period_pos:
            problems.append(f"lesson in non-lesson period {le.period_id}")
        room, g, s = ix.room[le.room_id], ix.group[le.group_id], ix.subject[le.subject_id]
        if room.capacity < g.size:
            problems.append(f"{room.name} too small for {g.name}")
        if s.requires_room_type and room.room_type != s.requires_room_type:
            problems.append(f"{s.name} for {g.name} not in a {s.requires_room_type} room")
    counts = defaultdict(int)
    for le in allx:
        counts[(le.group_id, le.subject_id)] += 1
    for req in p.requirements:
        if counts[(req.group_id, req.subject_id)] != req.lessons:
            problems.append(f"group {req.group_id} subject {req.subject_id}: "
                            f"{counts[(req.group_id, req.subject_id)]} lessons, needs {req.lessons}")
    for t in p.teachers:
        mine = [le for le in allx if le.teacher_id == t.id]
        if t.max_per_week is not None and len(mine) > t.max_per_week:
            problems.append(f"{t.name} over weekly limit")
        if t.max_per_day is not None:
            per_day = defaultdict(int)
            for le in mine:
                per_day[le.day] += 1
            if any(v > t.max_per_day for v in per_day.values()):
                problems.append(f"{t.name} over daily limit")
    for req in p.requirements:
        if not req.doubles:
            continue
        mine = {(le.day, le.period_id) for le in allx
                if le.group_id == req.group_id and le.subject_id == req.subject_id}
        pairs = 0
        for d in ix.days:
            used = set()
            for a, b in ix.pairs:
                if (d, a) in mine and (d, b) in mine and a not in used and b not in used:
                    pairs += 1
                    used.update((a, b))
        if pairs < req.doubles:
            problems.append(f"group {req.group_id} subject {req.subject_id}: {pairs} doubles, needs {req.doubles}")
    return problems
