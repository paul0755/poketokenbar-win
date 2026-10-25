/**
 * 길드 — 길드원들의 방과 포켓몬을 모아 두는 곳. 길드 코드 하나에 Durable Object 하나.
 *
 * 실시간 배틀 방(Room)과 달리 저장한다. 길드원이 꺼져 있어도 방을 구경하고 결투할 수
 * 있어야 하기 때문이다. 저장하는 건 앱이 올린 "방 사진"(snap)뿐이다 — 트레이너 이름,
 * 방 꾸미기, 방에 둔 포켓몬, 도감·졸업·승수, 대표 팀 코드. 토큰 사용 기록은 오지 않는다.
 *
 * ── 계정 없이 ──
 * 들어올 때 서버가 길드원 번호(memberId)와 열쇠(key)를 준다. 앱은 세이브에 둔다.
 * 서버는 열쇠의 해시만 갖고 있어서, 저장소가 새도 남의 칸을 고칠 수 없다.
 * 만든 사람이 길드장 — 내보내기 · 길드 없애기. 길드장이 나가면 가장 오래된 길드원이 맡는다.
 *
 * ── 주소 (index.js 가 넘겨준다) ──
 *   POST /guild                    만들기   { name, member }        → { code, memberId, key }
 *   GET  /guild/ABCD2345           보기                              → { name, leader, members[] }
 *   POST /guild/ABCD2345/join      들어가기 { member }              → { memberId, key }
 *   POST /guild/ABCD2345/update    내 방 올리기 { memberId, key, member }
 *   POST /guild/ABCD2345/leave     나가기   { memberId, key }        — 내 칸은 바로 지운다
 *   POST /guild/ABCD2345/kick      내보내기 { memberId, key, target } (길드장)
 *   POST /guild/ABCD2345/disband   길드 없애기 { memberId, key }    (길드장)
 */

export const MAX_MEMBERS = 30;
const UPDATE_GAP_MS = 15_000; // 내 방 올리기는 15초에 한 번까지

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const fail = (reason, status = 400) => json({ ok: false, reason }, status);

