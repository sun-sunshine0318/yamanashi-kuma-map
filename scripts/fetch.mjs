// X API から @yamanashishizen の新着投稿を取得し、data/posts.json に追記する。
// - since_id で前回以降の新着だけを取得（リツイート・返信は除外）
// - 初回（since_id なし）は最大200件まで
// - エラー時はファイルを一切書き換えずに終了する
// トークンは環境変数 X_BEARER_TOKEN からのみ読み、絶対に出力しない。
import { readJson, writeJson } from "./lib/files.mjs";

const MAX_POSTS = 200;
const POSTS = "data/posts.json";
const STATE = "data/state.json";

const token = process.env.X_BEARER_TOKEN;
if (!token) {
  console.error("X_BEARER_TOKEN が設定されていません（GitHub Secrets を確認してください）");
  process.exit(1);
}

const state = await readJson(STATE, {});
const posts = await readJson(POSTS, []);

class ApiError extends Error {
  constructor(status, body) {
    super(`X API エラー（HTTP ${status}）：${body.slice(0, 300)}`);
    this.status = status;
  }
}

async function xget(path) {
  const res = await fetch(`https://api.x.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.text();
  if (!res.ok) throw new ApiError(res.status, body);
  return JSON.parse(body);
}

const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

try {
  if (!state.user_id) {
    const u = await xget("/2/users/by/username/yamanashishizen");
    state.user_id = u.data.id;
  }

  const fetched = [];
  let newestId = null;
  let pageToken;
  do {
    const params = new URLSearchParams({
      max_results: String(Math.min(100, MAX_POSTS - fetched.length)),
      exclude: "retweets,replies",
      "tweet.fields": "created_at,note_tweet",
    });
    if (state.since_id) params.set("since_id", state.since_id);
    if (pageToken) params.set("pagination_token", pageToken);
    const r = await xget(`/2/users/${state.user_id}/tweets?${params}`);
    newestId ??= r.meta?.newest_id ?? null;
    for (const t of r.data ?? []) {
      fetched.push({
        id: t.id,
        created_at: t.created_at,
        text: decode(t.note_tweet?.text ?? t.text),
      });
    }
    pageToken = r.meta?.next_token;
  } while (pageToken && fetched.length < MAX_POSTS);

  const known = new Set(posts.map((p) => p.id));
  const added = fetched.filter((p) => !known.has(p.id));
  const merged = [...added, ...posts].sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1));

  if (newestId) state.since_id = newestId;
  await writeJson(POSTS, merged);
  await writeJson(STATE, state);
  console.log(`取得 ${fetched.length} 件（うち新規 ${added.length} 件）。保存済みの投稿は合計 ${merged.length} 件`);
} catch (e) {
  if (e instanceof ApiError && e.status === 429) {
    // 上限到達：既存データはそのまま。次回の定期実行で再挑戦する
    console.log(`::warning::X API の利用上限に達しました。既存データは変更していません。${e.message}`);
    process.exit(0);
  }
  console.error(`::error::${e.message}`);
  console.error("既存データは変更していません。");
  process.exit(1);
}
