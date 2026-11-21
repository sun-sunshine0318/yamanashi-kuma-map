// 投稿本文から「日時・市町村・地区名・内容」を読み取る。
// 書式は @yamanashishizen の実投稿（data/raw/sample.json）に合わせている：
//   身延町において、以下のとおりツキノワグマの目撃情報がありました。
//   ・目撃日時：令和8年11月18日　午前6時30分頃
//   ・目撃場所：身延町 寺沢地内　天神社・赤山神社から北西へ約150m付近

const ERA_OFFSET = { 令和: 2018, 平成: 1988 };

// 全角数字・コロンだけを半角に（それ以外の文字は表示用にそのまま残す）
function norm(s) {
  return s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/：/g, ":");
}

function pad(n) {
  return String(n).padStart(2, "0");
}

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

/**
 * @returns {{kind:"sighting", ...} | {kind:"other", reason:string}}
 */
export function parsePost(text, postedAt, municipalityNames) {
  const t = norm(text);
  const dateLine = t.match(/目撃日時\s*:\s*(.+)/);
  const placeLine = t.match(/目撃場所\s*:\s*(.+)/);
  if (!dateLine || !placeLine) {
    return { kind: "other", reason: "「目撃日時」「目撃場所」の行がない（注意喚起などの投稿）" };
  }

  // 市町村：目撃場所の先頭 → 1行目「◯◯において」の順に、27市町村リストと照合
  const names = [...municipalityNames].sort((a, b) => b.length - a.length);
  const loc = placeLine[1].trim();
  let municipality = names.find((n) => loc.startsWith(n));
  let rest = municipality ? loc.slice(municipality.length) : loc;
  if (!municipality) {
    const header = t.match(/^\s*(.+?)において/);
    municipality = header && names.find((n) => header[1].includes(n));
  }
  if (!municipality) {
    return { kind: "other", reason: `山梨県の市町村が見つからない（目撃場所：${loc}）` };
  }

  // 地区名：「地内」の前まで。目印：その後ろ
  rest = rest.replace(/^[\s　]+/, "");
  let area = "";
  let landmark = "";
  const m = rest.match(/^(.+?)地内[\s　]*(.*)$/);
  if (m) {
    area = m[1].trim();
    landmark = m[2].trim();
  } else {
    const parts = rest.split(/[\s　]+/);
    area = parts.shift() ?? "";
    landmark = parts.join(" ");
  }

  return {
    kind: "sighting",
    sighted_at: parseDate(dateLine[1], postedAt),
    municipality,
    area,
    landmark,
    place_text: area,
    summary: landmark ? `${landmark}で目撃` : "目撃",
  };
}
