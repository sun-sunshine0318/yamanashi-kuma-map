// 地名 → 座標（国土地理院 住所検索API）。結果は data/geocode-cache.json に保存して再検索しない。
//
// 国土地理院APIは見つからないと「似た別の地名」を返すことがある（例：身延町小原島 → 小田船原）。
// そのため次の2種類の結果だけを採用する：
//   exact    … 検索語と完全一致
//   children … 検索語の下位の地名だけが返った（例：北杜市武川町 → 武川町三吹・武川町宮脇…）
//              → それらの中心を「広めの地区」の位置として使う

const GSI = "https://msearch.gsi.go.jp/address-search/AddressSearch?q=";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function lookupAddress(query, cache) {
  if (Object.hasOwn(cache, query)) return cache[query];
  let features;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(GSI + encodeURIComponent(query));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      features = await res.json();
      break;
    } catch (e) {
      if (attempt >= 3) {
        console.warn(`  国土地理院APIに接続できませんでした（${query}）：${e.message}`);
        return null; // キャッシュしない（次回また試す）
      }
      await sleep(1000 * attempt);
    }
  }
  await sleep(200); // 相手のサーバーに負担をかけない

  const titled = features.filter((f) => f.properties?.title);
  const hit = titled.find((f) => f.properties.title === query);
  const children = titled.filter((f) => f.properties.title.startsWith(query) && f.properties.title !== query);
  let result = { found: false };
  if (hit) {
    result = { found: true, kind: "exact", lng: hit.geometry.coordinates[0], lat: hit.geometry.coordinates[1] };
  } else if (children.length > 0 && children.length === titled.length) {
    const avg = (i) => children.reduce((s, f) => s + f.geometry.coordinates[i], 0) / children.length;
    result = { found: true, kind: "children", lng: round(avg(0)), lat: round(avg(1)) };
  }
  cache[query] = result;
  return result;
}

const round = (x) => Math.round(x * 1e6) / 1e6;

/**
 * 投稿の地区名から検索候補を作る。
 *   specific … 見つかれば地区レベル（place）
 *   broad    … 見つかれば「広めの地区」（市町村レベル扱い・位置は地区の中心）
 */
export function areaCandidates(area) {
  const specific = [];
  const broad = [];
  const add = (list, x) => x && !specific.includes(x) && !broad.includes(x) && list.push(x);

  let a = area.replace(/[\s　]/g, "").replace(/^字/, "");
  if (!a) return { specific, broad };

  const paren = a.match(/^(.+?)[（(](.+?)[）)]$/); // 西山地区（湯島） → 湯島 / 西山
  if (paren) {
    add(specific, paren[2]);
    a = paren[1];
  }
  const district = a.match(/^(.+?)地区(.*)$/); // 大鶴地区大倉 → 大倉 / 大鶴
  if (district) {
    if (district[2]) {
      add(specific, district[2]);
      add(broad, district[1]);
    } else {
      add(specific, district[1]); // 大渡地区 → 大渡
    }
  } else {
    add(specific, a);
    if (/[^地]区$/.test(a)) add(specific, a.slice(0, -1)); // 御堂区 → 御堂
    const town = a.match(/^(.{2,}?町)(.+)$/); // 七保町高野 → 七保町
    if (town) add(broad, town[1]);
  }
  return { specific, broad };
}

/** 「山梨県＋市町村＋地区名」で検索し、だめなら役場の位置を返す */
export async function geocode({ municipality, area }, muniByName, cache) {
  const { specific, broad } = areaCandidates(area ?? "");
  let fallback = null;
  for (const c of specific) {
    const r = await lookupAddress(`山梨県${municipality}${c}`, cache);
    if (r?.found && r.kind !== "children") return { lat: r.lat, lng: r.lng, precision: "place" };
    if (r?.found) fallback ??= r;
  }
  for (const c of broad) {
    if (fallback) break;
    const r = await lookupAddress(`山梨県${municipality}${c}`, cache);
    if (r?.found) fallback = r;
  }
  if (fallback) return { lat: fallback.lat, lng: fallback.lng, precision: "municipality", broad: true };
  const m = muniByName.get(municipality);
  return { lat: m.lat, lng: m.lng, precision: "municipality" };
}
