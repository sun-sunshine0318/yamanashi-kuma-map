import { AGE, ageOfTime, pinSvg, dotSvg } from "./pin.js";
import {
  timeOf,
  formatSighted,
  formatUpdated,
  TYPE_LABEL,
  isNewPost,
  approxRadiusKm,
  circlePolygon,
  escapeHtml,
  storageGet,
  storageSet,
} from "./util.js";
import { initPanel } from "./panel.js";

const YAMANASHI = [
  [138.18, 35.16],
  [139.14, 35.97],
];
const CLUSTER_MAX_ZOOM = 14;
const Z_BASE = Date.parse("2020-01-01T00:00:00Z");

// 地図の操作ボタンなどの説明文を日本語に
const LOCALE = {
  "Map.Title": "地図",
  "Marker.Title": "出没地点",
  "Popup.Close": "閉じる",
  "NavigationControl.ZoomIn": "拡大",
  "NavigationControl.ZoomOut": "縮小",
  "NavigationControl.ResetBearing": "北を上にする",
  "GeolocateControl.FindMyLocation": "現在地を表示",
  "GeolocateControl.LocationNotAvailable": "現在地を取得できません",
  "AttributionControl.ToggleAttribution": "出典を表示",
  "AttributionControl.MapFeedback": "地図の誤りを報告",
  "ScaleControl.Meters": "m",
  "ScaleControl.Kilometers": "km",
  "CooperativeGesturesHandler.WindowsHelpText": "Ctrl キーを押しながらスクロールで拡大・縮小",
  "CooperativeGesturesHandler.MacHelpText": "⌘ キーを押しながらスクロールで拡大・縮小",
  "CooperativeGesturesHandler.MobileHelpText": "2本指で地図を動かせます",
};

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = (id) => document.getElementById(id);

const state = {
  all: [],
  byId: new Map(),
  muniByName: new Map(),
  filtered: [],
};

let map;
let panel;

/* ---------------- 共通 ---------------- */

async function fontsReady() {
  // 地図ラベルにも丸ゴシックを使うため、少しだけ読み込みを待つ（最大0.6秒）
  try {
    await Promise.race([
      document.fonts.load('500 14px "Zen Maru Gothic"', "山梨県甲府市北杜身延"),
      new Promise((r) => setTimeout(r, 600)),
    ]);
  } catch {}
}

let toastTimer;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("is-show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-show"), 4500);
}

function renderLegend() {
  $("legend-list").innerHTML = Object.values(AGE)
    .map((a) => `<li>${dotSvg(a.color)}<span>${a.label}</span></li>`)
    .join("");
}

function renderHeader(data) {
  const el = $("updated");
  if (!data) {
    el.textContent = "データを読み込めませんでした。時間をおいて再読み込みしてください。";
    return;
  }
  const n = data.sightings.filter((s) => isNewPost(s)).length;
  el.innerHTML = `最終更新：${formatUpdated(data.updated_at)}<span class="sep">／</span>新着 <b>${n}</b> 件`;
  el.title = "新着＝24時間以内に投稿された出没情報";
}

/* ---------------- ピンとまとめ表示 ---------------- */

const markers = new Map(); // key → Marker
let staggerNext = true;
let selectedId = null;

function toFeatures(list) {
  return {
    type: "FeatureCollection",
    features: list.map((s) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [s.lng, s.lat] },
      properties: { id: s.id, t: timeOf(s) },
    })),
  };
}

function pinElement(s, now) {
  const age = ageOfTime(timeOf(s), now);
  const el = document.createElement("button");
  el.type = "button";
  el.className = `pin pin--${age}${s.id === selectedId ? " is-selected" : ""}`;
  el.dataset.id = s.id;
  el.setAttribute("aria-label", `${formatSighted(s)} ${s.municipality}${s.place_text ? " " + s.place_text : ""}：${s.summary}`);
  el.innerHTML = `<span class="pin__body">${age === "new" ? '<span class="pin__pulse"></span>' : ""}${pinSvg(AGE[age].color)}</span>`;
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    openCard(sameSpot(s), s.id);
  });
  return el;
}