async function sha256(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const randomHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");

const str = (v, n) => String(v ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, n);
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const ID = /^[a-z]{1,16}$/;
const isId = (v) => typeof v === "string" && ID.test(v); // ID.test(undefined) 는 "undefined" 를 본다
const STAGES = ["baby", "mid", "final", "master"];

/**
 * 앱이 올린 방 사진을 꼴만 본다. 내용이 진짜인지는 알 수 없다(세이브는 그 사람 PC에 있다) —
 * 그래서 보상 없이 구경과 친선뿐이다. 모르는 칸은 버리고, 틀린 값은 빼고 받는다.
 */
export function cleanSnap(m) {
  if (!m || typeof m !== "object") return null;
  const trainer = str(m.trainer, 16);
  if (!trainer) return null;
  const mons = (Array.isArray(m.mons) ? m.mons : []).slice(0, 5).map((x) => ({
    line: int(x && x.line, 0, 2000),
    dexId: int(x && x.dexId, 1, 1100),
    name: str(x && x.name, 20),
    shiny: Boolean(x && x.shiny),
    stage: STAGES.includes(x && x.stage) ? x.stage : "baby",
    level: int(x && x.level, 1, 100) ?? 1,
  })).filter((x) => x.line != null && x.dexId != null && x.name);
  const team = typeof m.team === "string" && m.team.length <= 600 && /^PTB1-[A-Za-z0-9_-]+-[0-9a-z]{5}$/.test(m.team) ? m.team : "";
  const dex = m.dex && typeof m.dex === "object" ? m.dex : {};
  return {
    trainer,
    theme: isId(m.theme) ? m.theme : "cabin",
    furni: (Array.isArray(m.furni) ? m.furni : []).filter(isId).slice(0, 24),
    mons,
    dex: { seen: int(dex.seen, 0, 5000) ?? 0, total: int(dex.total, 0, 5000) ?? 0 },
    graduated: int(m.graduated, 0, 100000) ?? 0,
    lastGrad: str(m.lastGrad, 20),
    wins: int(m.wins, 0, 10_000_000) ?? 0,
    team,
  };
}

export class Guild {
  constructor(state) {
    this.state = state;
    this.store = state.storage;
  }

  async members() {
    const all = await this.store.list({ prefix: "m:" });
    return [...all.values()].sort((a, b) => a.joined - b.joined);
  }

  /** 열쇠가 맞는 길드원. 틀리면 null */
  async who(body) {
    const id = str(body.memberId, 40);
    if (!id || typeof body.key !== "string") return null;
    const m = await this.store.get("m:" + id);
    return m && m.keyHash === (await sha256(body.key)) ? m : null;
  }

  async add(snap) {
    const id = "m" + randomHex(6);
    const key = randomHex(16);
    const now = Date.now();
    await this.store.put("m:" + id, { id, keyHash: await sha256(key), snap, joined: now, updated: now });
    return { memberId: id, key };
  }

  async view(meta) {
    const list = await this.members();
    return json({
      ok: true,
      code: meta.code,
      name: meta.name,
      leader: meta.leader,
      max: MAX_MEMBERS,
      members: list.map((m) => ({ id: m.id, snap: m.snap, joined: m.joined, updated: m.updated })),
      now: Date.now(),
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const action = url.pathname.slice(1);
    const meta = await this.store.get("meta");

    if (request.method === "GET") return meta ? this.view(meta) : fail("없는 길드입니다. 코드를 확인해 주세요", 404);

    let body;
    try {
      body = await request.json();
    } catch {
      return fail("잘못된 요청입니다");
    }

    if (action === "create") {
      if (meta) return fail("이미 있는 코드", 409); // index.js 가 다른 코드로 다시 시도한다
      const name = str(body.name, 20);
      const snap = cleanSnap(body.member);
      if (!name) return fail("길드 이름을 넣어 주세요");
      if (!snap) return fail("트레이너 이름이 없습니다");
      const me = await this.add(snap);
      await this.store.put("meta", { code: str(body.code, 8), name, leader: me.memberId, created: Date.now() });
      return json({ ok: true, code: body.code, name, ...me, leader: true });
    }

    if (!meta) return fail("없는 길드입니다. 코드를 확인해 주세요", 404);

    if (action === "join") {
      const snap = cleanSnap(body.member);
      if (!snap) return fail("트레이너 이름이 없습니다");
      if ((await this.members()).length >= MAX_MEMBERS) return fail(`길드가 꽉 찼습니다 (${MAX_MEMBERS}명)`, 403);
      const me = await this.add(snap);
      return json({ ok: true, code: meta.code, name: meta.name, ...me, leader: false });
    }

    const me = await this.who(body);
    if (!me) return fail("길드원 열쇠가 맞지 않습니다. 이미 나갔거나 내보내졌을 수 있습니다", 403);

    if (action === "update") {
      const snap = cleanSnap(body.member);
      if (!snap) return fail("트레이너 이름이 없습니다");
      if (Date.now() - me.updated < UPDATE_GAP_MS) return fail("잠시 뒤에 다시 올려 주세요", 429);
      await this.store.put("m:" + me.id, { ...me, snap, updated: Date.now() });
      return json({ ok: true, leader: meta.leader === me.id });
    }

    if (action === "leave") {
      await this.store.delete("m:" + me.id);
      const rest = await this.members();
      if (!rest.length) await this.store.deleteAll(); // 마지막 사람이 나가면 길드도 없어진다
      else if (meta.leader === me.id) await this.store.put("meta", { ...meta, leader: rest[0].id }); // 가장 오래된 길드원이 맡는다
      return json({ ok: true });
    }

    if (action === "kick") {
      if (meta.leader !== me.id) return fail("길드장만 내보낼 수 있습니다", 403);
      const target = str(body.target, 40);
      if (!target || target === me.id) return fail("내보낼 길드원을 골라 주세요");
      await this.store.delete("m:" + target);
      return json({ ok: true });
    }

    if (action === "disband") {
      if (meta.leader !== me.id) return fail("길드장만 길드를 없앨 수 있습니다", 403);
      await this.store.deleteAll();
      return json({ ok: true });
    }

    return fail("모르는 요청입니다", 404);
  }
}

/** Worker 쪽 — 주소를 풀어 길드 객체에 넘긴다. 만들기는 여기서 코드를 정한다 */
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 헷갈리는 0·O·1·I 는 뺐다
const newCode = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => ALPHA[b % ALPHA.length]).join("");

export async function guildRoute(request, env, code, action) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > 16_384) return fail("요청이 너무 큽니다", 413);
  const stub = (c) => env.GUILDS.get(env.GUILDS.idFromName(c));

  if (!code) {
    if (request.method !== "POST") return fail("POST 로 보내 주세요", 405);
    const body = await request.json().catch(() => null);
    if (!body) return fail("잘못된 요청입니다");
    for (let i = 0; i < 5; i++) {
      const c = newCode();
      const res = await stub(c).fetch("https://guild/create", { method: "POST", body: JSON.stringify({ ...body, code: c }) });
      if (res.status !== 409) return res;
    }
    return fail("코드를 만들지 못했습니다. 다시 시도해 주세요", 503);
  }
  if (request.method === "GET" && !action) return stub(code).fetch("https://guild/view");
  if (request.method !== "POST" || !action) return fail("잘못된 요청입니다", 405);
  return stub(code).fetch("https://guild/" + action, { method: "POST", body: await request.text() });
}
