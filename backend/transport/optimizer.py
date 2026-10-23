"""
School bus routing (pure Python + OR-Tools routing, no Django).

Capacitated vehicle routing with time windows:
  morning   - buses start at their first stop (open start) and must reach school by the deadline
  afternoon - buses leave school at the wave departure time and end at their last stop (open end)
Hard: seats per bus, max ride time per child, every stop served (or reported as impossible and why).
Objective: weight_distance x km  +  weight_ride x child-minutes on the bus  (1 km ~ 1 child-minute at 1:1).
"""
from dataclasses import dataclass, field

from ortools.constraint_solver import pywrapcp, routing_enums_pb2

from api.scheduling.messages import Msg

HORIZON = 6 * 3600
DIRECTION_WORDS = (Msg("morning"), Msg("afternoon"))   # so the translation tools see them
DROP_PENALTY = 10 ** 12


@dataclass
class StopIn:
    key: str
    lat: float
    lng: float
    count: int
    label: str = ""


@dataclass
class BusIn:
    id: int
    name: str
    capacity: int
    fuel_l_per_100km: float = 18.0


@dataclass
class VRPInput:
    direction: str                 # morning | afternoon
    stops: list
    buses: list
    durations: list                # (n+1)x(n+1) seconds; index 0 = school, 1..n = stops
    distances: list                # meters, same shape
    service_seconds: float = 60
    max_ride_seconds: float = 3600
    weight_distance: int = 1
    weight_ride: int = 1
    time_limit: int = 20


@dataclass
class RouteOut:
    bus_id: int
    stop_indexes: list             # order of stops (1..n)
    offsets: list                  # seconds relative to the anchor (morning: <=0 before arrival; afternoon: >=0)
    school_offset: float           # morning: arrival offset (<=0); afternoon: 0
    distance_m: float
    duration_s: float
    student_seconds: float


@dataclass
class VRPResult:
    status: str                    # ok | infeasible | partial
    routes: list = field(default_factory=list)
    dropped: list = field(default_factory=list)
    reasons: list = field(default_factory=list)
    used_buses: int = 0
    stats: dict = field(default_factory=dict)


def precheck(p: VRPInput, names=None):
    names = names or {}
    reasons = []
    total = sum(s.count for s in p.stops)
    seats = sum(b.capacity for b in p.buses)
    if not p.buses:
        return [Msg("No active buses. Add at least one bus.")]
    if total > seats:
        reasons.append(Msg("Not enough seats: %(children)s children ride in the %(direction)s, but the %(buses)s "
                           "bus(es) have %(seats)s seats.", children=total, direction=Msg(p.direction),
                           buses=len(p.buses), seats=seats))
    biggest = max(b.capacity for b in p.buses)
    for i, s in enumerate(p.stops, start=1):
        if s.count > biggest:
            reasons.append(Msg("The stop '%(stop)s' has %(n)s children but the largest bus has %(seats)s seats.",
                               stop=s.label, n=s.count, seats=biggest))
        direct = p.durations[i][0] if p.direction == "morning" else p.durations[0][i]
        if direct > p.max_ride_seconds:
            reasons.append(Msg("'%(stop)s' is %(minutes)s minutes from school by road, longer than the "
                               "%(max)s-minute maximum ride.", stop=s.label, minutes=round(direct / 60),
                               max=round(p.max_ride_seconds / 60)))
    return reasons


