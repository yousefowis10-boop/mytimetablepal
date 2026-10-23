"""
python manage.py benchmark_solver [--sizes 30x55 60x100] [--time-limit 60] [--repeat-check]

Runs the timetable optimizer on synthetic schools (no database needed) and prints solve time, quality
score, soft-constraint counts and an independent hard-constraint check.
"""
import time

from django.core.management.base import BaseCommand

from api.scheduling.solver import solve, validate
from api.scheduling.synthetic import school_problem


class Command(BaseCommand):
    help = "Benchmark the OR-Tools timetable solver on synthetic schools."

    def add_arguments(self, parser):
        parser.add_argument("--sizes", nargs="+", default=["30x55", "60x100"], help="groupsxteachers")
        parser.add_argument("--time-limit", type=float, default=60.0)
        parser.add_argument("--repeat-check", action="store_true", help="Solve twice and compare (determinism)")

    def handle(self, *args, **opts):
        for size in opts["sizes"]:
            groups, teachers = (int(v) for v in size.lower().split("x"))
            problem = school_problem(groups, teachers, time_limit=opts["time_limit"])
            start = time.monotonic()
            result = solve(problem)
            elapsed = time.monotonic() - start
            hard = validate(problem, result.lessons) if result.ok else ["no solution"]
            self.stdout.write(
                f"{groups} groups / {teachers} teachers: status={result.status} time={elapsed:.1f}s "
                f"lessons={len(result.lessons)} score={result.score} hard_violations={len(hard)}\n"
                f"  soft: {result.violations}\n  stats: {result.stats}"
            )
            if result.reasons:
                self.stdout.write("  reasons: " + " | ".join(result.reasons))
            if opts["repeat_check"]:
                again = solve(problem)
                self.stdout.write(f"  deterministic: {again.lessons == result.lessons}")
