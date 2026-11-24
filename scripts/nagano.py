"""長野県「ツキノワグマ出没（目撃）情報」（月別 PDF）を取得して data/nagano-records.json に保存する。

- 出典ページ: https://www.pref.nagano.lg.jp/shinrin/sangyo/ringyo/choju/joho/kuma-map.html
- PDF は 1 行 1 件の表（№・月日・市町村名・区分・目撃/痕跡別・クマの大きさ・頭数・状況）。
  座標や地区名は無いので、地図では市町村の役場付近（おおよその位置）に表示する。
- 県のサーバーに負担をかけないよう、ページの確認は前回成功から 1 時間以上たったときだけ。
  PDF は新しい URL か、サイズ・更新日時が変わったときだけダウンロードする。
- 失敗したときはファイルを書き換えずに終了コード 1 で終わる。

必要なもの: Python 3.10 以上、pypdf
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from pypdf import PdfReader

PAGE_URL = "https://www.pref.nagano.lg.jp/shinrin/sangyo/ringyo/choju/joho/kuma-map.html"
RECORDS = "data/nagano-records.json"
STATE = "data/nagano-state.json"
MUNIS = "data/municipalities.json"
MIN_INTERVAL = timedelta(minutes=60)
USER_AGENT = "kuma-map-bot/1.0 (unofficial bear sighting map; low-frequency fetch)"
JST = timezone(timedelta(hours=9))

HEADER_LINES = {
    "№", "月日", "出没（目撃）", "市町村名 区分", "目撃・痕跡別", "センサーカメラ",
    "目撃・痕跡別・セ", "ンサーカメラ", "クマの大きさ 頭数 目撃したクマの状況",
    "ツキノワグマ出没（目撃）情報",
}
ROW_START = re.compile(r"^(\d+)\s+(20\d\d)/(\d{1,2})/(\d{1,2})\s+(.*)$")
REST = re.compile(
    r"^(?:(里地|林内|人身被害|市街地|住宅地)\s*)?"
    r"(?:(目撃|痕跡|センサーカメラ)\s*)?"
    r"(?:(成獣|幼獣|親子|不明)\s*)?"
    r"(?:([0-9０-９]+頭(?:以上)?|不明)\s*)?"
    r"(.*)$"
)
TIME_HINT = re.compile(r"^(午前|午後)?\s*([0-9]{1,2})\s*[:時]\s*([0-9]{1,2})?")
ZEN = str.maketrans("０１２３４５６７８９：", "0123456789:")


def now_jst() -> datetime:
    return datetime.now(JST)


def load(path, fallback):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return fallback


def save(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")
    os.replace(tmp, path)


def request(url, method="GET"):
    req = urllib.request.Request(url, method=method, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=40) as res:
        info = {
            "length": res.headers.get("Content-Length"),
            "modified": res.headers.get("Last-Modified"),
        }
        body = res.read() if method == "GET" else b""
    return body, info


def fiscal_year(y: int, m: int) -> int:
    return y if m >= 4 else y - 1


def pdf_links(html: str):
    """ページから「令和◯年◯月」の目撃情報 PDF を探す（ファイル名は更新のたびに変わる）"""
    pattern = re.compile(
        r'href="([^"]*mokugeki[^"]*\.pdf)"[^>]*>\s*令和\s*([0-9０-９]+|元)\s*年\s*([0-9０-９]+)\s*月'
    )
    links = []
    for href, ry, rm in pattern.findall(html):
        y = 2018 + (1 if ry == "元" else int(ry.translate(ZEN)))
        m = int(rm.translate(ZEN))
        links.append({"url": urllib.parse.urljoin(PAGE_URL, href), "year": y, "month": m})
    return links


def wanted(link, today: datetime) -> bool:
    """今年度の月と、直近 2 か月（年度の変わり目用）だけを使う"""
    fy = fiscal_year(today.year, today.month)
    if fiscal_year(link["year"], link["month"]) == fy:
        return True
    months_ago = (today.year - link["year"]) * 12 + (today.month - link["month"])
    return 0 <= months_ago <= 2


def time_hint(note: str):
    m = TIME_HINT.match(note.translate(ZEN))
    if not m:
        return None
    ampm, h, mi = m.group(1), int(m.group(2)), int(m.group(3) or 0)
    if ampm == "午後" and h < 12:
        h += 12
    if ampm == "午前" and h == 12:
        h = 0
    if h > 23 or mi > 59:
        return None
    return f"{h:02d}:{mi:02d}"


def parse_pdf(data: bytes, muni_names: set[str], month_key: str, url: str):
    reader = PdfReader(io.BytesIO(data))
    rows, unparsed = [], []
    for page in reader.pages:
        for raw in (page.extract_text() or "").splitlines():
            line = raw.strip()
            if not line or line in HEADER_LINES or line.startswith("注：") or "注：痕跡" in line:
                continue
            m = ROW_START.match(line)
            if m:
                rows.append({"no": int(m.group(1)), "y": int(m.group(2)), "m": int(m.group(3)),
                             "d": int(m.group(4)), "rest": m.group(5)})
            elif rows:
                rows[-1]["rest"] += line  # 状況欄の折り返し
    records = []
    seen = {}
    for r in rows:
        parts = r["rest"].split(" ", 1)
        muni = parts[0]
        if muni not in muni_names:
            unparsed.append(f"{month_key} №{r['no']}: {r['rest'][:40]}")
            continue
        rest = parts[1] if len(parts) > 1 else ""
        area, kind, size, count, note = REST.match(rest).groups()
        note = (note or "").strip()
        date = f"{r['y']:04d}-{r['m']:02d}-{r['d']:02d}"
        key = "|".join([date, muni, area or "", kind or "", size or "", count or "", note])
        base = hashlib.sha1(key.encode("utf-8")).hexdigest()[:12]
        seen[base] = seen.get(base, 0) + 1
        rid = f"nagano-{base}" + (f"-{seen[base]}" if seen[base] > 1 else "")
        records.append({
            "id": rid,
            "month": month_key,
            "date": date,
            "time": time_hint(note),
            "municipality": muni,
            "area_type": area,
            "kind": kind or "目撃",
            "size": size,
            "count": (count or "").translate(ZEN) or None,
            "note": note,
            "row_text": f"{date.replace('-', '/')} {r['rest']}".strip(),
            "pdf_url": url,
        })
    return records, unparsed, len(rows)


def main() -> int:
    today = now_jst()
    state = load(STATE, {})
    force = os.environ.get("NAGANO_FORCE") == "1"
    last = state.get("last_success")
    if last and not force and today - datetime.fromisoformat(last) < MIN_INTERVAL:
        print(f"長野県：前回の確認（{last}）から1時間たっていないので、今回は確認しません")
        return 0

    munis = {m["name"] for m in load(MUNIS, []) if m.get("pref") == "長野県"}
    old_records = load(RECORDS, None)
    initial = old_records is None
    old_records = old_records or []
    first_seen = {r["id"]: r["first_seen"] for r in old_records}

    try:
        html, _ = request(PAGE_URL)
        links = [l for l in pdf_links(html.decode("utf-8", "replace")) if wanted(l, today)]
        if not links:
            raise RuntimeError("ページに今年度の目撃情報 PDF のリンクが見つかりません（ページの作りが変わった可能性）")

        pdfs = state.get("pdfs", {})
        months = {}  # month_key -> records（今回読み直した月）
        unparsed_all = []
        for l in links:
            month_key = f"{l['year']:04d}-{l['month']:02d}"
            prev = pdfs.get(l["url"])
            if prev and not force:
                _, info = request(l["url"], method="HEAD")
                if info["length"] == prev.get("length") and info["modified"] == prev.get("modified"):
                    continue
            data, info = request(l["url"])
            recs, unparsed, nrows = parse_pdf(data, munis, month_key, l["url"])
            if nrows == 0 and len(data) > 50_000:
                raise RuntimeError(f"{month_key} の PDF から表を読み取れませんでした（書式が変わった可能性）")
            if nrows and len(unparsed) > max(3, nrows * 0.2):
                raise RuntimeError(f"{month_key} の PDF で市町村名を読めない行が多すぎます（{len(unparsed)}/{nrows}）")
            unparsed_all += unparsed
            months[month_key] = recs
            pdfs[l["url"]] = {"month": month_key, "length": info["length"], "modified": info["modified"],
                              "sha256": hashlib.sha256(data).hexdigest(), "rows": nrows}
            print(f"長野県 {month_key}：{len(recs)} 件を読み取り（{l['url'].rsplit('/', 1)[-1]}）")
    except Exception as e:  # noqa: BLE001
        print(f"::error::長野県のデータを取得できませんでした：{e}")
        print("既存の長野県データは変更していません。")
        return 1

    keep_months = {f"{l['year']:04d}-{l['month']:02d}" for l in links}
    merged = [r for r in old_records if r["month"] in keep_months and r["month"] not in months]
    stamp = today.isoformat(timespec="seconds")
    added = 0
    for recs in months.values():
        for r in recs:
            if r["id"] in first_seen:
                r["first_seen"] = first_seen[r["id"]]
            else:
                # 初回の取り込みでは「目撃日の夜」を初出とみなす（全件が「新着」にならないように）
                if initial:
                    guess = datetime.fromisoformat(f"{r['date']}T23:59:00+09:00")
                    r["first_seen"] = min(guess, today).isoformat(timespec="seconds")
                else:
                    r["first_seen"] = stamp
                    added += 1
            merged.append(r)
    merged.sort(key=lambda r: (r["date"], r["id"]), reverse=True)

    state["last_success"] = stamp
    state["pdfs"] = {u: v for u, v in pdfs.items() if v.get("month") in keep_months}
    save(RECORDS, merged)
    save(STATE, state)
    for u in unparsed_all:
        print(f"  ※ 市町村名を読めなかった行：{u}")
    print(f"長野県：保存 {len(merged)} 件（新しく見つかった {added} 件）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