def solve(p: VRPInput, probe=False) -> VRPResult:
    reasons = precheck(p)
    if reasons:
        return VRPResult("infeasible", reasons=reasons)
    n = len(p.stops)
    if n == 0:
        return VRPResult("ok", stats={"note": "No children use the bus."})
    V = len(p.buses)
    dummy = n + 1
    if p.direction == "morning":
        starts, ends = [dummy] * V, [0] * V
    else:
        starts, ends = [0] * V, [dummy] * V
    manager = pywrapcp.RoutingIndexManager(n + 2, V, starts, ends)
    routing = pywrapcp.RoutingModel(manager)

    def node(idx):
        return manager.IndexToNode(idx)

    def travel(a, b):
        if a == dummy or b == dummy:
            return 0
        return p.durations[a][b]

    def dist(a, b):
        if a == dummy or b == dummy:
            return 0
        return p.distances[a][b]

    def service(a):
        return p.service_seconds if 1 <= a <= n else 0

    cost_cb = routing.RegisterTransitCallback(
        lambda i, j: int(dist(node(i), node(j)) * p.weight_distance * 0.06))
    routing.SetArcCostEvaluatorOfAllVehicles(cost_cb)

    time_cb = routing.RegisterTransitCallback(lambda i, j: int(service(node(i)) + travel(node(i), node(j))))
    morning = p.direction == "morning"
    routing.AddDimension(time_cb, HORIZON if morning else 0, 2 * HORIZON, not morning, "time")
    tdim = routing.GetDimensionOrDie("time")

    demand_cb = routing.RegisterUnaryTransitCallback(lambda i: p.stops[node(i) - 1].count if 1 <= node(i) <= n else 0)
    routing.AddDimensionWithVehicleCapacity(demand_cb, 0, [b.capacity for b in p.buses], True, "seats")

    max_ride = int(p.max_ride_seconds)
    for i in range(1, n + 1):
        idx = manager.NodeToIndex(i)
        coeff = p.stops[i - 1].count * p.weight_ride
        if morning:
            # School arrival is at HORIZON (the deadline). Picking up earlier costs ride time.
            tdim.CumulVar(idx).SetRange(HORIZON - max_ride, HORIZON)
            tdim.SetCumulVarSoftLowerBound(idx, HORIZON, coeff)
        else:
            tdim.CumulVar(idx).SetRange(0, max_ride)
            tdim.SetCumulVarSoftUpperBound(idx, 0, coeff)
        routing.AddDisjunction([idx], DROP_PENALTY)
    for v in range(V):
        if morning:
            tdim.CumulVar(routing.End(v)).SetRange(0, HORIZON)
        else:
            tdim.CumulVar(routing.Start(v)).SetRange(0, 0)

    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    params.time_limit.seconds = max(1, int(p.time_limit))
    sol = routing.SolveWithParameters(params)
    if sol is None:
        return VRPResult("infeasible", reasons=[
            Msg("No set of routes fits the seats and the maximum ride time. Add buses or allow longer rides.")])

    routes, served = [], set()
    for v, bus in enumerate(p.buses):
        idx = routing.Start(v)
        order, offsets = [], []
        dist_m = 0.0
        prev = None
        while not routing.IsEnd(idx):
            nd = node(idx)
            if 1 <= nd <= n:
                order.append(nd)
                t = sol.Value(tdim.CumulVar(idx))
                offsets.append(t - HORIZON if morning else t)
                served.add(nd)
            if prev is not None:
                dist_m += dist(prev, nd)
            prev = nd
            idx = sol.Value(routing.NextVar(idx))
        end_node = node(idx)
        if prev is not None:
            dist_m += dist(prev, end_node)
        if not order:
            continue
        if morning:
            school_off = sol.Value(tdim.CumulVar(idx)) - HORIZON
            duration = school_off - offsets[0]
            student_s = sum(p.stops[s - 1].count * (school_off - off) for s, off in zip(order, offsets))
        else:
            school_off = 0
            duration = offsets[-1] + p.service_seconds
            student_s = sum(p.stops[s - 1].count * off for s, off in zip(order, offsets))
        routes.append(RouteOut(bus.id, order, offsets, school_off, dist_m, duration, student_s))
    dropped = [i for i in range(1, n + 1) if i not in served]
    res = VRPResult("ok" if not dropped else "partial", routes=routes, dropped=dropped, used_buses=len(routes),
                    stats={"objective": sol.ObjectiveValue(), "buses_available": V})
    if dropped:
        res.reasons.append(Msg("These stops could not be served within the seats and the maximum ride time: "
                               "%(stops)s. Add a bus or allow a longer ride.",
                               stops=", ".join(p.stops[i - 1].label for i in dropped[:15]) + (" ..." if len(dropped) > 15 else "")))
    if not dropped and V > 1 and not probe:
        k = min_buses(p)
        if k and k < V:
            res.stats["min_buses"] = k
            res.stats["fewer_buses_note"] = Msg("Only %(k)s of %(v)s buses are needed to serve every child within the "
                                                "limits (rides get longer with fewer buses).", k=k, v=V)
    return res


def min_buses(p: VRPInput):
    """Smallest number of buses (largest first) that still serves every stop within seats and ride time."""
    import math
    from dataclasses import replace
    buses = sorted(p.buses, key=lambda b: -b.capacity)
    need = sum(s.count for s in p.stops)
    k, seats = 0, 0
    while seats < need and k < len(buses):
        seats += buses[k].capacity
        k += 1
    for count in range(max(1, k), len(buses)):
        trial = replace(p, buses=buses[:count], time_limit=max(1, min(3, math.ceil(p.time_limit / 4))))
        r = _solve_core(trial)
        if r is not None and not r:
            return count
    return None


def evaluate_order(p: VRPInput, stop_order_by_bus):
    """Score a given (manual) set of routes with the same matrix: km, child-minutes, ride violations."""
    total_m = total_child_s = 0.0
    longest = 0.0
    for bus_id, order in stop_order_by_bus.items():
        if not order:
            continue
        if p.direction == "morning":
            seq = list(order) + [0]
        else:
            seq = [0] + list(order)
        t = 0.0
        times = {}
        for a, b in zip(seq, seq[1:]):
            if a != 0:
                times[a] = t
                t += p.service_seconds
            t += p.durations[a][b]
            total_m += p.distances[a][b]
        if p.direction == "afternoon":
            times[seq[-1]] = t
            rides = {s: times[s] for s in order}
        else:
            rides = {s: t - times[s] for s in order}
        for s, ride in rides.items():
            total_child_s += ride * p.stops[s - 1].count
            longest = max(longest, ride)
    return {"km": round(total_m / 1000, 1), "child_minutes": round(total_child_s / 60),
            "longest_ride_min": round(longest / 60, 1)}


def _solve_core(p: VRPInput):
    """Dropped stop list (empty = everyone served) or None when no solution at all."""
    r = solve(p, probe=True)
    return None if r.status == "infeasible" else r.dropped
