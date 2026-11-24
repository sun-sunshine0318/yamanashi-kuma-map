# 長野県・山梨県 ツキノワグマ出没マップ（非公式）

**公開ページ：https://sun-sunshine0318.github.io/yamanashi-kuma-map/**

次の情報を地図に表示する非公式 Web アプリです。

- 山梨県：山梨県自然共生推進課の X（[@yamanashishizen](https://x.com/yamanashishizen)）が発信するツキノワグマ出没速報
- 長野県：長野県「[ツキノワグマ出没（目撃）情報](https://www.pref.nagano.lg.jp/shinrin/sangyo/ringyo/choju/joho/kuma-map.html)」（月別の一覧 PDF。市町村単位の情報を地図用に加工して作成）

**非公式マップです。正確な情報は元の発表と各県の公式ページ（[山梨県](https://www.pref.yamanashi.jp/shizen/kuma2.html)・[長野県](https://www.pref.nagano.lg.jp/shinrin/sangyo/ringyo/choju/joho/kuma-map.html)）をご確認ください。**

## しくみ

1. 外部タイマー [cron-job.org](https://console.cron-job.org/jobs) が **15分ごと** に GitHub Actions（[update.yml](.github/workflows/update.yml)）を起動します（GitHub 自身の定期実行は混雑で間引かれやすいため、1時間ごとの予備として残しています）
2. `scripts/fetch.mjs` … 山梨県：X API から前回以降の新着投稿だけを取得して `data/posts.json` に追記
3. `scripts/nagano.py` … 長野県：県のページから今年度の月別 PDF を探し、新しいものや更新されたものだけを読み取って `data/nagano-records.json` に保存（県のサイトの確認は1時間に1回まで）
4. `scripts/build.mjs` … 両県のデータを地図用にまとめて `data/sightings.json` を作成（山梨県は国土地理院の住所検索で地区の位置に、長野県は市町村の役場付近に配置）
5. 変更があればコミット → GitHub Pages に自動で反映（数分かかります）

地図は MapLibre GL JS ＋ OpenFreeMap（`map/style.json` は `node scripts/make-style.mjs` で作成）。ビルド不要の静的サイトです。

## 運用メモ

| こんなとき | どうする |
|---|---|
| 自動更新が失敗した | 「自動更新エラー」ラベルの Issue が自動で作られます。本文の対処を確認してください。次に成功すると自動で閉じます |
| X のトークンを変えたい | `gh secret set X_BEARER_TOKEN` で登録し直す |
| 15分ごとの更新が止まった | cron-job.org にログインし、ジョブ「山梨クマ出没マップ 自動更新」の履歴（HISTORY）を確認。`401` なら GitHub の鍵（Fine-grained token「yamanashi-kuma-map-timer」、権限は Actions の読み書きのみ）を作り直して Authorization ヘッダーの `Bearer ` のうしろに貼り直す |
| すぐに更新したい | GitHub の Actions →「出没情報を更新」→「Run workflow」 |
| ピンの位置を直したい | 下の「位置を手動で直すには」 |
| 投稿の書式が変わった | Actions の実行結果の Summary に「地図に出さない投稿」が出ます。`scripts/lib/parse.mjs` のルールを直し、`node scripts/build.mjs` で作り直せます（X API は使いません） |

- 公開リポジトリは60日間更新がないと定期実行が止まるため、[keepalive.yml](.github/workflows/keepalive.yml) が毎月1日に維持用コミットをします。
- 画面上部の「最終更新」は、新しい出没情報が最後に反映された時刻です（確認自体は15分ごと）。

## データファイル

| ファイル | 内容 |
|---|---|
| `data/posts.json` | 取得した投稿の原文 |
| `data/sightings.json` | 地図に表示するデータ |
| `data/geocode-cache.json` | 地名→座標の変換結果（同じ地名を再検索しないため） |
| `data/corrections.json` | 位置の手動修正 |
| `data/municipalities.json` | 山梨県27市町村と役場の位置 |
| `data/state.json` | 前回どこまで取得したか |

## 位置の精度（precision）

- `place` … 地区（大字）レベル。国土地理院の住所検索で地区名が完全一致したもの
- `municipality` … おおよその位置。地区が見つからない場合は役場付近、広めの地区（例：七保町）だけ分かった場合はその中心（`broad: true`）

## 位置を手動で直すには

`data/corrections.json` に、投稿ID（元投稿URLの末尾の数字）と正しい緯度・経度を書きます。

```json
{
  "2122541038774677607": { "lat": 35.6512, "lng": 139.0731, "memo": "川合橋の西200m" }
}
```

正しい緯度・経度は [地理院地図](https://maps.gsi.go.jp/) で地点をクリックすると確認できます。次の自動更新（15分以内）で地図に反映されます。

## 出典

- 出没情報：山梨県自然共生推進課（[@yamanashishizen](https://x.com/yamanashishizen)）
- 地図：[OpenFreeMap](https://openfreemap.org) / © [OpenMapTiles](https://www.openmaptiles.org/) / © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)
- 位置（住所検索）：[国土地理院](https://maps.gsi.go.jp/development/ichiran.html)