function clusterElement(p, coords, now) {
  const age = ageOfTime(p.newest, now);
  const n = p.point_count;
  const size = n < 10 ? "s" : n < 30 ? "m" : "l";
  const el = document.createElement("button");
  el.type = "button";
  el.className = `cluster cluster--${age} cluster--${size}`;
  el.setAttribute("aria-label", `${n}件の出没情報。タップで拡大`);
  el.innerHTML = `<span class="cluster__body"><span class="cluster__ear cluster__ear--l"></span><span class="cluster__ear cluster__ear--r"></span><span class="cluster__disc"><span class="cluster__face">${n}</span></span></span>`;
  el.addEventListener("click", async (e) => {
    e.stopPropagation();
    const src = map.getSource("sightings");
    const zoom = await src.getClusterExpansionZoom(p.cluster_id);
    if (zoom > CLUSTER_MAX_ZOOM || map.getZoom() >= CLUSTER_MAX_ZOOM) {
      // ほぼ同じ場所に重なっている → まとめてカードに表示
      const leaves = await src.getClusterLeaves(p.cluster_id, 100, 0);
      openCard(leaves.map((f) => state.byId.get(f.properties.id)).filter(Boolean).sort((a, b) => timeOf(b) - timeOf(a)));
    } else {
      map.easeTo({ center: coords, zoom: zoom + 0.2, duration: reduceMotion ? 0 : 600 });
    }
  });
  return el;
}

