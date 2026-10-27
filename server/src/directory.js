/**
 * 길드 목록 — 길드장이 "목록에 올리기"를 켠 길드만 모아 두는 곳. 전체에 Durable Object 하나.
 *
 * 길드 코드를 몰라도 목록에서 골라 들어갈 수 있게 한다. 목록에 오르는 건 길드가 스스로 보낸
 * 요약뿐이다 — 이름 · 소개 · 인원 · 길드장 이름 · 이번 주 활동한 인원 · 홀 장식 수. 길드원의
 * 방 사진이나 토큰 합계는 오지 않는다(들어가야 보인다).
 *
 * 길드(guild.js)만 이 객체를 부른다(env.DIRECTORY) — 밖에서는 보기(GET /guilds)만 된다.
 *   POST /put     { code, name, intro, members, max, leader, active, hall, at }  — 올리기 · 고치기
 *   POST /remove  { code }                                                       — 내리기
 *   GET  /list                                                                   → { guilds[] }
 */
const MAX_LISTED = 500; // 넘으면 가장 오래 조용한 길드부터 내린다
const SHOW = 100; // 한 번에 보여 주는 수
const QUIET_DAYS = 14; // 이만큼 아무도 방을 올리지 않은 길드는 목록에서 감춘다
const DAY_MS = 86_400_000;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

export class Directory {
  constructor(state) {
    this.store = state.storage;
  }

  async fetch(request) {
    const action = new URL(request.url).pathname.slice(1);
    if (request.method === "GET" && action === "list") {
      const now = Date.now();
      const all = [...(await this.store.list({ prefix: "g:" })).values()];
      const guilds = all
        .filter((g) => now - g.at < QUIET_DAYS * DAY_MS)
        // 자리가 남은 길드 먼저, 그다음 이번 주 활동한 인원, 최근에 움직인 순
        .sort((a, b) => (a.members >= a.max) - (b.members >= b.max) || b.active - a.active || b.at - a.at)
        .slice(0, SHOW)
        .map(({ code, name, intro, members, max, leader, active, hall, at }) => ({ code, name, intro, members, max, leader, active, hall, at }));
      return json({ ok: true, guilds, total: all.length, now });
    }
    if (request.method !== "POST") return json({ ok: false, reason: "잘못된 요청입니다" }, 405);
    const b = await request.json().catch(() => null);
    if (!b || typeof b.code !== "string") return json({ ok: false, reason: "잘못된 요청입니다" }, 400);
    if (action === "remove") {
      await this.store.delete("g:" + b.code);
      return json({ ok: true });
    }
    if (action === "put") {
      await this.store.put("g:" + b.code, b);
      const all = await this.store.list({ prefix: "g:" });
      if (all.size > MAX_LISTED) {
        const old = [...all.values()].sort((x, y) => x.at - y.at).slice(0, all.size - MAX_LISTED).map((g) => "g:" + g.code);
        await this.store.delete(old);
      }
      return json({ ok: true });
    }
    return json({ ok: false, reason: "모르는 요청입니다" }, 404);
  }
}

/** 길드가 목록을 부를 때 — 실패해도 길드 일은 그대로 한다 */
export async function directoryCall(env, action, body) {
  if (!env.DIRECTORY) return { ok: false };
  try {
    const stub = env.DIRECTORY.get(env.DIRECTORY.idFromName("all"));
    const res = await stub.fetch("https://directory/" + action, body ? { method: "POST", body: JSON.stringify(body) } : undefined);
    return await res.json();
  } catch {
    return { ok: false };
  }
}
