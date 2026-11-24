// 絞り込み・一覧（スマホ：画面下から引き出すシート／PC：左側に固定）
import { AGE, ageOfTime } from "./pin.js";
import { PERIODS, PREFS, TYPE_LABEL, timeOf, formatShort, escapeHtml, storageGet, storageSet } from "./util.js";

const $ = (id) => document.getElementById(id);
const DEFAULT = { period: "30d", prefs: [], munis: [] };
const LIST_LIMIT = 300;

export function initPanel({ sightings, munis, onChange, onSelect }) {
  const saved = storageGet("kuma-filter", DEFAULT);
  const filter = {
    period: PERIODS.some((p) => p.key === saved.period) ? saved.period : DEFAULT.period,
    prefs: new Set((saved.prefs ?? []).filter((p) => PREFS.includes(p))),
    munis: new Set((saved.munis ?? []).filter((n) => munis.some((m) => m.name === n))),
  };
  const prefOf = new Map(munis.map((m) => [m.name, m.pref ?? "山梨県"]));

  const panelEl = $("panel");
  const periodEl = $("period-chips");
  const prefEl = $("pref-chips");
  const muniEl = $("muni-chips");
  const listEl = $("list");
  let lastOpener = null;

  /* ---- 期間 ---- */
  periodEl.innerHTML = PERIODS.map(
    (p) => `<button type="button" class="chip" data-period="${p.key}" aria-pressed="false">${p.label}</button>`
  ).join("");
  periodEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-period]");
    if (!b) return;
    filter.period = b.dataset.period;
    apply();
  });

  /* ---- 県（複数選択・未選択なら両県） ---- */
  prefEl.innerHTML = PREFS.map(
    (p) => `<button type="button" class="chip" data-pref="${p}" aria-pressed="false">${p}<span class="chip__n"></span></button>`
  ).join("");
  prefEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pref]");
    if (!b) return;
    const p = b.dataset.pref;
    filter.prefs.has(p) ? filter.prefs.delete(p) : filter.prefs.add(p);
    // 外した県の市町村は選択を解除
    for (const n of [...filter.munis]) if (!prefActive(prefOf.get(n))) filter.munis.delete(n);
    apply();
  });
  const prefActive = (p) => filter.prefs.size === 0 || filter.prefs.has(p);

  /* ---- 市町村（複数選択。件数のある市町村だけ表示） ---- */
  muniEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-muni]");
    if (!b) return;
    const n = b.dataset.muni;
    filter.munis.has(n) ? filter.munis.delete(n) : filter.munis.add(n);
    apply();
  });
  $("muni-clear").addEventListener("click", () => {
    filter.munis.clear();
    apply();
  });

  function renderMunis(counts) {
    const groups = PREFS.filter(prefActive).map((pref) => {
      const chips = munis
        .filter((m) => (m.pref ?? "山梨県") === pref && (counts.get(m.name) || filter.munis.has(m.name)))
        .map((m) => {
          const n = counts.get(m.name) ?? 0;
          return `<button type="button" class="chip chip--muni" data-muni="${escapeHtml(m.name)}" aria-pressed="${filter.munis.has(m.name)}">${escapeHtml(m.name)}<span class="chip__n">${n || ""}</span></button>`;
        })
        .join("");
      return `<p class="chips__group">${pref}</p><div class="chips chips--muni">${chips || '<span class="chips__empty">この期間の出没情報はありません</span>'}</div>`;
    });
    muniEl.innerHTML = groups.join("");
  }

  /* ---- 一覧 ---- */
  listEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-id]");
    if (b) onSelect(b.dataset.id);
  });

  function renderList(list) {
    if (!list.length) {
      listEl.innerHTML = `<li class="list__empty">条件に合う出没情報はありません。<br>期間を広げるか、県・市町村の選択を解除してください。</li>`;
      return;
    }
    const now = Date.now();
    const items = list.slice(0, LIST_LIMIT).map((s) => {
      const age = ageOfTime(timeOf(s), now);
      const approx = s.precision === "municipality" && !s.corrected;
      return `<li><button type="button" class="item" data-id="${s.id}">
  <span class="item__dot" style="background:${AGE[age].color}" aria-hidden="true"></span>
  <span class="item__main">
    <span class="item__top"><time>${formatShort(s)}</time><span class="badge badge--${age}">${TYPE_LABEL[s.type] ?? "目撃"}</span>${approx ? '<span class="tag">おおよその位置</span>' : ""}</span>
    <span class="item__place"><span class="pref-tag">${escapeHtml((s.pref ?? "山梨県").replace("県", ""))}</span>${escapeHtml(s.municipality)}${s.place_text ? " " + escapeHtml(s.place_text) : ""}</span>
    <span class="item__sum">${escapeHtml(s.summary)}</span>
  </span>
</button></li>`;
    });
    if (list.length > LIST_LIMIT) {
      items.push(`<li class="list__empty">新しい順に${LIST_LIMIT}件まで表示しています。<br>期間や市町村で絞り込むと、それより前の情報も見られます。</li>`);
    }
    listEl.innerHTML = items.join("");
  }

  /* ---- 絞り込みを反映 ---- */
  function apply() {
    const now = Date.now();
    const since = PERIODS.find((p) => p.key === filter.period).since(now);
    const inPeriod = sightings.filter((s) => timeOf(s) >= since);

    periodEl.querySelectorAll("[data-period]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.period === filter.period)));

    const prefCounts = new Map();
    for (const s of inPeriod) prefCounts.set(s.pref ?? "山梨県", (prefCounts.get(s.pref ?? "山梨県") ?? 0) + 1);
    prefEl.querySelectorAll("[data-pref]").forEach((b) => {
      b.querySelector(".chip__n").textContent = String(prefCounts.get(b.dataset.pref) ?? 0);
      b.setAttribute("aria-pressed", String(filter.prefs.has(b.dataset.pref)));
    });

    const inPref = inPeriod.filter((s) => prefActive(s.pref ?? "山梨県"));
    const counts = new Map();
    for (const s of inPref) counts.set(s.municipality, (counts.get(s.municipality) ?? 0) + 1);
    renderMunis(counts);
    $("muni-clear").disabled = filter.munis.size === 0;

    const list = inPref
      .filter((s) => filter.munis.size === 0 || filter.munis.has(s.municipality))
      .sort((a, b) => timeOf(b) - timeOf(a));

    const periodLabel = PERIODS.find((p) => p.key === filter.period).label;
    const prefLabel = filter.prefs.size === 1 ? [...filter.prefs][0] : "両県";
    const muniLabel = filter.munis.size ? [...filter.munis].join("・") : prefLabel;
    const nFilters = filter.munis.size || (filter.prefs.size === 1 ? 1 : 0);
    $("list-title").innerHTML = `一覧 <b>${list.length}</b> 件`;
    $("filter-summary").textContent = `${periodLabel}／${muniLabel}`;
    $("open-list-count").textContent = `${list.length}件`;
    $("open-filter-label").textContent =
      periodLabel + (filter.munis.size ? `・${filter.munis.size}市町村` : filter.prefs.size === 1 ? `・${prefLabel.replace("県", "")}` : "");
    $("open-filter").classList.toggle("is-active", nFilters > 0 || filter.period !== DEFAULT.period);

    renderList(list);
    storageSet("kuma-filter", { period: filter.period, prefs: [...filter.prefs], munis: [...filter.munis] });
    onChange(list);
  }

  /* ---- シート（スマホ） ---- */
  const backdrop = $("backdrop");
  function open(tab, opener) {
    lastOpener = opener ?? null;
    panelEl.dataset.tab = tab;
    panelEl.querySelectorAll("[data-tab-btn]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tabBtn === tab)));
    panelEl.classList.add("is-open");
    backdrop.hidden = false;
    requestAnimationFrame(() => backdrop.classList.add("is-show"));
    document.body.classList.add("sheet-open");
    panelEl.querySelector(`[data-tab-btn="${tab}"]`)?.focus({ preventScroll: true });
  }
  function close() {
    if (!panelEl.classList.contains("is-open")) return;
    panelEl.classList.remove("is-open");
    panelEl.style.transform = "";
    backdrop.classList.remove("is-show");
    document.body.classList.remove("sheet-open");
    setTimeout(() => (backdrop.hidden = true), 250);
    lastOpener?.focus({ preventScroll: true });
  }
  $("open-list").addEventListener("click", (e) => open("list", e.currentTarget));
  $("open-filter").addEventListener("click", (e) => open("filter", e.currentTarget));
  panelEl.querySelectorAll("[data-tab-btn]").forEach((b) => b.addEventListener("click", () => open(b.dataset.tabBtn, lastOpener)));
  $("panel-close").addEventListener("click", close);
  $("filter-done").addEventListener("click", () => open("list", lastOpener));
  backdrop.addEventListener("click", close);
  document.addEventListener("keydown", (e) => e.key === "Escape" && close());

  // つまみを下にスワイプして閉じる
  const grip = $("panel-grip");
  let startY = null;
  grip.addEventListener("pointerdown", (e) => {
    startY = e.clientY;
    grip.setPointerCapture(e.pointerId);
    panelEl.classList.add("is-dragging");
  });
  grip.addEventListener("pointermove", (e) => {
    if (startY == null) return;
    const dy = Math.max(0, e.clientY - startY);
    panelEl.style.transform = `translateY(${dy}px)`;
  });
  const end = (e) => {
    if (startY == null) return;
    const dy = e.clientY - startY;
    startY = null;
    panelEl.classList.remove("is-dragging");
    panelEl.style.transform = "";
    if (dy > 80) close();
  };
  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);
  grip.addEventListener("click", () => {
    if (startY == null && panelEl.classList.contains("is-open")) close();
  });

  apply();
  return { close };
}