function syncMarkers() {
  if (!map.getSource("sightings") || !map.isSourceLoaded("sightings")) return;
  const now = Date.now();
  const seen = new Set();
  const created = [];
  for (const f of map.querySourceFeatures("sightings")) {
    const p = f.properties;
    const key = p.cluster ? `c${p.cluster_id}` : `p${p.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (markers.has(key)) continue;
    const coords = f.geometry.coordinates;
    let el;
    if (p.cluster) el = clusterElement(p, coords, now);
    else {
      const s = state.byId.get(p.id);
      if (!s) continue;
      el = pinElement(s, now);
    }
    const t = p.cluster ? p.newest : p.t;
    el.style.zIndex = String(Math.max(0, Math.round((t - Z_BASE) / 60000)));
    const marker = new maplibregl.Marker({ element: el, anchor: p.cluster ? "center" : "bottom" })
      .setLngLat(coords)
      .addTo(map);
    markers.set(key, marker);
    created.push({ el, t });
  }
  for (const [key, m] of markers) {
    if (!seen.has(key)) {
      m.remove();
      markers.delete(key);
    }
  }
  if (!created.length) return;
  if (staggerNext) {
    // 古いものから順に「ピコン」と出す
    created.sort((a, b) => a.t - b.t);
    const step = Math.min(45, 900 / created.length);
    created.forEach((c, i) => c.el.style.setProperty("--delay", `${Math.round(i * step)}ms`));
    staggerNext = false;
  }
}

function clearMarkers() {
  for (const m of markers.values()) m.remove();
  markers.clear();
}

function setFiltered(list) {
  state.filtered = list;
  if (selectedId && !list.some((s) => s.id === selectedId)) closeCard();
  const src = map?.getSource("sightings");
  if (!src) return;
  clearMarkers();
  staggerNext = true;
  src.setData(toFeatures(list));
}

/* ---------------- 情報カード ---------------- */

/** 同じ座標にある（表示中の）出没情報をまとめる */
function sameSpot(s) {
  const list = state.filtered.filter((x) => x.lat === s.lat && x.lng === s.lng);
  list.sort((a, b) => timeOf(b) - timeOf(a));
  return list.length ? list : [s];
}

function precisionHtml(s) {
  if (s.corrected) return `<p class="card__precision">位置は手動で確認・修正済みです。</p>`;
  if (s.precision === "place") {
    return `<p class="card__precision">地区（大字）の代表地点に表示しています。目印の場所とは数百m〜数kmずれることがあります。</p>`;
  }
  const where = s.broad ? "地区の中心付近" : "市町村の役場付近";
  return `<p class="card__precision is-approx"><b>おおよその位置です。</b>地区が特定できないため${where}に表示しています。</p>`;
}

function cardItemHtml(s) {
  const age = ageOfTime(timeOf(s));
  const place = `${escapeHtml(s.municipality)}${s.place_text ? " " + escapeHtml(s.place_text) : ""}`;
  return `
<div class="card__item">
  <div class="card__meta">
    <span class="badge badge--${age}">${TYPE_LABEL[s.type] ?? "目撃"}</span>
    <time datetime="${escapeHtml(s.sighted_at ?? s.posted_at)}">${formatSighted(s)}</time>
  </div>
  <h3 class="card__place">${place}</h3>
  <p class="card__summary">${escapeHtml(s.summary)}</p>
  ${precisionHtml(s)}
  <a class="btn btn--primary" href="${escapeHtml(s.source_url)}" target="_blank" rel="noopener">Xの元投稿で確認する<span aria-hidden="true"> ↗</span></a>
</div>`;
}

function openCard(items, focusId) {
  if (!items.length) return;
  const card = $("card");
  selectedId = focusId ?? items[0].id;
  const head = items.length > 1 ? `<p class="card__count">この付近の出没情報 <b>${items.length}</b> 件</p>` : "";
  card.innerHTML = `
<button type="button" class="icon-btn card__close" aria-label="閉じる"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button>
${head}
<div class="card__scroll">${items.map(cardItemHtml).join("")}</div>`;
  card.querySelector(".card__close").addEventListener("click", closeCard);
  card.hidden = false;
  document.body.classList.add("has-card");

  // 選択中のピンを強調
  document.querySelectorAll(".pin.is-selected").forEach((el) => el.classList.remove("is-selected"));
  document.querySelector(`.pin[data-id="${CSS.escape(selectedId)}"]`)?.classList.add("is-selected");

  // おおよその位置なら薄い円を描く
  const s = state.byId.get(selectedId);
  const src = map.getSource("approx");
  if (s && s.precision === "municipality" && !s.corrected) {
    src.setData(circlePolygon([s.lng, s.lat], approxRadiusKm(s, state.muniByName.get(s.municipality))));
  } else {
    src.setData({ type: "FeatureCollection", features: [] });
  }
}

function closeCard() {
  const card = $("card");
  if (card.hidden) return;
  card.hidden = true;
  document.body.classList.remove("has-card");
  selectedId = null;
  document.querySelectorAll(".pin.is-selected").forEach((el) => el.classList.remove("is-selected"));
  map.getSource("approx")?.setData({ type: "FeatureCollection", features: [] });
}

function focusSighting(id) {
  const s = state.byId.get(id);
  if (!s) return;
  const zoom = Math.max(map.getZoom(), s.precision === "place" ? 13.5 : 11.5);
  map.flyTo({ center: [s.lng, s.lat], zoom, duration: reduceMotion ? 0 : 900, essential: true });
  openCard(sameSpot(s), id);
}

/* ---------------- 現在地 ---------------- */

let meMarker;
class LocateControl {
  onAdd() {
    const div = document.createElement("div");
    div.className = "maplibregl-ctrl maplibregl-ctrl-group";
    div.innerHTML = `<button type="button" class="locate-btn" aria-label="現在地を表示" title="現在地を表示">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor"/><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    </button>`;
    const button = div.querySelector("button");
    button.addEventListener("click", () => askLocate(button));
    return div;
  }
  onRemove() {}
}

function askLocate(button) {
  if (!("geolocation" in navigator)) {
    toast("この端末・ブラウザでは現在地を取得できません。");
    return;
  }
  if (storageGet("kuma-geo-ok", false)) {
    locate(button);
    return;
  }
  const dlg = $("geo-dialog");
  dlg.returnValue = "";
  dlg.showModal();
  dlg.addEventListener(
    "close",
    () => {
      if (dlg.returnValue === "ok") {
        storageSet("kuma-geo-ok", true);
        locate(button);
      }
    },
    { once: true }
  );
}

