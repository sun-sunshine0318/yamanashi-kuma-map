import { AGE, ageOf, pinSvg, dotSvg } from "./pin.js";

const YAMANASHI = [
  [138.18, 35.16],
  [139.14, 35.97],
];

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

async function fontsReady() {
  // 地図ラベルにも丸ゴシックを使うため、少しだけ読み込みを待つ（最大1.5秒）
  try {
    await Promise.race([
      document.fonts.load('500 14px "Zen Maru Gothic"', "山梨県甲府市北杜身延"),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  } catch {}
}

function renderLegend() {
  const ul = document.getElementById("legend-list");
  ul.innerHTML = Object.values(AGE)
    .map((a) => `<li>${dotSvg(a.color)}<span>${a.label}</span></li>`)
    .join("");
}

function formatDateTime(iso) {
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t)?.value;
  return `${g("month")}月${g("day")}日 ${g("hour")}:${g("minute")}`;
}

function renderHeader(data) {
  const el = document.getElementById("updated");
  if (!data) {
    el.textContent = "データを読み込めませんでした";
    return;
  }
  const now = Date.now();
  const fresh = data.sightings.filter((s) => ageOf(s, now) === "new").length;
  el.innerHTML = `最終更新：${formatDateTime(data.updated_at)}<span class="sep">／</span>24時間以内 <b>${fresh}</b> 件`;
}

function addPins(map, sightings) {
  const now = Date.now();
  // 古いものから置き、新しいピンが上に重なるようにする
  const list = [...sightings].sort(
    (a, b) => Date.parse(a.sighted_at ?? a.posted_at) - Date.parse(b.sighted_at ?? b.posted_at)
  );
  const step = Math.min(40, 1100 / Math.max(list.length, 1));
  list.forEach((s, i) => {
    const age = ageOf(s, now);
    const el = document.createElement("button");
    el.type = "button";
    el.className = `pin pin--${age}`;
    el.setAttribute("aria-label", `${s.municipality}${s.place_text ? " " + s.place_text : ""}：${s.summary}`);
    el.style.setProperty("--delay", `${Math.round(i * step)}ms`);
    el.style.zIndex = String(i);
    el.innerHTML = `<span class="pin__body">${age === "new" ? '<span class="pin__pulse"></span>' : ""}${pinSvg(AGE[age].color)}</span>`;
    new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([s.lng, s.lat]).addTo(map);
  });
}

async function main() {
  renderLegend();
  const dataPromise = fetch("data/sightings.json", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  await fontsReady();

  const map = new maplibregl.Map({
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
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 90 }), "bottom-left");

  const data = await dataPromise;
  renderHeader(data);
  if (!data) return;
  if (map.loaded()) addPins(map, data.sightings);
  else map.once("load", () => addPins(map, data.sightings));
}

main();
