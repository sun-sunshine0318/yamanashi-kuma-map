// 保存したデータから data/sightings.json（地図用データ）を作る。
//   山梨県：data/posts.json（X の投稿）を読み取り、国土地理院の住所検索で座標に変換
//   長野県：data/nagano-records.json（県の月別 PDF の表）を、市町村の役場付近に配置
// X API や県のサイトには接続しないので、読み取りルールを直したときは何度でも作り直せる。
import { appendFile } from "node:fs/promises";
import { readJson, writeJson } from "./lib/files.mjs";
import { parsePost } from "./lib/parse.mjs";
import { geocode } from "./lib/geocode.mjs";

const NAGANO_SOURCE = "https://www.pref.nagano.lg.jp/shinrin/sangyo/ringyo/choju/joho/kuma-map.html";

const posts = await readJson("data/posts.json", []);
const naganoRecords = await readJson("data/nagano-records.json", []);
const munis = await readJson("data/municipalities.json", []);
const cache = await readJson("data/geocode-cache.json", {});
const corrections = await readJson("data/corrections.json", {});
const previous = await readJson("data/sightings.json", null);

const muniByName = new Map(munis.map((m) => [m.name, m]));
const yamanashiNames = munis.filter((m) => m.pref === "山梨県").map((m) => m.name);
const sightings = [];
const ignored = [];

/* ---------- 山梨県（X の投稿） ---------- */
for (const post of posts) {
  const p = parsePost(post.text, post.created_at, yamanashiNames);
  if (p.kind !== "sighting") {
    ignored.push({ id: post.id, posted_at: post.created_at, reason: p.reason, text: post.text });
    continue;
  }
  let pos = await geocode(p, muniByName, cache);
  const fix = corrections[post.id];
  if (fix && Number.isFinite(fix.lat) && Number.isFinite(fix.lng)) {
    pos = { lat: fix.lat, lng: fix.lng, precision: "place", corrected: true };
  }
  sightings.push({
    id: post.id,
    pref: "山梨県",
    type: p.type,
    posted_at: post.created_at,
    sighted_at: p.sighted_at,
    municipality: p.municipality,
    place_text: p.place_text,
    landmark: p.landmark,
    summary: p.summary,
    raw_text: post.text,
    lat: pos.lat,
    lng: pos.lng,
    precision: pos.precision,
    ...(pos.broad ? { broad: true } : {}),
    ...(pos.corrected ? { corrected: true } : {}),
    source_url: `https://x.com/yamanashishizen/status/${post.id}`,
  });
}

/* ---------- 長野県（県の公表資料） ---------- */
function naganoSummary(r) {
  const head =
    r.area_type === "人身被害"
      ? "人身被害"
      : `${r.area_type ? r.area_type + "で" : ""}${r.kind === "痕跡" ? "痕跡を確認" : r.kind === "センサーカメラ" ? "センサーカメラで確認" : "目撃"}`;
  const detail = [r.size && r.size !== "不明" ? r.size : null, r.count && r.count !== "不明" ? r.count : null]
    .filter(Boolean)
    .join("・");
  return `${head}${detail ? `（${detail}）` : ""}${r.note ? `：${r.note}` : ""}`;
}

for (const r of naganoRecords) {
  const m = muniByName.get(r.municipality);
  if (!m) continue;
  const fix = corrections[r.id];
  const fixed = fix && Number.isFinite(fix.lat) && Number.isFinite(fix.lng);
  sightings.push({
    id: r.id,
    pref: "長野県",
    type: r.area_type === "人身被害" ? "injury" : r.kind === "痕跡" ? "trace" : "sighting",
    posted_at: r.first_seen,
    sighted_at: r.time ? `${r.date}T${r.time}:00+09:00` : r.date,
    municipality: r.municipality,
    place_text: "",
    summary: naganoSummary(r),
    raw_text: r.row_text,
    lat: fixed ? fix.lat : m.lat,
    lng: fixed ? fix.lng : m.lng,
    precision: fixed ? "place" : "municipality",
    ...(fixed ? { corrected: true } : {}),
    source_url: NAGANO_SOURCE,
  });
}

// 新しい順に並べる（同じ時刻なら ID 順）
const t = (s) => Date.parse(s.sighted_at.includes("T") ? s.sighted_at : `${s.sighted_at}T00:00:00+09:00`);
sightings.sort((a, b) => t(b) - t(a) || (a.id < b.id ? -1 : 1));

// 中身が変わったときだけ updated_at を進める（無駄なコミットを防ぐ）
const changed = JSON.stringify(previous?.sightings) !== JSON.stringify(sightings);
await writeJson("data/sightings.json", {
  updated_at: changed || !previous ? new Date().toISOString() : previous.updated_at,
  count: sightings.length,
  sightings,
});
await writeJson("data/geocode-cache.json", Object.fromEntries(Object.entries(cache).sort()));

// ---- ログ ----
const yam = sightings.filter((s) => s.pref === "山梨県");
const byPrecision = yam.reduce((a, s) => ((a[s.precision] = (a[s.precision] ?? 0) + 1), a), {});
const lines = [
  `山梨県 出没情報 ${yam.length} 件（地区レベル ${byPrecision.place ?? 0} 件／市町村レベル ${byPrecision.municipality ?? 0} 件）`,
  `長野県 出没情報 ${sightings.length - yam.length} 件（すべて市町村レベル）`,
  `地図に出さない投稿（山梨県） ${ignored.length} 件`,
  ...ignored.map((i) => `  - ${i.id}（${i.posted_at}）${i.reason}：${i.text.replace(/\s+/g, " ").slice(0, 60)}…`),
  ...yam
    .filter((s) => s.precision === "municipality")
    .map((s) => `  ※ ${s.broad ? "広めの地区の中心に配置" : "地区が見つからず役場付近に配置"}：${s.id} ${s.municipality} ${s.place_text}`),
];
console.log(lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, "```\n" + lines.join("\n") + "\n```\n");
}
