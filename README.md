# 山梨県 ツキノワグマ出没マップ（非公式）

山梨県自然共生推進課の X（[@yamanashishizen](https://x.com/yamanashishizen)）が発信するツキノワグマ出没速報を、地図に表示する非公式 Web アプリです。

**非公式マップです。正確な情報は元投稿と[山梨県公式ページ](https://www.pref.yamanashi.jp/shizen/kuma2.html)をご確認ください。**

## データの流れ

1. `scripts/fetch.mjs` … X API から新着投稿を取得して `data/posts.json` に追記（GitHub Actions で実行）
2. `scripts/build.mjs` … 投稿を読み取り、国土地理院の住所検索で座標に変換して `data/sightings.json` を作成

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

正しい緯度・経度は [地理院地図](https://maps.gsi.go.jp/) で地点をクリックすると確認できます。