function locate(button) {
  button.classList.add("is-busy");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      button.classList.remove("is-busy");
      const { longitude: lng, latitude: lat, accuracy } = pos.coords;
      if (!meMarker) {
        const el = document.createElement("div");
        el.className = "me-dot";
        el.setAttribute("role", "img");
        el.setAttribute("aria-label", "現在地");
        meMarker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
      } else meMarker.setLngLat([lng, lat]);
      map.getSource("me-accuracy")?.setData(circlePolygon([lng, lat], Math.min(accuracy, 3000) / 1000));
      const inside = lng > 138.1 && lng < 139.2 && lat > 35.1 && lat < 36.0;
      if (!inside) toast("現在地は山梨県の外のようです。");
      map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 12.5), duration: reduceMotion ? 0 : 900 });
    },
    (err) => {
      button.classList.remove("is-busy");
      const msg = {
        1: "位置情報の利用が許可されていません。ブラウザや端末の設定で、このページの位置情報を「許可」にしてください。",
        2: "現在地を取得できませんでした。電波のよい場所でもう一度お試しください。",
        3: "現在地の取得に時間がかかっています。もう一度お試しください。",
      }[err.code];
      toast(msg ?? "現在地を取得できませんでした。");
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
  );
}

/* ---------------- 起動 ---------------- */

function addLayers() {
  map.addSource("approx", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: "approx-fill", type: "fill", source: "approx", paint: { "fill-color": "#D4A04C", "fill-opacity": 0.16 } });
  map.addLayer({
    id: "approx-line",
    type: "line",
    source: "approx",
    paint: { "line-color": "#B7862F", "line-width": 1.5, "line-dasharray": [2, 2], "line-opacity": 0.8 },
  });
  map.addSource("me-accuracy", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: "me-accuracy", type: "fill", source: "me-accuracy", paint: { "fill-color": "#2E4057", "fill-opacity": 0.1 } });

  map.addSource("sightings", {
    type: "geojson",
    data: toFeatures(state.filtered),
    cluster: true,
    clusterRadius: 46,
    clusterMaxZoom: CLUSTER_MAX_ZOOM,
    clusterProperties: { newest: ["max", ["get", "t"]] },
  });
  // ピンは HTML で描くので、このレイヤーは見えない（データ読み込みのためだけに置く）
  map.addLayer({ id: "sightings-hidden", type: "circle", source: "sightings", paint: { "circle-opacity": 0, "circle-radius": 1 } });
}

async function main() {
  renderLegend();
  const [data, munis] = await Promise.all([
    fetch("data/sightings.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch("data/municipalities.json").then((r) => r.json()).catch(() => []),
    fontsReady(),
  ]);
  renderHeader(data);
  state.all = data?.sightings ?? [];
  state.byId = new Map(state.all.map((s) => [s.id, s]));
  state.muniByName = new Map(munis.map((m) => [m.name, m]));

  map = new maplibregl.Map({
    container: "map",
    style: "map/style.json",
    bounds: YAMANASHI,
    fitBoundsOptions: { padding: 24 },
    maxBounds: [
      [137.4, 34.6],
      [139.9, 36.5],
    ],
    minZoom: 7,
    maxZoom: 17,
    locale: LOCALE,
    attributionControl: false,
    localIdeographFontFamily: "'Zen Maru Gothic', 'Hiragino Maru Gothic ProN', 'BIZ UDPGothic', sans-serif",
    dragRotate: false,
    pitchWithRotate: false,
    fadeDuration: reduceMotion ? 0 : 300,
  });
  window.kumaMap = map; // 動作確認用
  // 画面の大きさが変わったら地図も合わせる（タブが裏にある間に読み込まれた場合の対策も兼ねる）
  new ResizeObserver(() => map.resize()).observe($("map"));
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && map.resize());
  map.touchZoomRotate.disableRotation();
  map.addControl(new LocateControl(), "bottom-right");
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 90 }), "bottom-left");

  panel = initPanel({
    sightings: state.all,
    munis,
    onChange: setFiltered,
    onSelect: (id) => {
      panel.close();
      focusSighting(id);
    },
  });

  map.on("load", () => {
    addLayers();
    map.on("sourcedata", (e) => e.sourceId === "sightings" && e.isSourceLoaded && syncMarkers());
    map.on("moveend", syncMarkers);
    syncMarkers();
  });
  map.on("click", closeCard);
  document.addEventListener("keydown", (e) => e.key === "Escape" && closeCard());
}

main();
