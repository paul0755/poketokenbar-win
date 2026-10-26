/**
 * 코인 지갑 — 몰에서 쓰는 화폐(🪙). 지갑 번호 하나에 Durable Object 하나.
 *
 * 사탕은 각자 PC 세이브에 있어서 고치면 그만이다. 코인은 처음부터 서버가 잔액을 들고 있다 —
 * 가짜로 결제하거나 같은 코인을 두 번 쓸 수 없다. 그래서 코인은 서버가 확인할 수 있는
 * 일로만 생긴다:
 *
 *   처음 지원금    START          만들 때 한 번
 *   출석           CHECKIN        하루 한 번 (그 사람 PC 의 날짜, 서버 시각 ±36시간 안)
 *   사탕 환전      EXCHANGE_RATE  🍬1 → 🪙5, 하루 EXCHANGE_MAX 번까지. 사탕은 서버가 확인할 수
 *                                 없어서(세이브에 있다) 하루 한도로 묶는다
 *   몰 판매 대금 · 길드 주간 보상  — 길드 객체가 credit 으로 넣는다(아래)
 *
 * ── 계정 없이 ──
 * 만들 때 지갑 번호와 열쇠를 한 번 준다. 서버에는 열쇠의 해시만 둔다. 열쇠를 잃으면 지갑도
 * 잃는다(앱은 세이브에 두고, 세이브 백업에 같이 들어간다).
 *
 * ── 주소 (walletRoute) ──
 *   POST /wallet                          만들기            → { walletId, key, balance }
 *   POST /wallet/w0123456789ab            보기   { key }    → { balance, checkin, exLeft, log }
 *   POST /wallet/w0123456789ab/checkin    출석   { key, day }
 *   POST /wallet/w0123456789ab/exchange   환전   { key, day, n }
 *
 * debit · credit 은 밖에서 부를 수 없다 — walletRoute 가 넘기지 않고, 길드 객체(몰·주간 보상)만
 * 지갑 객체를 직접 부른다. debit 은 그래도 열쇠를 본다(사는 사람이 열쇠를 넘겨야 빠진다).
 */

export const START = 100;
export const CHECKIN = 10;
export const EXCHANGE_RATE = 5;
export const EXCHANGE_MAX = 5;
const LOG_KEEP = 30;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const fail = (reason, status = 400) => json({ ok: false, reason }, status);

