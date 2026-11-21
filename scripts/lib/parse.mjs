// 投稿本文から「種類・日時・市町村・地区名・内容」を読み取る。
// 書式は @yamanashishizen の実投稿（2026年8月〜11月の200件）に合わせている：
//
//   身延町において、以下のとおりツキノワグマの目撃情報がありました。
//   ・目撃日時：令和8年11月18日　午前6時30分頃
//   ・目撃場所：身延町 寺沢地内　天神社・赤山神社から北西へ約150m付近
//
//   笛吹市において、以下のとおりツキノワグマの足跡の発見報告がありました。
//   ・発見日時：令和8年11月3日　午前8時00分頃
//   ・発見場所：笛吹市　一宮町金沢地内　子之神社付近
//
//   早川町において、以下のとおりツキノワグマによる人身被害がありました。
//   ・日時：令和8年11月6日　午後2時30分頃
//   ・場所：早川町　保 地内

const ERA_OFFSET = { 令和: 2018, 平成: 1988 };

// 全角数字・コロンだけを半角に（それ以外の文字は表示用にそのまま残す）
function norm(s) {
  return s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/：/g, ":");
}

const pad = (n) => String(n).padStart(2, "0");

export function parseDate(line, postedAt) {
  const m = line.match(
    /(令和|平成)?\s*(元|\d+)\s*年\s*(\d+)\s*月\s*(\d+)\s*日[\s　]*(?:(午前|午後)?\s*(\d+)\s*時\s*(?:(\d+)\s*分)?)?/
  );
  if (!m) return null;
  const [, era, y, mo, d, ampm, h, mi] = m;
  let year;
  if (era) year = ERA_OFFSET[era] + (y === "元" ? 1 : Number(y));
  else year = Number(y) < 100 ? new Date(postedAt).getUTCFullYear() : Number(y);
  let iso = `${year}-${pad(mo)}-${pad(d)}`;
  if (h !== undefined) {
    let hour = Number(h);
    if (ampm === "午後" && hour < 12) hour += 12;
    if (ampm === "午前" && hour === 12) hour = 0;
    iso += `T${pad(hour)}:${pad(mi ?? 0)}:00+09:00`;
  }
  return iso;
}

// 「・目撃日時：…」の値を取り出す。1行に詰めて書かれた投稿にも対応
function field(t, names) {
  const re = new RegExp(
    `(?:${names})\\s*:\\s*([^\\n]+?)(?=[\\s　]*・\\s*(?:目撃|発見)?(?:日時|場所)\\s*:|\\n|$)`
  );
  return t.match(re)?.[1].trim() ?? null;
}

function detectType(t) {
  if (/人身被害/.test(t)) return { type: "injury", label: "人身被害" };
  if (/足跡/.test(t)) return { type: "trace", label: "足跡を発見" };
  if (/痕跡/.test(t)) return { type: "trace", label: "痕跡を発見" };
  if (/らしき動物/.test(t)) return { type: "sighting", label: "クマらしき動物を目撃" };
  return { type: "sighting", label: "目撃" };
}

/**
 * @returns {{kind:"sighting", ...} | {kind:"other", reason:string}}
 */
export function parsePost(text, postedAt, municipalityNames) {
  const t = norm(text);
  // セアカゴケグモなど他の生き物の投稿を除外（「目撃日時」はクマの投稿だけで使われている）
  if (/外来生物|セアカゴケグモ/.test(t) || !/ツキノワグマ|クマ|目撃日時/.test(t)) {
    return { kind: "other", reason: "ツキノワグマの出没情報ではない" };
  }
  const dateText = field(t, "目撃日時|発見日時|日時");
  const placeText = field(t, "目撃場所|発見場所|場所");
  if (!dateText || !placeText) {
    return { kind: "other", reason: "日時・場所の行がない（注意喚起などの投稿）" };
  }

  // 市町村：場所の先頭 → 1行目「◯◯において」の順に、27市町村リストと照合
  const names = [...municipalityNames].sort((a, b) => b.length - a.length);
  let municipality = names.find((n) => placeText.startsWith(n));
  let rest = municipality ? placeText.slice(municipality.length) : placeText;
  if (!municipality) {
    const header = t.match(/^\s*(.+?)において/);
    municipality = header && names.find((n) => header[1].includes(n));
  }
  if (!municipality) {
    return { kind: "other", reason: `山梨県の市町村が見つからない（場所：${placeText}）` };
  }

  // 地区名：「地内」（または「地区内」）の前まで。目印：その後ろ
  rest = rest.replace(/^[\s　]+/, "").replace(/付近付近/g, "付近");
  let area = "";
  let landmark = "";
  const m = rest.match(/^(.+?)(?:地区内|地内)[、,\s　]*(.*)$/);
  if (m) {
    area = m[1].trim();
    landmark = m[2].trim();
  } else if (/[\s　]/.test(rest)) {
    const parts = rest.split(/[\s　]+/);
    area = parts.shift();
    landmark = parts.join(" ");
  } else {
    landmark = rest; // 地区名なし（例：「豊積橋付近の笛吹川河川敷」）
  }

  const { type, label } = detectType(t);
  return {
    kind: "sighting",
    type,
    sighted_at: parseDate(dateText, postedAt),
    municipality,
    area,
    landmark,
    place_text: area,
    summary: landmark ? `${landmark}で${label}` : label,
  };
}
