// クマのピン（逆さの涙型＋丸い耳のクマの顔）
export const AGE = {
  new: { label: "24時間以内", color: "#F2A0A0" },
  week: { label: "7日以内", color: "#D4A04C" },
  old: { label: "それ以前", color: "#B9B4AC" },
};

const DAY = 24 * 60 * 60 * 1000;

/** 目撃日時（なければ投稿日時）からの経過で区分する。t は時刻（ミリ秒） */
export function ageOfTime(t, now = Date.now()) {
  const diff = now - t;
  if (diff <= DAY) return "new";
  if (diff <= 7 * DAY) return "week";
  return "old";
}

/** ピンの SVG。fill は涙型の色 */
export function pinSvg(fill) {
  return `
<svg class="pin__svg" viewBox="0 0 44 56" width="38" height="48" aria-hidden="true">
  <path d="M22 54 C17 45 4 35 4 21 A18 18 0 1 1 40 21 C40 35 27 45 22 54 Z"
        fill="${fill}" stroke="#2E4057" stroke-width="2" stroke-linejoin="round"/>
  <g stroke="#2E4057" stroke-width="1.5">
    <circle cx="14.2" cy="13.8" r="4.3" fill="#FFF8EC"/>
    <circle cx="29.8" cy="13.8" r="4.3" fill="#FFF8EC"/>
    <circle cx="22" cy="22" r="9.6" fill="#FFF8EC"/>
  </g>
  <circle cx="14.2" cy="13.8" r="2" fill="${fill}"/>
  <circle cx="29.8" cy="13.8" r="2" fill="${fill}"/>
  <circle cx="15.8" cy="24.6" r="1.5" fill="#F2A0A0" opacity=".75"/>
  <circle cx="28.2" cy="24.6" r="1.5" fill="#F2A0A0" opacity=".75"/>
  <circle cx="18.4" cy="20.4" r="1.35" fill="#2E4057"/>
  <circle cx="25.6" cy="20.4" r="1.35" fill="#2E4057"/>
  <ellipse cx="22" cy="25.2" rx="4.2" ry="3.1" fill="#EBD6B8"/>
  <ellipse cx="22" cy="24" rx="1.7" ry="1.15" fill="#2E4057"/>
  <path d="M20.5 26.3 q1.5 1.3 3 0" fill="none" stroke="#2E4057" stroke-width="1" stroke-linecap="round"/>
</svg>`;
}

/** 凡例などに使う丸いアイコン（小さなクマの顔） */
export function dotSvg(fill) {
  return `
<svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true">
  <circle cx="14" cy="14" r="12.5" fill="${fill}" stroke="#2E4057" stroke-width="1.5"/>
  <g stroke="#2E4057" stroke-width="1.2" fill="#FFF8EC">
    <circle cx="9" cy="9.6" r="2.7"/><circle cx="19" cy="9.6" r="2.7"/>
    <circle cx="14" cy="15" r="6.4"/>
  </g>
  <circle cx="11.6" cy="14" r=".95" fill="#2E4057"/>
  <circle cx="16.4" cy="14" r=".95" fill="#2E4057"/>
  <ellipse cx="14" cy="16.9" rx="1.2" ry=".85" fill="#2E4057"/>
</svg>`;
}