async function sha256(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const randomHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");

export const WALLET_ID = /^w[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** 그 사람 PC 의 날짜가 말이 되나 — 서버 시각에서 ±36시간(시간대 차이) 안 */
const sane = (day) => DAY.test(day) && Math.abs(Date.parse(day + "T12:00:00Z") - Date.now()) < 36 * 3_600_000;
const memo = (s) => String(s ?? "").replace(/[\u0000-\u001f]/g, "").slice(0, 40);

export class Wallet {
  constructor(state) {
    this.store = state.storage;
  }

  view(w) {
    return {
      ok: true,
      balance: w.balance,
      checkin: w.checkin || "",
      exDay: w.ex.day,
      exLeft: EXCHANGE_MAX - w.ex.n,
      log: w.log.slice(-LOG_KEEP).reverse(),
    };
  }

  async save(w, delta, why) {
    w.log.push({ at: Date.now(), d: delta, memo: memo(why), bal: w.balance });
    if (w.log.length > LOG_KEEP * 2) w.log = w.log.slice(-LOG_KEEP);
    await this.store.put("w", w);
  }

  async fetch(request) {
    const action = new URL(request.url).pathname.slice(1);
    let body;
    try {
      body = await request.json();
    } catch {
      return fail("잘못된 요청입니다");
    }
    let w = await this.store.get("w");

    if (action === "create") {
      if (w) return fail("이미 있는 지갑", 409);
      const key = randomHex(16);
      w = { id: body.id, keyHash: await sha256(key), balance: START, created: Date.now(), checkin: "", ex: { day: "", n: 0 }, log: [] };
      await this.save(w, START, "처음 지원금");
      return json({ ok: true, walletId: body.id, key, balance: w.balance });
    }
    if (!w) return fail("없는 지갑입니다", 404);

    // 길드 객체만 부른다 — 판매 대금 · 주간 보상
    if (action === "credit") {
      const n = Number(body.amount);
      if (!Number.isSafeInteger(n) || n <= 0 || n > 1_000_000) return fail("금액이 맞지 않습니다");
      w.balance += n;
      await this.save(w, n, body.memo);
      return json({ ok: true, balance: w.balance });
    }

    if (typeof body.key !== "string" || w.keyHash !== (await sha256(body.key))) return fail("지갑 열쇠가 맞지 않습니다", 403);

    if (action === "view") return json(this.view(w));

    if (action === "checkin") {
      if (!sane(body.day)) return fail("날짜가 맞지 않습니다. PC 시계를 확인해 주세요");
      if (w.checkin === body.day) return fail("오늘 출석 코인은 이미 받았습니다");
      if (w.checkin && body.day < w.checkin) return fail("날짜가 맞지 않습니다");
      w.checkin = body.day;
      w.balance += CHECKIN;
      await this.save(w, CHECKIN, "출석");
      return json({ ...this.view(w), got: CHECKIN });
    }

    if (action === "exchange") {
      const n = Number(body.n);
      if (!sane(body.day)) return fail("날짜가 맞지 않습니다. PC 시계를 확인해 주세요");
      if (!Number.isInteger(n) || n < 1 || n > EXCHANGE_MAX) return fail("환전은 한 번에 사탕 1~5개입니다");
      if (w.ex.day !== body.day) w.ex = { day: body.day, n: 0 };
      if (w.ex.n + n > EXCHANGE_MAX) return fail(`오늘 환전 한도(사탕 ${EXCHANGE_MAX}개)를 넘습니다. 남은 한도 ${EXCHANGE_MAX - w.ex.n}개`);
      w.ex.n += n;
      w.balance += n * EXCHANGE_RATE;
      await this.save(w, n * EXCHANGE_RATE, `사탕 ${n}개 환전`);
      return json({ ...this.view(w), got: n * EXCHANGE_RATE });
    }

    // 길드 객체만 부른다 — 몰에서 살 때. 사는 사람의 열쇠는 위에서 이미 봤다
    if (action === "debit") {
      const n = Number(body.amount);
      if (!Number.isSafeInteger(n) || n <= 0) return fail("금액이 맞지 않습니다");
      if (w.balance < n) return fail(`코인이 모자랍니다 (🪙${w.balance})`, 402);
      w.balance -= n;
      await this.save(w, -n, body.memo);
      return json({ ok: true, balance: w.balance });
    }

    return fail("모르는 요청입니다", 404);
  }
}

/** 지갑 객체 — 길드 객체가 판매 대금 · 주간 보상을 넣고, 몰에서 살 때 뺀다 */
export const walletStub = (env, id) => env.WALLETS.get(env.WALLETS.idFromName(id));
export async function walletCall(env, id, action, body) {
  const res = await walletStub(env, id).fetch("https://wallet/" + action, { method: "POST", body: JSON.stringify(body) });
  return { status: res.status, ...(await res.json().catch(() => ({ ok: false, reason: "지갑 응답을 읽지 못했습니다" }))) };
}

/** Worker 쪽 — 밖에서 부를 수 있는 건 만들기 · 보기 · 출석 · 환전뿐이다 */
export async function walletRoute(request, env, id, action) {
  if (request.method !== "POST") return fail("POST 로 보내 주세요", 405);
  const len = Number(request.headers.get("content-length") || 0);
  if (len > 4096) return fail("요청이 너무 큽니다", 413);
  if (!id) {
    for (let i = 0; i < 5; i++) {
      const wid = "w" + randomHex(6);
      const res = await walletStub(env, wid).fetch("https://wallet/create", { method: "POST", body: JSON.stringify({ id: wid }) });
      if (res.status !== 409) return res;
    }
    return fail("지갑을 만들지 못했습니다. 다시 시도해 주세요", 503);
  }
  if (!["checkin", "exchange"].includes(action || "") && action) return fail("모르는 요청입니다", 404);
  return walletStub(env, id).fetch("https://wallet/" + (action || "view"), { method: "POST", body: await request.text() });
}
