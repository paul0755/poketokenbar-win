/**
 * 길드 목록 — 길드장이 "목록에 올리기"를 켠 길드만 모아 두는 곳. 전체에 Durable Object 하나.
 *
 * 길드 코드를 몰라도 목록에서 골라 들어갈 수 있게 한다. 목록에 오르는 건 길드가 스스로 보낸
 * 요약뿐이다 — 이름 · 소개 · 인원 · 길드장 이름 · 이번 주 활동한 인원 · 홀 장식 수, 그리고
 * 길드 랭킹에 쓸 최근 두 주의 길드 합계(weeks). 길드원 한 사람 한 사람의 방 사진이나 토큰
 * 합계는 오지 않는다(들어가야 보인다).
 *
 * ── 길드 랭킹 ──
 * 목록에 올린 길드끼리 주마다 겨룬다. 길드가 보낸 weeks{ 주: { total, people, reached, gp } }로
 * 그 주와 지난주 표를 만들어 준다. 어떤 기준(합계 · 1인당 · 목표 진행)으로 줄 세울지는 앱이 고른다.
 * 코인 보상은 없다 — 보여 주기만 한다.
 *
 * 길드(guild.js)만 이 객체를 부른다(env.DIRECTORY) — 밖에서는 보기(GET /guilds, /guilds/rank)만 된다.
 *   POST /put     { code, name, intro, members, max, leader, active, hall, at, weeks }  — 올리기 · 고치기
 *   POST /remove  { code }                                                              — 내리기
 *   GET  /list                                                                          → { guilds[] }
 *   GET  /rank?week=2026-10-26                                                          → { week, prev, guilds[] }
 */
const MAX_LISTED = 500; // 넘으면 가장 오래 조용한 길드부터 내린다
const SHOW = 100; // 한 번에 보여 주는 수
const QUIET_DAYS = 14; // 이만큼 아무도 방을 올리지 않은 길드는 목록에서 감춘다
const DAY_MS = 86_400_000;
const shiftDay = (key, n) => new Date(Date.parse(key + "T00:00:00Z") + n * DAY_MS).toISOString().slice(0, 10);

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
    if (request.method === "GET" && action === "rank") {
      // 그 주(앱의 월요일)와 지난주. 둘 다 기록이 없는 길드는 뺀다
      const week = new URL(request.url).searchParams.get("week");
      const prev = shiftDay(week, -7);
      const now = Date.now();
      const pick = (w) => (w && w.total > 0 ? { total: w.total, people: w.people || 0, reached: w.reached || 0, gp: w.gp || 0 } : null);
      const guilds = [...(await this.store.list({ prefix: "g:" })).values()]
        .filter((g) => now - g.at < QUIET_DAYS * DAY_MS)
        .map((g) => ({ code: g.code, name: g.name, members: g.members, max: g.max, cur: pick((g.weeks || {})[week]), prev: pick((g.weeks || {})[prev]) }))
        .filter((g) => g.cur || g.prev);
      return json({ ok: true, week, prev, guilds, now });
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
