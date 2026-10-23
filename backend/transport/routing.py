"""
Road travel times and distances behind one swappable interface.

  osrm      OSRM HTTP API. ROUTING_OSRM_URL (default: the public demo server, which is for testing only -
            self-host OSRM with Jordan's OpenStreetMap extract for production).
  ors       OpenRouteService. ROUTING_ORS_KEY.
  google    Google Routes API (computeRouteMatrix). ROUTING_GOOGLE_KEY.
  haversine Straight-line distance x 1.35 at 30 km/h. Offline fallback and tests.

Matrices are cached in the DB (DistanceCache) keyed by provider + rounded coordinates, so re-planning the
same homes costs nothing. If a provider fails, we fall back to the estimate and say so in the plan summary.
"""
import hashlib
import json
import logging
import math
import os

import requests

from api.scheduling.messages import Msg

log = logging.getLogger(__name__)
TIMEOUT = 25


class RoutingError(Exception):
    pass


def haversine_m(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


class Provider:
    name = "base"
    max_points = 100

    def matrix(self, points):
        """points: [(lat, lng)] -> (durations_seconds[i][j], distances_meters[i][j])"""
        raise NotImplementedError

    def geometry(self, points):
        """Road polyline through the points in order: [[lat, lng], ...]. Falls back to straight lines."""
        return [[p[0], p[1]] for p in points]


class HaversineProvider(Provider):
    name = "haversine"
    max_points = 10000
    ROAD_FACTOR = 1.35
    SPEED_MS = 30 / 3.6

    def matrix(self, points):
        dist = [[haversine_m(a, b) * self.ROAD_FACTOR for b in points] for a in points]
        dur = [[d / self.SPEED_MS for d in row] for row in dist]
        return dur, dist


class OSRMProvider(Provider):
    name = "osrm"
    max_points = 90

    def __init__(self):
        self.base = os.getenv("ROUTING_OSRM_URL", "https://router.project-osrm.org").rstrip("/")

    def _coords(self, points):
        return ";".join(f"{p[1]:.6f},{p[0]:.6f}" for p in points)

    def matrix(self, points):
        n = len(points)
        if n <= self.max_points:
            return self._table(points, None, None)
        # Large inputs: query blocks of sources x destinations.
        dur = [[0.0] * n for _ in range(n)]
        dist = [[0.0] * n for _ in range(n)]
        step = self.max_points // 2
        for i in range(0, n, step):
            for j in range(0, n, step):
                src = list(range(i, min(n, i + step)))
                dst = list(range(j, min(n, j + step)))
                idx = sorted(set(src) | set(dst))
                sub = [points[k] for k in idx]
                pos = {k: m for m, k in enumerate(idx)}
                d, s = self._table(sub, [pos[k] for k in src], [pos[k] for k in dst])
                for a, si in enumerate(src):
                    for b, dj in enumerate(dst):
                        dur[si][dj], dist[si][dj] = d[a][b], s[a][b]
        return dur, dist

    def _table(self, points, sources, destinations):
        params = {"annotations": "duration,distance"}
        if sources is not None:
            params["sources"] = ";".join(map(str, sources))
            params["destinations"] = ";".join(map(str, destinations))
        r = requests.get(f"{self.base}/table/v1/driving/{self._coords(points)}", params=params, timeout=TIMEOUT)
        data = r.json() if r.ok else {}
        if data.get("code") != "Ok":
            raise RoutingError(f"OSRM table failed: {r.status_code} {data.get('message', '')}")
        dur = [[x if x is not None else 1e7 for x in row] for row in data["durations"]]
        dist = [[x if x is not None else 1e8 for x in row] for row in data["distances"]]
        return dur, dist

    def geometry(self, points):
        if len(points) < 2:
            return super().geometry(points)
        try:
            r = requests.get(f"{self.base}/route/v1/driving/{self._coords(points)}",
                             params={"overview": "full", "geometries": "geojson"}, timeout=TIMEOUT)
            data = r.json()
            if data.get("code") == "Ok":
                return [[c[1], c[0]] for c in data["routes"][0]["geometry"]["coordinates"]]
        except (requests.RequestException, ValueError, KeyError):
            pass
        return super().geometry(points)


class ORSProvider(Provider):
    name = "ors"
    max_points = 50

    def matrix(self, points):
        key = os.getenv("ROUTING_ORS_KEY")
        if not key:
            raise RoutingError("ROUTING_ORS_KEY is not set")
        r = requests.post("https://api.openrouteservice.org/v2/matrix/driving-car",
                          json={"locations": [[p[1], p[0]] for p in points], "metrics": ["duration", "distance"]},
                          headers={"Authorization": key}, timeout=TIMEOUT)
        if not r.ok:
            raise RoutingError(f"OpenRouteService failed: {r.status_code}")
        data = r.json()
        return data["durations"], data["distances"]


class GoogleProvider(Provider):
    name = "google"
    max_points = 25

    def matrix(self, points):
        key = os.getenv("ROUTING_GOOGLE_KEY")
        if not key:
            raise RoutingError("ROUTING_GOOGLE_KEY is not set")
        wp = [{"waypoint": {"location": {"latLng": {"latitude": p[0], "longitude": p[1]}}}} for p in points]
        r = requests.post("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
                          json={"origins": wp, "destinations": wp, "travelMode": "DRIVE"},
                          headers={"X-Goog-Api-Key": key,
                                   "X-Goog-FieldMask": "originIndex,destinationIndex,duration,distanceMeters"},
                          timeout=TIMEOUT)
        if not r.ok:
            raise RoutingError(f"Google Routes failed: {r.status_code}")
        n = len(points)
        dur = [[0.0] * n for _ in range(n)]
        dist = [[0.0] * n for _ in range(n)]
        for el in r.json():
            i, j = el["originIndex"], el["destinationIndex"]
            dur[i][j] = float(str(el.get("duration", "0s")).rstrip("s") or 0)
            dist[i][j] = float(el.get("distanceMeters", 0))
        return dur, dist


PROVIDERS = {"osrm": OSRMProvider, "ors": ORSProvider, "google": GoogleProvider, "haversine": HaversineProvider}


def get_provider(name):
    override = os.getenv("ROUTING_PROVIDER_OVERRIDE")   # tests / offline
    return PROVIDERS.get(override or name, HaversineProvider)()


def cached_matrix(provider_name, points):
    """Returns (durations, distances, provider_used, note)."""
    from .models import DistanceCache
    provider = get_provider(provider_name)
    key = hashlib.sha256(json.dumps([provider.name] + [[round(p[0], 5), round(p[1], 5)] for p in points])
                         .encode()).hexdigest()
    hit = DistanceCache.objects.filter(key=key).first()
    if hit:
        return hit.durations, hit.distances, provider.name, ""
    note = ""
    try:
        dur, dist = provider.matrix(points)
    except (RoutingError, requests.RequestException, ValueError, KeyError) as exc:
        log.warning("Routing provider %s failed, using estimate: %s", provider.name, exc)
        note = Msg("Road distances from %(provider)s were unavailable (%(error)s); straight-line estimates were used.",
                   provider=provider.name, error=str(exc)[:120])
        provider = HaversineProvider()
        dur, dist = provider.matrix(points)
        return dur, dist, provider.name, note
    DistanceCache.objects.update_or_create(key=key, defaults={"provider": provider.name, "durations": dur,
                                                              "distances": dist})
    return dur, dist, provider.name, note
