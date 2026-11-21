// 段階①：@yamanashishizen の最新投稿を少数取得し、書式確認用に保存する。
// トークンは環境変数 X_BEARER_TOKEN からのみ読み、絶対に出力しない。
import { writeFile, mkdir } from "node:fs/promises";

const USERNAME = "yamanashishizen";
const COUNT = Math.min(Math.max(Number(process.env.SAMPLE_COUNT || 20), 5), 100);
const token = process.env.X_BEARER_TOKEN;

if (!token) {
  console.error("X_BEARER_TOKEN が設定されていません（GitHub Secrets を確認してください）");
  process.exit(1);
}

async function xget(path) {
  const res = await fetch(`https://api.x.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.text();
  if (!res.ok) {
    // 応答本文にトークンは含まれないが、念のため長さを制限して表示
    throw new Error(`X API ${res.status}: ${body.slice(0, 500)}`);
  }
  return JSON.parse(body);
}

const user = await xget(`/2/users/by/username/${USERNAME}`);
const userId = user.data.id;
console.log(`user id: ${userId}`);

const params = new URLSearchParams({
  max_results: String(COUNT),
  exclude: "retweets,replies",
  "tweet.fields": "created_at,note_tweet,entities,attachments,lang",
  expansions: "attachments.media_keys",
  "media.fields": "type,url,preview_image_url,alt_text",
});
const tweets = await xget(`/2/users/${userId}/tweets?${params}`);

await mkdir("data/raw", { recursive: true });
const out = {
  fetched_at: new Date().toISOString(),
  user_id: userId,
  username: USERNAME,
  response: tweets,
};
await writeFile("data/raw/sample.json", JSON.stringify(out, null, 2) + "\n");
console.log(`saved ${tweets.data?.length ?? 0} posts to data/raw/sample.json`);
