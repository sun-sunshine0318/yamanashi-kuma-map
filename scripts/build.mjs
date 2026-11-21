// data/posts.json（保存した投稿）から data/sightings.json（地図用データ）を作る。
// X API は使わないので、読み取りルールを直したときは何度でも作り直せる。
import { appendFile } from "node:fs/promises";
import { readJson, writeJson } from "./lib/files.mjs";
import { parsePost } from "./lib/parse.mjs";
import { geocode } from "./lib/geocode.mjs";

const posts = await readJson("data/posts.json", []);
const munis = await readJson("data/municipalities.json", []);
const cache = await readJson("data/geocode-cache.json", {});
const corrections = await readJson("data/corrections.json", {});
const previous = await readJson("data/sightings.json", null);

const muniByName = new Map(munis.map((m) => [m.name, m]));
const sightings = [];
const ignored = [];

for (const post of posts) {
  const p = parsePost(post.text, post.created_at, muniByName.keys());
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

// 中身が変わったときだけ updated_at を進める（無駄なコミットを防ぐ）
const changed = JSON.stringify(previous?.sightings) !== JSON.stringify(sightings);
await writeJson("data/sightings.json", {
  updated_at: changed || !previous ? new Date().toISOString() : previous.updated_at,
  count: sightings.length,
  sightings,
});
await writeJson("data/geocode-cache.json", Object.fromEntries(Object.entries(cache).sort()));

// ---- ログ ----
const byPrecision = sightings.reduce((a, s) => ((a[s.precision] = (a[s.precision] ?? 0) + 1), a), {});
const lines = [
  `出没情報 ${sightings.length} 件（地区レベル ${byPrecision.place ?? 0} 件／市町村レベル ${byPrecision.municipality ?? 0} 件）`,
  `地図に出さない投稿 ${ignored.length} 件`,
  ...ignored.map((i) => `  - ${i.id}（${i.posted_at}）${i.reason}：${i.text.replace(/\s+/g, " ").slice(0, 60)}…`),
  ...sightings
    .filter((s) => s.precision === "municipality")
    .map((s) => `  ※ ${s.broad ? "広めの地区の中心に配置" : "地区が見つからず役場付近に配置"}：${s.id} ${s.municipality} ${s.place_text}`),
];
console.log(lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, "```\n" + lines.join("\n") + "\n```\n");
}
