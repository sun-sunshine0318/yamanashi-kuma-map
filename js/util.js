// 日付の表示・期間の計算など
const DAY = 24 * 60 * 60 * 1000;
const TZ = "Asia/Tokyo";

export const timeOf = (s) => Date.parse(s.sighted_at ?? s.posted_at);

function parts(iso, opts) {
  const p = new Intl.DateTimeFormat("ja-JP", { timeZone: TZ, ...opts }).formatToParts(new Date(iso));
  return Object.fromEntries(p.map((x) => [x.type, x.value]));
}

/** 11月18日（火）16:00頃 */
export function formatSighted(s) {
  const iso = s.sighted_at ?? s.posted_at;
  const hasTime = !s.sighted_at || s.sighted_at.includes("T");
  const p = parts(iso, { month: "numeric", day: "numeric", weekday: "short", hour: "numeric", minute: "2-digit", hourCycle: "h23" });
  const date = `${p.month}月${p.day}日（${p.weekday}）`;
  return hasTime ? `${date}${p.hour}:${p.minute}頃` : date;
}

/** 11/18 16:00 */
export function formatShort(s) {
  const p = parts(s.sighted_at ?? s.posted_at, { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", hourCycle: "h23" });
  return `${p.month}/${p.day} ${p.hour}:${p.minute}`;
}

/** 11月21日 22:27 */
export function formatUpdated(iso) {
  const p = parts(iso, { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", hourCycle: "h23" });
  return `${p.month}月${p.day}日 ${p.hour}:${p.minute}`;
}

/** 今年度（4月1日〜）の開始時刻 */
export function fiscalYearStart(now = Date.now()) {
  const p = parts(new Date(now).toISOString(), { year: "numeric", month: "numeric" });
  const y = Number(p.year) - (Number(p.month) < 4 ? 1 : 0);
  return Date.parse(`${y}-04-01T00:00:00+09:00`);
}

export const PERIODS = [
  { key: "1d", label: "24時間", since: (now) => now - DAY },
  { key: "7d", label: "7日", since: (now) => now - 7 * DAY },
  { key: "30d", label: "30日", since: (now) => now - 30 * DAY },
  { key: "fy", label: "今年度", since: (now) => fiscalYearStart(now) },
];

export const TYPE_LABEL = { sighting: "目撃", trace: "痕跡", injury: "人身被害" };

export function isNewPost(s, now = Date.now()) {
  return now - Date.parse(s.posted_at) <= DAY;
}

/** おおよその位置のときに描く円の半径（km） */
export function approxRadiusKm(s, muni) {
  if (s.broad) return 2.5;
  const r = muni?.area_km2 ? Math.sqrt(muni.area_km2 / Math.PI) : 6;
  return Math.max(2, Math.min(r, 10));
}

/** 円をポリゴンで近似 */
export function circlePolygon([lng, lat], km, steps = 64) {
  const coords = [];
  const dLat = km / 110.574;
  const dLng = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    coords.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [coords] }, properties: {} };
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function storageGet(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
export function storageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
