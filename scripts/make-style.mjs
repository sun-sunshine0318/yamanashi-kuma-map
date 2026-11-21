// OpenFreeMap の「positron」スタイルをもとに、パステル配色・情報少なめの地図スタイルを作る。
// 実行：node scripts/make-style.mjs  → map/style.json を出力（サイトはこのファイルを読む）
import { mkdir, writeFile } from "node:fs/promises";

const C = {
  cream: "#F4EADB",
  creamLight: "#FBF4E8",
  creamEdge: "#DCCAAF",
  block: "#A9C6C3",
  building: "#95B5B2",
  water: "#BFD8D6",
  waterText: "#4C7A78",
  green: "#C8D9B8",
  navy: "#2E4057",
};

const src = await (await fetch("https://tiles.openfreemap.org/styles/positron")).json();
const byId = new Map(src.layers.map((l) => [l.id, l]));
const take = (id) => {
  const l = structuredClone(byId.get(id));
  if (!l) throw new Error(`positron に ${id} がありません`);
  return l;
};

const nameJa = ["coalesce", ["get", "name:ja"], ["get", "name"]];
const label = (id, { minzoom, size, bold = false, color = C.navy }) => {
  const l = take(id);
  l.minzoom = minzoom;
  delete l.maxzoom;
  l.layout = {
    "text-field": nameJa,
    "text-font": [bold ? "Noto Sans Bold" : "Noto Sans Regular"],
    "text-size": size,
    "text-max-width": 8,
    "text-anchor": "center",
    "text-padding": 6,
  };
  l.paint = {
    "text-color": color,
    "text-halo-color": C.creamLight,
    "text-halo-width": 1.6,
    "text-halo-blur": 0.4,
  };
  return l;
};
const z = (...stops) => ["interpolate", ["linear"], ["zoom"], ...stops];
const zexp = (...stops) => ["interpolate", ["exponential", 1.4], ["zoom"], ...stops];

const layers = [];
const add = (id, fn) => {
  const l = take(id);
  fn(l);
  layers.push(l);
};

layers.push({ id: "background", type: "background", paint: { "background-color": C.cream } });

add("landcover_wood", (l) => {
  l.minzoom = 6;
  l.paint = { "fill-color": C.green, "fill-opacity": z(6, 0.55, 12, 0.85) };
});
add("park", (l) => (l.paint = { "fill-color": C.green }));
add("landuse_residential", (l) => {
  // 住宅地だけでなく商業地・工業地なども「街区」としてくすみブルーで塗る
  delete l.maxzoom;
  l.id = "landuse_block";
  l.filter = [
    "match",
    ["get", "class"],
    ["residential", "suburb", "quarter", "neighbourhood", "commercial", "retail", "industrial", "railway", "school", "hospital", "university", "college"],
    true,
    false,
  ];
  l.paint = { "fill-color": C.block, "fill-opacity": z(8, 0.6, 12, 0.85, 14, 1) };
});
add("water", (l) => (l.paint = { "fill-color": C.water }));
add("waterway", (l) => {
  l.minzoom = 8;
  l.paint = { "line-color": C.water, "line-width": z(8, 0.6, 12, 1.4, 16, 3) };
});
add("building", (l) => {
  l.minzoom = 13;
  l.paint = { "fill-color": C.building };
});

// 道路：クリーム色。街区（くすみブルー）の上では「すき間」に見える
add("highway_minor", (l) => {
  l.minzoom = 12;
  l.paint = { "line-color": C.cream, "line-width": zexp(12, 0.8, 16, 5, 20, 18) };
});
add("highway_major_subtle", (l) => {
  l.paint = { "line-color": C.creamEdge, "line-width": z(6, 0.6, 11, 1.6) };
});
add("highway_major_casing", (l) => {
  l.paint = { "line-color": C.creamEdge, "line-width": zexp(11, 2.6, 16, 10, 20, 26) };
});
add("highway_major_inner", (l) => {
  l.paint = { "line-color": C.creamLight, "line-width": zexp(11, 1.6, 16, 8, 20, 22) };
});
add("highway_motorway_subtle", (l) => {
  l.paint = { "line-color": C.creamEdge, "line-width": 1.2 };
});
add("highway_motorway_casing", (l) => {
  l.paint = { "line-color": C.creamEdge, "line-width": zexp(6, 1.6, 12, 4, 16, 14, 20, 34) };
});
add("highway_motorway_inner", (l) => {
  l.paint = { "line-color": C.creamLight, "line-width": zexp(6, 0.8, 12, 2.4, 16, 11, 20, 28) };
});
add("railway", (l) => {
  l.minzoom = 10;
  l.paint = { "line-color": C.navy, "line-opacity": 0.35, "line-width": z(10, 0.8, 16, 2) };
});

// 境界：県境（admin_level 4）と市町村境（admin_level 7）
add("boundary_3", (l) => {
  l.minzoom = 6;
  l.paint = {
    "line-color": C.navy,
    "line-opacity": 0.45,
    "line-dasharray": [3, 2],
    "line-width": z(6, 1, 12, 2),
  };
});
layers.push({
  id: "boundary_municipality",
  type: "line",
  source: "openmaptiles",
  "source-layer": "boundary",
  minzoom: 9,
  filter: ["all", ["==", ["get", "admin_level"], 7], ["!=", ["get", "maritime"], 1]],
  paint: { "line-color": C.navy, "line-opacity": 0.22, "line-dasharray": [2, 2], "line-width": 1 },
});

// 地名ラベル（日本語：name:ja → name の順）
layers.push(label("water_name_point_label", { minzoom: 9, size: 12, color: C.waterText }));
layers.push(label("label_other", { minzoom: 12, size: z(12, 11, 16, 13) }));
layers.push(label("label_village", { minzoom: 10, size: z(10, 11, 14, 13) }));
layers.push(label("label_town", { minzoom: 8, size: z(8, 12, 12, 15) }));
layers.push(label("label_city", { minzoom: 6, size: z(6, 12, 10, 15, 14, 19), bold: true }));
layers.push(label("label_city_capital", { minzoom: 6, size: z(6, 13, 10, 16, 14, 20), bold: true }));

const style = {
  version: 8,
  name: "Yamanashi Kuma Pastel",
  sources: { openmaptiles: src.sources.openmaptiles },
  glyphs: src.glyphs,
  layers,
};

await mkdir("map", { recursive: true });
await writeFile("map/style.json", JSON.stringify(style, null, 1) + "\n");
console.log(`map/style.json を作成しました（${layers.length} レイヤー）`);
