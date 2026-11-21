// 地名 → 座標（国土地理院 住所検索API）。結果は data/geocode-cache.json に保存して再検索しない。
// 国土地理院APIは見つからないと「似た別の地名」を返すことがあるため、
// 検索語と完全一致した結果だけを採用する。

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
  const hit = features.find((f) => f.properties?.title === query);
  cache[query] = hit
    ? { found: true, lat: hit.geometry.coordinates[1], lng: hit.geometry.coordinates[0] }
    : { found: false };
  return cache[query];
}

/** 「山梨県＋市町村＋地区名」で検索し、だめなら役場の位置を返す */
export async function geocode({ municipality, area }, muniByName, cache) {
  if (area) {
    const r = await lookupAddress(`山梨県${municipality}${area}`, cache);
    if (r?.found) return { lat: r.lat, lng: r.lng, precision: "place" };
  }
  const m = muniByName.get(municipality);
  return { lat: m.lat, lng: m.lng, precision: "municipality" };
}
