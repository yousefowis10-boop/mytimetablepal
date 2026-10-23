import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { Search } from "lucide-react";
import { Button } from "./ui";

const TILE = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
export const AMMAN = [31.9539, 35.9106];
export const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#db2777", "#65a30d", "#4f46e5", "#ca8a04", "#0f766e", "#be123c"];

function ClickToPick({ onPick }) {
  useMapEvents({ click: (e) => onPick([e.latlng.lat, e.latlng.lng]) });
  return null;
}

function Recenter({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.setView(center, zoom || map.getZoom());
  }, [center, zoom, map]);
  return null;
}

function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points?.length > 1) map.fitBounds(points, { padding: [24, 24] });
  }, [points, map]);
  return null;
}

/** Pick a point by clicking the map or searching an address (OpenStreetMap Nominatim). */
export function MapPicker({ value, onChange, height = 280 }) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [center, setCenter] = useState(value?.[0] != null ? value : AMMAN);

  const search = async () => {
    if (!query.trim()) return;
    setBusy(true);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=jo&accept-language=${i18n.language}&q=${encodeURIComponent(query)}`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      const hits = await res.json();
      if (hits[0]) {
        const p = [Number(hits[0].lat), Number(hits[0].lon)];
        setCenter(p);
        onChange(p, hits[0].display_name);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), search())}
               placeholder={t("Search an address, e.g. Khalda, Amman")}
               className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <Button variant="secondary" icon={Search} loading={busy} onClick={search}>{t("Find")}</Button>
      </div>
      <div style={{ height }}>
        <MapContainer center={center} zoom={value?.[0] != null ? 15 : 12} style={{ height: "100%" }} scrollWheelZoom>
          <TileLayer url={TILE} attribution={ATTRIBUTION} />
          <ClickToPick onPick={(p) => onChange(p)} />
          <Recenter center={center} />
          {value?.[0] != null && <CircleMarker center={value} radius={9} pathOptions={{ color: "#dc2626", fillOpacity: 0.8 }} />}
        </MapContainer>
      </div>
      <p className="text-xs text-slate-500">{t("Click the map to drop the pin exactly on the home or the school gate.")}</p>
    </div>
  );
}

/** Optimized routes: one colour per bus, school marked, numbered stops. */
export function RoutesMap({ routes, school, height = 460, highlight }) {
  const points = routes.flatMap((r) => r.geometry?.length ? r.geometry : r.stops.map((s) => [s.lat, s.lng]));
  return (
    <div style={{ height }}>
      <MapContainer center={school || AMMAN} zoom={12} style={{ height: "100%" }}>
        <TileLayer url={TILE} attribution={ATTRIBUTION} />
        <FitBounds points={points} />
        {routes.map((r, i) => {
          const color = COLORS[i % COLORS.length];
          const dim = highlight != null && highlight !== r.id;
          const line = r.geometry?.length ? r.geometry : r.stops.map((s) => [s.lat, s.lng]);
          return (
            <div key={r.id}>
              <Polyline positions={line} pathOptions={{ color, weight: dim ? 2 : 4, opacity: dim ? 0.25 : 0.9 }} />
              {r.stops.filter((s) => !s.is_school).map((s) => (
                <CircleMarker key={s.order} center={[s.lat, s.lng]} radius={dim ? 4 : 6}
                              pathOptions={{ color, fillColor: "#fff", fillOpacity: 1, weight: 3, opacity: dim ? 0.3 : 1 }}>
                  <Tooltip>{`${r.bus} · ${s.order} · ${s.eta}${s.count ? ` · ${s.count}` : ""}`}</Tooltip>
                </CircleMarker>
              ))}
            </div>
          );
        })}
        {school && <CircleMarker center={school} radius={11} pathOptions={{ color: "#111827", fillColor: "#facc15", fillOpacity: 1 }}><Tooltip permanent direction="top">🏫</Tooltip></CircleMarker>}
      </MapContainer>
    </div>
  );
}

/** Parent / admin live view: bus position + own stop (+ school). */
export function LiveMap({ bus, stop, school, height = 360, extra = [] }) {
  const pts = [bus && [bus.lat, bus.lng], stop && [stop.lat, stop.lng], school && [school.lat, school.lng]].filter(Boolean);
  return (
    <div style={{ height }}>
      <MapContainer center={pts[0] || AMMAN} zoom={14} style={{ height: "100%" }}>
        <TileLayer url={TILE} attribution={ATTRIBUTION} />
        <FitBounds points={pts.length > 1 ? pts : null} />
        {stop && <CircleMarker center={[stop.lat, stop.lng]} radius={9} pathOptions={{ color: "#16a34a", fillOpacity: 0.7 }}><Tooltip permanent direction="top">🏠</Tooltip></CircleMarker>}
        {school && school.lat != null && <CircleMarker center={[school.lat, school.lng]} radius={9} pathOptions={{ color: "#111827", fillColor: "#facc15", fillOpacity: 1 }}><Tooltip direction="top">🏫</Tooltip></CircleMarker>}
        {extra.map((b) => b.lat != null && (
          <CircleMarker key={b.key} center={[b.lat, b.lng]} radius={10} pathOptions={{ color: b.color || "#2563eb", fillOpacity: 0.9 }}>
            <Tooltip permanent direction="top">{b.label}</Tooltip>
          </CircleMarker>
        ))}
        {bus && <CircleMarker center={[bus.lat, bus.lng]} radius={12} pathOptions={{ color: "#1d4ed8", fillColor: "#3b82f6", fillOpacity: 1 }}><Tooltip permanent direction="top">🚌</Tooltip></CircleMarker>}
      </MapContainer>
    </div>
  );
}
