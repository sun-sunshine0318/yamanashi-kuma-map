// 絞り込み・一覧（スマホ：画面下から引き出すシート／PC：左側に固定）
import { AGE, ageOfTime } from "./pin.js";
import { PERIODS, TYPE_LABEL, timeOf, formatShort, escapeHtml, storageGet, storageSet } from "./util.js";

const $ = (id) => document.getElementById(id);
const DEFAULT = { period: "30d", munis: [] };

export function initPanel({ sightings, munis, onChange, onSelect }) {
  const saved = storageGet("kuma-filter", DEFAULT);
  const filter = {
    period: PERIODS.some((p) => p.key === saved.period) ? saved.period : DEFAULT.period,
    munis: new Set((saved.munis ?? []).filter((n) => munis.some((m) => m.name === n))),
  };

  const panelEl = $("panel");
  const periodEl = $("period-chips");
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

  /* ---- 市町村（複数選択） ---- */
  muniEl.innerHTML = munis
    .map(
      (m) =>
        `<button type="button" class="chip chip--muni" data-muni="${escapeHtml(m.name)}" aria-pressed="false">${escapeHtml(m.name)}<span class="chip__n"></span></button>`
    )
    .join("");
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

  /* ---- 一覧 ---- */
  listEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-id]");
    if (b) onSelect(b.dataset.id);
  });

  function renderList(list) {
    if (!list.length) {
      listEl.innerHTML = `<li class="list__empty">条件に合う出没情報はありません。<br>期間を広げるか、市町村の選択を解除してください。</li>`;
      return;
    }
    const now = Date.now();
    listEl.innerHTML = list
      .map((s) => {
        const age = ageOfTime(timeOf(s), now);
        const approx = s.precision === "municipality" && !s.corrected;
        return `<li><button type="button" class="item" data-id="${s.id}">
  <span class="item__dot" style="background:${AGE[age].color}" aria-hidden="true"></span>
  <span class="item__main">
    <span class="item__top"><time>${formatShort(s)}</time><span class="badge badge--${age}">${TYPE_LABEL[s.type] ?? "目撃"}</span>${approx ? '<span class="tag">おおよその位置</span>' : ""}</span>
    <span class="item__place">${escapeHtml(s.municipality)}${s.place_text ? " " + escapeHtml(s.place_text) : ""}</span>
    <span class="item__sum">${escapeHtml(s.summary)}</span>
  </span>
</button></li>`;
      })
      .join("");
  }

  /* ---- 絞り込みを反映 ---- */
  function apply() {
    const now = Date.now();
    const since = PERIODS.find((p) => p.key === filter.period).since(now);
    const inPeriod = sightings.filter((s) => timeOf(s) >= since);

    periodEl.querySelectorAll("[data-period]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.period === filter.period)));
    const counts = new Map();
    for (const s of inPeriod) counts.set(s.municipality, (counts.get(s.municipality) ?? 0) + 1);
    muniEl.querySelectorAll("[data-muni]").forEach((b) => {
      const n = counts.get(b.dataset.muni) ?? 0;
      b.querySelector(".chip__n").textContent = n ? String(n) : "";
      b.classList.toggle("is-zero", n === 0);
      b.setAttribute("aria-pressed", String(filter.munis.has(b.dataset.muni)));
    });
    $("muni-clear").disabled = filter.munis.size === 0;

    const list = inPeriod
      .filter((s) => filter.munis.size === 0 || filter.munis.has(s.municipality))
      .sort((a, b) => timeOf(b) - timeOf(a));

    const periodLabel = PERIODS.find((p) => p.key === filter.period).label;
    const muniLabel = filter.munis.size ? [...filter.munis].join("・") : "県内全域";
    $("list-title").innerHTML = `一覧 <b>${list.length}</b> 件`;
    $("filter-summary").textContent = `${periodLabel}／${muniLabel}`;
    $("open-list-count").textContent = `${list.length}件`;
    $("open-filter-label").textContent = periodLabel + (filter.munis.size ? `・${filter.munis.size}市町村` : "");
    $("open-filter").classList.toggle("is-active", filter.munis.size > 0 || filter.period !== DEFAULT.period);

    renderList(list);
    storageSet("kuma-filter", { period: filter.period, munis: [...filter.munis] });
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
