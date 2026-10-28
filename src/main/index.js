"use strict";
const { app, Tray, BrowserWindow, Menu, ipcMain, nativeImage, screen, Notification, shell, dialog, powerMonitor } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const usage = require("./usage");
const poke = require("./pokemon");
const limits = require("./limits");
const box = require("./box");
const profile = require("./profile");
const notify = require("./notify");
const backup = require("./backup");
const battle = require("./battle");
const wild = require("./wild");
const friend = require("./friend");
const room = require("./room");
const HALL = require("./hall.json"); // 길드 홀 꾸미기 카탈로그 — 서버와 같은 파일
const burning = require("./burning");
const BERRIES = require("./berries.json");

/**
 * 데이터 폴더.
 *
 * 기본값은 Electron이 주는 userData(%APPDATA%\PokeTokenBar)다. 그런데 그 경로는
 * 샌드박스 안에서 도는 프로그램에게는 다른 곳을 가리킨다. Windows가 조용히
 * 사본으로 돌리기 때문인데, 경로 문자열도 realpath도 똑같이 나와서 아무도
 * 틀렸다고 말해 주지 않는다. 같은 파일을 서로 다르게 읽고 각자 맞다고 우긴다.
 *
 * 그래서 폴더를 AppData 밖으로 뺄 수 있게 둔다. 다른 드라이브에 두거나
 * 통째로 백업하고 싶을 때도 쓸모가 있다.
 *
 *   1) POKETOKENBAR_DATA 환경변수
 *   2) 실행 파일 옆의 data-dir.txt 첫 줄
 */
const DATA_DIR_FILE = path.join(path.dirname(app.getPath("exe")), "data-dir.txt");
const DEFAULT_DATA = app.getPath("userData");

function dataDirOverride() {
  const fromEnv = (process.env.POKETOKENBAR_DATA || "").trim();
  if (fromEnv) return fromEnv;
  try {
    const first = fs.readFileSync(DATA_DIR_FILE, "utf8").split(/\r?\n/)[0].trim();
    if (first) return first;
  } catch {}
  return "";
}

(function applyDataDir() {
  const dir = dataDirOverride();
  if (!dir) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
    app.setPath("userData", dir);
  } catch (e) {
    // 못 쓰는 폴더가 적혀 있다고 앱이 안 뜨면 곤란하다. 기본 폴더로 돌아간다.
    console.error("[data] 지정한 폴더를 쓸 수 없어 기본 폴더로 갑니다 (" + (e.code || e.message) + "): " + dir);
  }
})();

(function seedDataDir() {
  // 옮긴 폴더가 비어 있으면 원래 쓰던 세이브를 한 번 가져온다.
  // 이게 없으면 폴더를 바꾼 순간 알부터 다시 키우게 된다.
  const to = app.getPath("userData");
  if (to === DEFAULT_DATA) return;
  const src = path.join(DEFAULT_DATA, "save.json");
  const dst = path.join(to, "save.json");
  try {
    if (!fs.existsSync(dst) && fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
      console.log("[data] 쓰던 세이브를 새 폴더로 가져왔습니다: " + dst);
    }
  } catch (e) {
    console.error("[data] 세이브를 옮기지 못했습니다 (" + (e.code || e.message) + ")");
  }
})();

const CACHE = path.join(app.getPath("userData"), "sprites");
const SAVE = path.join(app.getPath("userData"), "save.json");
const BACKUPS = path.join(app.getPath("userData"), "backups");

let tray = null;
let win = null; // 팝오버
let lastStats = null;
let lastUsage = null; // 마지막 스캔 결과. 설정 화면의 경로 진단에 쓴다

/**
 * 이상한사탕 1개의 값. 하루 5천만~1억을 쓰면 하루 2~4개다.
 *
 * 뽑기가 공짜 버튼이면 희귀도가 의미를 잃는다. ★5가 1/739여도
 * 1초에 한 번 누르면 10분이면 나온다. 화폐는 "실제로 쓴 토큰"이어야 한다.
 */
const CANDY_PER = 25_000_000;

/**
 * 상점.
 *
 * 알 값은 "며칠 치인가"로 잡았다. 하루 3개쯤 들어온다.
 *
 * 처음엔 3/12/35 였는데 너무 비쌌다. 박스가 생기기 전에는 알을 사면
 * 키우던 아이를 잃는 거라 값이 곧 망설임의 이유였는데, 이제는 그냥
 * 늘어나기만 한다. 모으는 재미보다 굴리는 재미가 맞다.
 * 슈퍼·전설 알이 등급을 "확정"하는 것은 가중치를 없애는 게 아니라
 * 후보를 그 등급 이상으로 좁히는 것이다 — ★4 알에서 ★5도 나온다.
 */
/**
 * 사탕 하나로 밀어 넣는 성장량.
 *
 * CANDY_PER(2500만)보다 한참 적게 잡았다. 같게 두면 토큰을 사탕으로
 * 바꿨다 되돌리는 것뿐이라 아무 선택도 아니게 된다. 손해를 감수하고
 * 특정 아이에게 몰아주는 것이 이 물건의 값어치다.
 */
const CANDY_FEED = 10_000_000;

/* ---------------- 결투 · 나무열매 ---------------- */

/**
 * 하루에 보상을 받는 결투 횟수.
 *
 * 결투는 공짜 버튼이다. 보상에 상한이 없으면 눌러서 열매를 무한히 모으고,
 * 열매가 곧 "토큰 경험치 2배"라 토큰을 안 써도 자라는 길이 열린다.
 * 화폐는 실제로 쓴 토큰이어야 한다는 원칙(CANDY_PER)을 지킨다.
 */
const BATTLE_REWARDS_PER_DAY = 5;

/**
 * 실시간 배틀 중계 서버 기본 주소 — server/ 를 Cloudflare 에 올린 것.
 * 설정 › 온라인 기능에서 바꿀 수 있다. 직접 띄운 로컬 서버(npm run dev)는 ws://127.0.0.1:8787.
 */
const DEFAULT_RELAY = "wss://poketokenbar-relay.yezandi.workers.dev";
const onlineCfg = () => {
  const o = save.online || {};
  return { enabled: Boolean(o.enabled), relay: String(o.relay || "").trim() || DEFAULT_RELAY, custom: String(o.relay || "").trim() };
};

/**
 * 나무열매 하나가 두 배로 쳐 주는 토큰 양. 좋아하는 맛이면 두 배 더 오래 간다.
 * 하루 5천만~1억을 쓰니 보통 열매 하나가 반나절 남짓이다.
 * 아무리 먹여도 BOOST_CAP 까지만 쌓인다 — 열매를 모아 한 번에 몰아주는 걸 막는다.
 */
const BOOST_PLAIN = 20_000_000;
const BOOST_LIKED = 40_000_000;
const BOOST_CAP = 100_000_000;

/**
 * 성격 → 좋아하는/싫어하는 맛. 원작 규칙이다: 올려 주는 능력치의 맛을 좋아하고
 * 내리는 능력치의 맛을 싫어한다. 노력·온순처럼 보정이 없는 성격은 가리는 게 없다.
 */
const FLAVOR_OF_STAT = { 공격: "spicy", 방어: "sour", 특수공격: "dry", 특수방어: "bitter", 스피드: "sweet" };
const FLAVOR_KO = { spicy: "매운맛", dry: "떫은맛", sweet: "단맛", bitter: "쓴맛", sour: "신맛" };
function tasteOf(m) {
  const n = poke.NATURES[m.nature ?? 0] || {};
  if (!n.up || !n.down || n.up === n.down) return { likes: null, dislikes: null };
  return { likes: FLAVOR_OF_STAT[n.up] || null, dislikes: FLAVOR_OF_STAT[n.down] || null };
}

const todayKey = () => usage.localDay(); // 로컬 날짜. 자정에 횟수가 다시 찬다

/** 오늘 남은 보상 횟수 */
function battleRewardsLeft() {
  if (save.battleDay !== todayKey()) return BATTLE_REWARDS_PER_DAY;
  return Math.max(0, BATTLE_REWARDS_PER_DAY - (save.battleRewards || 0));
}

/** 가방 — 화면에 보일 나무열매 목록 */
const berryBag = () =>
  BERRIES.map((b) => ({ key: b.k, name: b.n, flavor: b.f, flavorName: FLAVOR_KO[b.f], count: (save.berries || {})[b.k] || 0 }));

/**
 * 결투. 계산은 여기서 끝까지 하고 화면에는 사건 목록만 넘긴다(battle.js 참고).
 * 승패와 보상을 렌더러가 정하지 않게.
 */
/**
 * level 이 50이면 둘 다 Lv.50 으로 맞춘다. 실제 레벨로 붙이면 Lv.6 과 Lv.60 이
 * 한 방에 끝나서 볼 게 없다 — 그래서 기본은 맞추기다. 그 외 값은 받지 않는다.
 */
function startBattle(idA, idB, level) {
  const a = box.find(save.box, idA);
  const b = box.find(save.box, idB);
  if (!a || !b) return { ok: false, reason: "없는 아이입니다" };
  if (a.id === b.id) return { ok: false, reason: "서로 다른 두 마리를 골라 주세요" };
  const ga = box.effOf(a, growthSpeed());
  const gb = box.effOf(b, growthSpeed());
  if (!poke.stageFor(ga) || !poke.stageFor(gb)) return { ok: false, reason: "알은 싸울 수 없습니다" };
  const r = battle.run(box.withLv(a, growthSpeed()), ga, box.withLv(b, growthSpeed()), gb, Math.random, { level: level === 50 ? 50 : null });
  if (!r) return { ok: false, reason: "결투를 시작하지 못했습니다" };

  // 전적은 개체에 남긴다. 놓아주면 같이 사라진다
  if (r.winner != null) {
    const w = r.winner === 0 ? a : b;
    const l = r.winner === 0 ? b : a;
    w.record = { w: ((w.record || {}).w || 0) + 1, l: (w.record || {}).l || 0 };
    l.record = { w: (l.record || {}).w || 0, l: ((l.record || {}).l || 0) + 1 };
  }

  // 보상 — 승부가 났을 때만, 하루 상한까지
  let reward = null;
  if (r.winner != null && battleRewardsLeft() > 0) {
    if (save.battleDay !== todayKey()) { save.battleDay = todayKey(); save.battleRewards = 0; }
    save.battleRewards = (save.battleRewards || 0) + 1;
    const berry = BERRIES[Math.floor(Math.random() * BERRIES.length)];
    save.berries = save.berries || {};
    save.berries[berry.k] = (save.berries[berry.k] || 0) + 1;
    reward = { key: berry.k, name: berry.n, flavorName: FLAVOR_KO[berry.f] };
  }
  writeSave();
  refresh(true);
  return { ok: true, ...r, reward, rewardsLeft: battleRewardsLeft() };
}

/* ---------------- 친선 배틀 (friend.js) ---------------- */

/** 내 팀 등록 — 이 코드를 친구에게 보낸다 */
function friendRegister(id, trainer) {
  const m = box.find(save.box, id);
  if (!m) return { ok: false, reason: "없는 아이입니다" };
  const grown = box.effOf(m, growthSpeed());
  if (!poke.stageFor(grown)) return { ok: false, reason: "알은 등록할 수 없습니다" };
  save.trainerName = String(trainer || "").trim().slice(0, 16);
  const code = friend.encode(box.withLv(m, growthSpeed()), grown, save.trainerName);
  save.friendTeam = { code, monId: id, at: Date.now() };
  writeSave();
  refresh(true);
  return { ok: true, code };
}

/** 받은 코드 미리 보기 — 붙여 넣자마자 누구인지 보여 준다 */
async function friendInspect(code) {
  const d = friend.decode(code);
  if (d.error) return { ok: false, reason: d.error };
  const desc = poke.describe(d.grown, d.mon.line, { shiny: d.mon.shiny });
  const sp = await poke.spriteWithFallback(desc, CACHE, "anim");
  return {
    ok: true,
    trainer: d.trainer,
    name: desc.name,
    stage: desc.stage.label,
    shiny: d.mon.shiny,
    url: sp ? pathToFileURL(sp).href : null,
    self: Boolean(save.friendTeam && save.friendTeam.code === d.code),
  };
}

/**
 * 친선 배틀. 등록한 내 코드와 친구 코드로 싸운다 — 둘 다 Lv.50, 씨앗은 두 코드에서.
 * 누가 왼쪽인지도 코드로 정해서 양쪽 PC가 같은 판을 돌린다. 화면에는 늘 내가
 * 왼쪽에 서도록 결과만 뒤집어 넘긴다. 보상은 없다 — 가짜 코드로 열매를 찍을 수 있다.
 */
/**
 * 실시간 배틀에서 내가 내보낸 팀. 친선 배틀 등록(friendTeam)과 따로 둔다 — 실시간 배틀은
 * 그 칸에서 고른 아이로 싸우고, 친구에게 보내 둔 친선 코드를 건드리면 안 된다.
 * 방이 끝나면 의미가 없어서 저장하지 않는다.
 */
let liveTeam = null; // { code, monId }

function liveRegister(id) {
  const m = box.find(save.box, id);
  if (!m) return { ok: false, reason: "없는 아이입니다" };
  const grown = box.effOf(m, growthSpeed());
  if (!poke.stageFor(grown)) return { ok: false, reason: "알은 싸울 수 없습니다" };
  liveTeam = { code: friend.encode(box.withLv(m, growthSpeed()), grown, save.trainerName), monId: id };
  return { ok: true, code: liveTeam.code, name: poke.describe(grown, m.line, { shiny: m.shiny }).name };
}

async function friendBattle(code, opts = {}) {
  // opts.team — 길드 결투. 길드에 올려 둔 내 대표 팀 코드로 싸운다
  const team = opts.team ? { code: opts.team } : opts.live ? liveTeam : save.friendTeam;
  if (!team) return { ok: false, reason: opts.live ? "실시간 배틀에서 내 포켓몬을 골라 주세요" : "먼저 내 팀을 등록해 코드를 만들어 주세요" };
  const mine = friend.decode(team.code);
  if (mine.error) return { ok: false, reason: "등록한 내 코드가 이 버전과 맞지 않습니다. 다시 등록해 주세요" };
  const theirs = friend.decode(code);
  if (theirs.error) return { ok: false, reason: theirs.error };
  if (theirs.code === mine.code) return { ok: false, reason: "내 코드입니다. 친구의 코드를 넣어 주세요" };

  const [i, j] = friend.order(mine.code, theirs.code);
  const sides = [mine, theirs];
  const L = sides[i];
  const R = sides[j];
  const r = battle.run(L.mon, L.grown, R.mon, R.grown, friend.rng(friend.seedOf(mine.code, theirs.code)), { level: 50 });
  if (!r) return { ok: false, reason: "결투를 시작하지 못했습니다" };

  // 내가 오른쪽이었으면 화면용으로 뒤집는다 — 계산은 그대로, 보는 쪽만 바뀐다
  const flip = i === 1;
  const sw = (k) => (flip && k >= 0 ? 1 - k : k);
  const fighters = flip ? [r.fighters[1], r.fighters[0]] : r.fighters;
  const log = flip ? r.log.map((e) => ({ ...e, side: sw(e.side) })) : r.log;
  const winner = r.winner == null ? null : sw(r.winner);

  const urls = await Promise.all(
    [mine, theirs].map(async (x) => {
      const p = await poke.spriteWithFallback(poke.describe(x.grown, x.mon.line, { shiny: x.mon.shiny }), CACHE, "anim");
      return p ? pathToFileURL(p).href : null;
    }),
  );
  fighters[0] = { ...fighters[0], url: urls[0], label: (mine.trainer ? mine.trainer + "의 " : "") + fighters[0].name };
  fighters[1] = { ...fighters[1], url: urls[1], label: (theirs.trainer ? theirs.trainer + "의 " : "친구의 ") + fighters[1].name };

  const rec = save.friendRecord || (save.friendRecord = { w: 0, l: 0, d: 0 });
  if (winner == null) rec.d++;
  else if (winner === 0) rec.w++;
  else rec.l++;
  writeSave();
  refresh(true);
  return { ok: true, friendly: true, winner, turns: r.turns, fighters, log, reward: null, rewardsLeft: battleRewardsLeft() };
}

/* ---------------- 교환 (friend.js encodeTrade) ---------------- */

/**
 * 교환으로 진화하는가. 원작에서 교환으로 진화하는 아이(윤겔라·근육몬·데구리·고우스트 등)가
 * 그 모습으로 오면 다음 단계까지 단번에 자란다. lines.json 의 trade 는 PokéAPI 진화
 * 체인에서 뽑은 "교환하면 진화하는 칸"이다(build-lines).
 */
function tradeEvolves(line, grown) {
  const L = poke.LINES[line];
  const st = poke.stageFor(grown);
  return Boolean(L && L.trade && L.trade.includes(st) && poke.STAGES[st + 1]) ? st : -1;
}

/**
 * 보낸다 — 박스에서 빠지고 코드가 나온다. 되돌릴 수 없어서 한 번 묻는다.
 * 실수로 보냈으면 그 코드를 내가 다시 받으면 돌아온다(아래 tradeReceive).
 */
async function tradeSend(id) {
  // 교환 보내기는 길드 몰로 바뀌었다. 이미 보낸 코드는 0.8.x 동안 받을 수 있다(tradeReceive)
  if (id !== "__legacy__") return { ok: false, reason: "교환 보내기는 없어졌습니다. 방 탭의 길드 › 상점 탭의 길드 몰을 쓰세요" };
  const m = box.find(save.box, id);
  if (!m) return { ok: false, reason: "없는 아이입니다" };
  if (save.box.length <= 1) return { ok: false, reason: "마지막 한 마리는 보낼 수 없습니다" };
  const grown = box.effOf(m, growthSpeed());
  if (!poke.stageFor(grown)) return { ok: false, reason: "알은 보낼 수 없습니다" };
  const name = poke.describe(grown, m.line, { shiny: m.shiny }).name;
  const r = await dialog.showMessageBox(win && win.isVisible() ? win : null, {
    type: "question",
    buttons: ["보내기", "취소"],
    defaultId: 1,
    cancelId: 1,
    title: "교환 보내기",
    message: `${battle.josa(name, "을를")} 교환으로 보냅니다.`,
    detail:
      "박스에서 빠지고 교환 코드가 나옵니다. 그 코드를 친구에게 보내세요. 실수였다면 그 코드를 내가 다시 받으면 돌아옵니다." +
      (m.hold === "everstone" ? "\n\n지니고 있는 변하지않는돌도 함께 갑니다." : ""),
  });
  if (r.response !== 0) return { ok: false };

  const code = friend.encodeTrade({ ...box.withLv(m, growthSpeed()), ot: m.ot || save.trainerName }, grown, save.trainerName);
  save.box = save.box.filter((x) => x.id !== id);
  save.petIds = (save.petIds || []).filter((x) => x !== id);
  if (save.activeId === id) save.activeId = save.box[0].id; // 키우던 아이를 보냈으면 다른 아이가 자란다
  save.tradeSent = [...(save.tradeSent || []), { code, name, at: Date.now() }].slice(-5);
  destroyPet(id);
  writeSave();
  syncPets();
  refresh(true);
  pushDex();
  return { ok: true, code, name };
}

/** 받기 전에 미리 본다 — 누구인지, 교환으로 진화하는지, 이미 받은 코드인지 */
async function tradeInspect(code) {
  const d = friend.decodeTrade(code);
  if (d.error) return { ok: false, reason: d.error };
  const desc = poke.describe(d.grown, d.mon.line, { shiny: d.mon.shiny });
  const sp = await poke.spriteWithFallback(desc, CACHE, "anim");
  const evo = d.hold ? -1 : tradeEvolves(d.mon.line, d.grown);
  return {
    ok: true,
    trainer: d.trainer,
    ot: d.ot,
    name: desc.name,
    stage: desc.stage.label,
    shiny: d.mon.shiny,
    url: sp ? pathToFileURL(sp).href : null,
    evolvesTo: evo >= 0 ? poke.LINES[d.mon.line].names[evo + 1] : null,
    stone: Boolean(d.hold),
    used: (save.tradeReceived || []).includes(d.nonce),
    mine: (save.tradeSent || []).some((x) => x.code === d.code),
  };
}

/**
 * 받는다. 같은 코드는 한 번만. 성장량은 난이도와 무관하게 그대로 옮긴다(fed) —
 * 보낸 사람 화면과 같은 모습·레벨로 도착해야 한다.
 * 교환으로 진화하는 모습이면 다음 단계 문턱까지 채워 준다 — 원작의 교환 진화.
 */
function tradeReceive(code) {
  const d = friend.decodeTrade(code);
  if (d.error) return { ok: false, reason: d.error };
  save.tradeReceived = save.tradeReceived || [];
  if (save.tradeReceived.includes(d.nonce)) return { ok: false, reason: "이미 받은 코드입니다. 같은 코드는 한 번만 받을 수 있습니다" };

  let grown = d.grown;
  const evo = d.hold ? -1 : tradeEvolves(d.mon.line, grown);
  const before = poke.describe(grown, d.mon.line, { shiny: d.mon.shiny }).name;
  if (evo >= 0) grown = Math.max(grown, poke.STAGES[evo + 1].at);
  const st = poke.stageFor(grown);
  const { lvGrown, ...dm } = d.mon; // lvGrown 은 세이브에 넣지 않는다 — 아래에서 fed 로 옮긴다
  const m = {
    id: box.newId(),
    ...dm,
    raw: 0,
    bonus: 0,
    boost: 0,
    fed: grown,
    maxStage: st,
    caughtAt: d.caughtAt || new Date().toISOString().slice(0, 10),
    graduatedAt: null,
    ot: d.ot, // 처음 키운 트레이너
    traded: new Date().toISOString().slice(0, 10),
  };
  if (d.hold) {
    // 같이 온 돌. 멈출 자리가 없는 모습이면(그럴 일은 드물다) 가방에 넣어 준다
    const cap = poke.stoneCap(m.line, grown);
    // 돌을 지닌 채 쌓인 레벨은 fed 로 그대로 옮기고, 모습은 holdCap 에서 멈춘다
    if (cap != null) Object.assign(m, { hold: "everstone", holdCap: cap, fed: Math.max(grown, lvGrown || 0) });
    else save.items = { ...(save.items || {}), everstone: stoneCount() + 1 };
  }
  save.box.push(m);
  if (!save.seen.includes(m.line)) save.seen.push(m.line);
  save.maxStage[m.line] = Math.max(save.maxStage[m.line] ?? -1, st);
  save.tradeReceived = [...save.tradeReceived, d.nonce].slice(-500);
  writeSave();
  refresh(true);
  pushDex();

  const after = poke.describe(grown, m.line, { shiny: m.shiny }).name;
  const mine = (save.tradeSent || []).some((x) => x.code === d.code);
  if (save.notifyEnabled && Notification.isSupported() && evo >= 0) {
    new Notification({ title: `${battle.josa(before, "이가")} 진화했다!`, body: `교환으로 ${after}(으)로 진화했습니다`, silent: false }).show();
  }
  return { ok: true, name: after, before, evolved: evo >= 0, returned: mine };
}

/**
 * 나무열매 먹이기. 싫어하는 맛이면 안 먹는다 — 열매도 그대로 남는다.
 */
function feedBerry(id, key) {
  const m = box.find(save.box, id);
  const b = BERRIES.find((x) => x.k === key);
  if (!m || !b) return { ok: false, reason: "없는 아이나 열매입니다" };
  if (!((save.berries || {})[key] > 0)) return { ok: false, reason: b.n + "이(가) 없습니다" };
  const name = poke.describe(box.effOf(m, growthSpeed()), m.line, { shiny: m.shiny }).name;
  const t = tasteOf(m);
  if (t.dislikes === b.f) return { ok: false, reason: `${name}은(는) ${FLAVOR_KO[b.f]}을 싫어해서 먹지 않았습니다` };
  if ((m.boost || 0) >= BOOST_CAP) return { ok: false, reason: `${name}은(는) 배가 불러서 더 먹지 못합니다` };
  const liked = t.likes === b.f;
  m.boost = Math.min(BOOST_CAP, (m.boost || 0) + (liked ? BOOST_LIKED : BOOST_PLAIN));
  save.berries[key] -= 1;
  writeSave();
  refresh(true);
  return {
    ok: true,
    liked,
    message: liked
      ? `${name}은(는) ${b.n}을 맛있게 먹었다! 토큰 경험치 2배가 오래 갑니다`
      : `${name}은(는) ${b.n}을 먹었다. 토큰 경험치 2배`,
  };
}

/* ---------------- 길드 (server/src/guild.js) ----------------
   길드원들의 방과 포켓몬을 모아 본다. 내 방은 "방 사진"(guildSnap)으로 올리고, 남의 방은
   받아서 방 탭이 그대로 그린다. 길드원과는 올려 둔 대표 팀 코드로 바로 친선 배틀을 한다 —
   상대가 꺼져 있어도 된다(친선 배틀은 두 코드만 있으면 같은 결투가 나온다).
   온라인 기능을 켰을 때만 서버에 닿는다. 토큰은 길드 순위용 합계(이번 주·오늘·버닝 몫)만,
   그것도 공개를 켰을 때만 보낸다(guildShare). 기록(로그) 자체는 보내지 않는다. */

const httpBase = () => onlineCfg().relay.replace(/^ws(s?):/, "http$1:").replace(/\/+$/, "");
const guildCall = (path, body) => serverCall("/guild" + path, body);

/** 중계 서버에 HTTP 로 묻는다 — 길드 · 지갑 · 몰이 같이 쓴다 */
async function serverCall(path, body) {
  if (!onlineCfg().enabled) return { ok: false, reason: "설정 › 온라인 기능을 켜야 쓸 수 있습니다", offline: true };
  try {
    const res = await fetch(httpBase() + path, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text().catch(() => "");
    let j = null;
    try { j = JSON.parse(text); } catch {}
    if (j) return { ...j, status: res.status };
    // 길드가 생기기 전 서버는 모르는 주소에 이름표만 돌려준다
    if (text.startsWith("PokeTokenBar relay")) return { ok: false, reason: "이 중계 서버는 아직 길드를 모릅니다. 서버를 새로 배포해야 합니다(server/README.md)" };
    return { ok: false, reason: `서버 응답을 읽지 못했습니다 (${res.status})` };
  } catch {
    return { ok: false, reason: "서버에 닿지 못했습니다. 인터넷이나 설정 › 온라인 기능의 서버 주소를 확인해 주세요" };
  }
}

/**
 * 길드에 올리는 대표 팀 코드 — 방에 둔 첫 아이(없으면 키우는 아이).
 * 친선 코드는 만들 때마다 nonce 가 달라서, 아이·레벨이 그대로면 전에 만든 걸 다시 쓴다.
 * 안 그러면 갱신할 때마다 코드가 바뀌어 매번 올리게 된다.
 */
let guildTeam = { key: "", code: "" };
function guildTeamCode() {
  const m = box.find(save.box, room.monsIn(save, isEggMon)[0]) || box.active(save);
  if (!m || isEggMon(m)) return "";
  const grown = box.effOf(m, growthSpeed());
  const p = profile.build(box.withLv(m, growthSpeed()), grown);
  const key = [m.id, poke.stageFor(grown), p ? p.level : 0, (m.tmMoves || []).length, m.nature, save.trainerName].join("|");
  if (guildTeam.key !== key) guildTeam = { key, code: friend.encode(box.withLv(m, growthSpeed()), grown, save.trainerName) };
  return guildTeam.code;
}

const dexCount = () => ({
  seen: dexSpecies().filter((sp) => (save.maxStage[sp.line] ?? -1) >= sp.stage).length,
  total: dexSpecies().length,
});

/** 내 방 사진. 서버가 꼴을 다시 본다(guild.js cleanSnap) */
function guildSnap() {
  const st = roomState();
  const mons = st.mons
    .map((id) => box.find(save.box, id))
    .filter(Boolean)
    .map((m) => {
      const e = box.effOf(m, growthSpeed());
      const d = poke.describe(e, m.line, { shiny: m.shiny });
      const p = profile.build(box.withLv(m, growthSpeed()), e);
      return { line: m.line, dexId: d.dexId, name: d.name, shiny: d.isShiny, stage: d.stage.key, level: p ? p.level : 1 };
    });
  return {
    trainer: save.trainerName || "",
    theme: st.theme,
    furni: st.furni.filter((f) => f.on).map((f) => f.id),
    statue: st.furni.some((f) => f.id === "statue" && f.on) ? st.statue : null,
    pos: Object.fromEntries(Object.entries(st.pos || {}).filter(([id]) => st.furni.some((f) => f.id === id && f.on))), // 놓은 가구의 옮긴 자리만
    mons,
    dex: dexCount(),
    graduated: st.graduated,
    lastGrad: st.lastGrad || "",
    wins: st.wins,
    team: guildTeamCode(),
    // 공개를 끈 사람은 아예 보내지 않는다 — 서버에도 남지 않는다
    usage: save.guildShare !== false && guildUsage ? guildUsage : null,
    weekTop: (save.weekTop || []).length,
    walletId: (save.wallet && save.wallet.id) || "", // 길드 주간 코인 보상을 넣을 곳
  };
}

/**
 * 길드 순위에 올릴 내 사용량 — 합계뿐이다(이번 주 · 오늘 · 이번 주 중 버닝타임에 쓴 몫 ·
 * 칭호용 시간대별 몫: 아침 6~10 · 코어 10~16 · 야근 18~24 · 새벽 0~6시. 시간대는 버닝타임
 * 설정과 상관없이 고정이다 — 사람마다 다르면 칭호를 견줄 수 없다).
 * 주는 홈의 "이번 주"와 같은 월요일 0시 시작. 언제 기준인지(weekKey·dayKey)를 같이 보내서
 * 지난주에 마지막으로 올린 사람의 숫자가 이번 주 순위에 섞이지 않게 한다.
 */
let guildUsage = null;
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function weekUsage(u, burn) {
  const now = new Date();
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const prevMonday = new Date(monday);
  prevMonday.setDate(prevMonday.getDate() - 7);
  /** [from, to) 사이의 합계 — 전체 · 버닝 몫 · 시간대별 몫 */
  const sum = (from, to) => {
    const s = { week: 0, burn: 0, morning: 0, core: 0, night: 0, dawn: 0 };
    for (const e of u.events || []) {
      if (e.t < from || e.t >= to) continue;
      s.week += e.n;
      if (burning.multAt(e.t, burn) > 1) s.burn += e.n;
      const h = new Date(e.t).getHours();
      if (h < 6) s.dawn += e.n;
      else if (h < 10) s.morning += e.n;
      else if (h < 16) s.core += e.n;
      else if (h >= 18) s.night += e.n;
    }
    for (const k of Object.keys(s)) s[k] = Math.round(s[k]);
    return s;
  };
  const cur = sum(monday.getTime(), Infinity);
  return {
    ...cur,
    week: Math.round(u.week || 0), // 홈의 "이번 주"와 같은 값
    today: Math.round(u.today || 0),
    weekKey: dayKey(monday),
    weekStart: monday.getTime(), // 내 PC 시간대의 월요일 0시 — 서버가 "지난주에 이미 길드원이었나"를 이걸로 본다
    dayKey: dayKey(now),
    // 지난주 최종 합계. 주가 바뀌기 직전 몇 분(마지막으로 올린 뒤 쓴 몫)이나, 일요일 밤 앱이
    // 꺼져 있던 동안 쓴 몫이 지난주 칸에 빠지지 않게 서버가 이걸로 지난주를 마무리한다.
    // 이번 주 내내 같은 값이라 이것 때문에 더 자주 올리지는 않는다
    prev: { ...sum(prevMonday.getTime(), monday.getTime()), weekKey: dayKey(prevMonday) },
  };
}

/** 내 칸 열쇠가 더는 안 맞는다 — 내보내졌거나 길드가 없어졌다. 화면이 알려 주고 지운다 */
function guildGone(r) {
  if (save.guild && (r.status === 403 || r.status === 404)) {
    save.guild.gone = r.status === 404 ? "길드가 없어졌습니다" : "길드에서 내보내졌습니다";
    writeSave();
    refresh(true);
  }
}

/**
 * 지갑 열쇠를 같이 보낼 때 — 서버가 그 지갑이 정말 내 것인지 본다(열쇠는 저장하지 않는다).
 *   - 아직 길드에서 내 지갑이 확인되지 않았을 때: 확인되면 주간 보상 · 목표 보상이 그 지갑으로 간다
 *   - 방에 코인 꾸미기가 있을 때: 정말 산 것인지 보고 안 산 것은 지운다(guild.js checkDeco)
 * 둘 다 아니면 보내지 않는다
 */
const walletKeyFor = (snap) =>
  save.wallet && save.wallet.key && (!(save.guild && save.guild.walletOk) || room.isCoin(snap.theme) || snap.furni.some(room.isCoin)) ? { walletKey: save.wallet.key } : {};

let guildPushed = { body: "", room: "", at: 0 };
/**
 * 바뀐 게 있으면 올린다. 갱신마다 불리지만 같으면 보내지 않는다.
 * 방이 바뀌면 1분에 한 번까지, 토큰 합계만 바뀌면 5분에 한 번까지 — 토큰은 쓰는 동안
 * 늘 바뀌어서, 그대로 두면 길드원 모두가 1분마다 서버를 두드린다.
 */
async function guildPush(force = false) {
  const g = save.guild;
  if (!g || g.gone || !onlineCfg().enabled || !save.trainerName) return;
  const snap = guildSnap();
  const body = JSON.stringify(snap);
  const roomPart = JSON.stringify({ ...snap, usage: snap.usage ? true : null });
  const gap = roomPart !== guildPushed.room ? 60_000 : 5 * 60_000;
  if (!force && (body === guildPushed.body || Date.now() - guildPushed.at < gap)) return;
  guildPushed = { body, room: roomPart, at: Date.now() };
  const r = await guildCall(`/${g.code}/update`, { memberId: g.memberId, key: g.key, member: snap, ...walletKeyFor(snap) });
  if (r.ok && Boolean(r.leader) !== Boolean(g.leader)) { g.leader = Boolean(r.leader); writeSave(); }
  if (r.ok && r.walletOk != null && Boolean(r.walletOk) !== Boolean(g.walletOk)) { g.walletOk = Boolean(r.walletOk); writeSave(); }
  if (!r.ok) {
    if (r.status === 429) guildPushed.body = guildPushed.room = ""; // 너무 잦았다 — 다음 갱신 때 다시
    guildGone(r);
  }
  return r;
}

function setTrainer(trainer) {
  const t = String(trainer || "").trim().slice(0, 16);
  if (!t) return false;
  save.trainerName = t;
  return true;
}

async function guildCreate({ name, trainer, listed = false } = {}) {
  if (save.guild && !save.guild.gone) return { ok: false, reason: "이미 길드에 들어가 있습니다. 나간 뒤에 만들어 주세요" };
  if (!setTrainer(trainer)) return { ok: false, reason: "트레이너 이름을 넣어 주세요" };
  if (!String(name || "").trim()) return { ok: false, reason: "길드 이름을 넣어 주세요" };
  const snap = guildSnap();
  const r = await guildCall("", { name: String(name).trim().slice(0, 20), listed: Boolean(listed), member: snap, ...walletKeyFor(snap) });
  if (!r.ok) return r;
  save.guild = { code: r.code, name: r.name, memberId: r.memberId, key: r.key, leader: true, walletOk: Boolean(r.walletOk) };
  guildPushed = { body: "", room: "", at: Date.now() };
  writeSave();
  refresh(true);
  return { ok: true, code: r.code, message: `길드 "${r.name}"를 만들었습니다. ${r.listed ? "길드 목록에 올렸습니다" : "코드를 친구에게 알려 주세요"}` };
}

async function guildJoin({ code, trainer } = {}) {
  if (save.guild && !save.guild.gone) return { ok: false, reason: "이미 길드에 들어가 있습니다. 나간 뒤에 들어가 주세요" };
  if (!setTrainer(trainer)) return { ok: false, reason: "트레이너 이름을 넣어 주세요" };
  const c = String(code || "").toUpperCase().replace(/^GLD-?/, "").replace(/[^A-Z0-9]/g, "");
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(c)) return { ok: false, reason: "길드 코드는 8글자입니다 (예: GLD-ABCD2345)" };
  const snap = guildSnap();
  const r = await guildCall(`/${c}/join`, { member: snap, ...walletKeyFor(snap) });
  if (!r.ok) return r;
  save.guild = { code: c, name: r.name, memberId: r.memberId, key: r.key, leader: false, walletOk: Boolean(r.walletOk) };
  guildPushed = { body: "", room: "", at: Date.now() };
  writeSave();
  refresh(true);
  return { ok: true, message: `길드 "${r.name}"에 들어왔습니다` };
}

/**
 * 길드 목록 — 길드장이 목록에 올린 길드들(server/src/directory.js). 코드를 몰라도 골라 들어간다.
 * 목록에는 길드 요약만 있다(이름 · 소개 · 인원 · 길드장 이름 · 이번 주 활동한 인원 · 홀 장식 수)
 */
async function guildList() {
  const r = await serverCall("/guilds");
  if (!r.ok) return { ok: false, reason: r.offline ? r.reason : "길드 목록을 불러오지 못했습니다" };
  return { ok: true, guilds: r.guilds || [], now: r.now || Date.now() };
}

/** 내 길드를 목록에 올리기 · 내리기, 소개 글 — 길드장만 */
async function guildListing({ listed, intro } = {}) {
  const g = save.guild;
  if (!g || g.gone) return { ok: false, reason: "길드에 들어가 있지 않습니다" };
  if (!g.leader) return { ok: false, reason: "길드장만 바꿀 수 있습니다" };
  const r = await guildCall(`/${g.code}/listing`, { memberId: g.memberId, key: g.key, listed: Boolean(listed), intro: String(intro || "").trim().slice(0, 60) });
  if (!r.ok) { guildGone(r); return r; }
  return { ok: true, listed: r.listed, intro: r.intro, message: r.listed ? "길드 목록에 올렸습니다 — 누구나 목록에서 찾아 들어올 수 있습니다" : "길드 목록에서 내렸습니다 — 코드로만 들어올 수 있습니다" };
}

async function guildLeave() {
  const g = save.guild;
  if (!g) return { ok: true };
  await marketReclaimAll().catch(() => {}); // 몰에 맡겨 둔 아이부터 돌려받는다(내보내졌어도 지갑 열쇠로)
  if (!g.gone) {
    const r = await guildCall(`/${g.code}/leave`, { memberId: g.memberId, key: g.key });
    // 이미 내보내졌거나 길드가 없으면 서버에 지울 것도 없다 — 내 쪽만 지우면 된다
    if (!r.ok && r.status !== 403 && r.status !== 404) return r;
  }
  save.guild = null;
  guildCache = null;
  writeSave();
  refresh(true);
  return { ok: true, message: "길드에서 나왔습니다" };
}

/**
 * 트레이너 이름 바꾸기 — 길드에 들어간 뒤에도. 바로 길드에 올린다(방 사진의 trainer).
 * 이미 지난 주간 기록 · 몰에 올려 둔 매물 · 이미 만든 친선 코드에는 옛 이름이 남는다
 */
async function guildRename(trainer) {
  const before = save.trainerName;
  if (!setTrainer(trainer)) return { ok: false, reason: "트레이너 이름을 넣어 주세요" };
  if (save.trainerName === before) return { ok: true, message: "이름이 그대로입니다" };
  writeSave();
  refresh(true);
  if (!save.guild || save.guild.gone) return { ok: true, message: `이름을 "${save.trainerName}"(으)로 바꿨습니다` };
  const r = await guildPush(true).catch(() => null);
  if (r && r.status === 429) return { ok: true, message: `이름을 "${save.trainerName}"(으)로 바꿨습니다. 길드에는 잠시 뒤에 올라갑니다` };
  if (r && !r.ok) return { ok: false, reason: `이름은 바꿨지만 길드에 올리지 못했습니다 — ${r.reason || "다음 갱신 때 다시 올립니다"}` };
  return { ok: true, message: `이름을 "${save.trainerName}"(으)로 바꿨습니다` };
}

async function guildShare(on) {
  save.guildShare = Boolean(on);
  writeSave();
  refresh(true);
  await guildPush(true).catch(() => {});
  return { ok: true, message: on ? "길드 순위에 내 토큰 합계를 공개합니다" : "길드 순위에서 내 토큰 합계를 감췄습니다" };
}

async function guildKick(target) {
  const g = save.guild;
  if (!g || !g.leader) return { ok: false, reason: "길드장만 내보낼 수 있습니다" };
  const r = await guildCall(`/${g.code}/kick`, { memberId: g.memberId, key: g.key, target });
  return r.ok ? { ok: true, message: "내보냈습니다" } : r;
}

/**
 * 길드 보기 — 길드원마다 방을 그릴 수 있는 꼴로 바꾼다. 스프라이트는 내 PC 캐시에서
 * (처음 보는 종이면 받아서). 남의 팀 코드는 화면에 넘기지 않고 여기 둔다(결투에만 쓴다).
 */
let guildCache = null; // { members: Map(id → team) }
async function guildView() {
  const g = save.guild;
  if (!g) return { ok: false, reason: "길드에 들어가 있지 않습니다" };
  if (g.gone) return { ok: false, gone: g.gone, reason: g.gone };
  // 길드 코인 보상을 받을 지갑 — 없으면 만든다(상점 탭을 한 번도 안 연 길드원도 받게)
  if (!save.wallet) await walletEnsure().catch(() => {});
  await guildPush(!g.walletOk && Boolean(save.wallet)).catch(() => {}); // 내 칸이 최신이어야 다른 사람이 보는 내 방도 맞다. 지갑이 아직 확인 전이면 바로 올린다
  const r = await guildCall(`/${g.code}`);
  if (!r.ok) {
    guildGone(r);
    return r;
  }
  if (!r.members.some((m) => m.id === g.memberId)) {
    guildGone({ status: 403 });
    return { ok: false, gone: "길드에서 내보내졌습니다", reason: "길드에서 내보내졌습니다" };
  }
  const leader = r.leader === g.memberId;
  if (leader !== Boolean(g.leader) || r.name !== g.name) { g.leader = leader; g.name = r.name; writeSave(); }

  // 끝난 주(이번 주보다 앞)에서 내가 1위였으면 메달을 받는다. 한 주에 한 번만
  const thisWeek = guildUsage ? guildUsage.weekKey : "";
  save.weekTop = save.weekTop || [];
  let medal = false;
  for (const wk of r.weeks || []) {
    if (!thisWeek || wk.key >= thisWeek) continue;
    const top = (wk.rows || []).reduce((a, x) => (x.week > (a ? a.week : 0) ? x : a), null);
    if (top && top.id === g.memberId && !save.weekTop.some((x) => x.guild === g.code && x.week === wk.key)) {
      save.weekTop.push({ guild: g.code, week: wk.key });
      medal = true;
    }
  }
  if (medal) { writeSave(); refresh(true); }

  const url = async (dexId, shiny, kind) => {
    const p = await poke.spriteWithFallback({ dexId, isShiny: shiny }, CACHE, kind).catch(() => null);
    return p ? pathToFileURL(p).href : null;
  };
  guildCache = { members: new Map() };
  const members = await Promise.all(r.members.map(async (m) => {
    const s = m.snap || {};
    guildCache.members.set(m.id, s.team || "");
    const mons = await Promise.all((s.mons || []).map(async (x, i) => ({
      id: m.id + ":" + i,
      dexId: x.dexId, // 홀 마스코트 석상이 쓴다
      name: x.name,
      shiny: x.shiny,
      stageKey: x.stage,
      profile: { level: x.level },
      url: await url(x.dexId, x.shiny, "still"),
      animUrl: await url(x.dexId, x.shiny, "anim"),
    })));
    return {
      id: m.id,
      me: m.id === g.memberId,
      leader: m.id === r.leader,
      trainer: s.trainer,
      updated: m.updated,
      canBattle: Boolean(s.team) && m.id !== g.memberId,
      usage: s.usage || null, // 공개를 끈 사람은 null
      room: { theme: s.theme, furni: s.furni || [], statue: s.statue || null, pos: s.pos || {}, mons, dex: s.dex || { seen: 0, total: 0 }, wins: s.wins || 0, graduated: s.graduated || 0, lastGrad: s.lastGrad || "", weekTop: s.weekTop || 0 },
    };
  }));
  // 공동 목표 — 이번 주(내 PC 의 월요일)와, 끝난 주 중 가장 최근 것. 이룬 주는 한 번 알린다
  const week = thisWeek || localMonday();
  const goalCoins = r.goalCoins || [10, 20, 35];
  const lastWk = (r.weeks || []).find((wk) => wk.key < week && wk.goal);
  const lastGoal = lastWk ? { key: lastWk.key, ...lastWk.goal, coins: lastWk.goal.reached ? goalCoins[lastWk.goal.reached - 1] : 0 } : null;
  save.goalSeen = save.goalSeen || [];
  let goalNew = null;
  if (lastGoal && lastGoal.reached && !save.goalSeen.includes(g.code + ":" + lastGoal.key)) {
    save.goalSeen = [...save.goalSeen, g.code + ":" + lastGoal.key].slice(-30);
    goalNew = lastGoal;
    writeSave();
  }
  const me = r.members.find((m) => m.id === g.memberId);
  // 주간 기록 — 그 주의 1위 포켓몬 그림은 지금 길드원 카드에서 가져온다(화면이 한다)
  return {
    ok: true, code: r.code, name: r.name, max: r.max, leader, members, weeks: r.weeks || [], thisWeek: week, medal, now: r.now,
    listed: Boolean(r.listed), intro: r.intro || "",
    goal: (r.goals || {})[week] || null, goalCoins, lastGoal, goalNew,
    hall: r.hall || { funds: {}, owned: [], theme: null, donors: {} }, hallItems: HALL.items,
    walletOk: Boolean(me && me.walletOk), hasWallet: Boolean(save.wallet), coins: coinCache ? coinCache.balance : null,
  };
}

/** 내 PC 시간대의 이번 주 월요일 — weekUsage 와 같은 꼴 */
function localMonday() {
  const monday = new Date();
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return dayKey(monday);
}

/** 홀 꾸미기 모금함에 코인을 넣는다. 남은 만큼만 빠진다(서버가 정한다) */
async function hallDonate({ item, amount } = {}) {
  const g = save.guild;
  if (!g || g.gone) return { ok: false, reason: "길드에 들어가 있지 않습니다" };
  const it = HALL.items.find((x) => x.id === item);
  if (!it) return { ok: false, reason: "없는 장식입니다" };
  amount = Math.floor(Number(amount) || 0);
  if (amount < 1) return { ok: false, reason: "🪙1 이상 넣어 주세요" };
  if (coinCache && amount > coinCache.balance) {
    if (coinCache.balance < 1) return { ok: false, reason: "넣을 코인이 없습니다" };
    amount = coinCache.balance; // "직접"에 크게 적었으면 가진 만큼만
  }
  const e = await walletEnsure();
  if (!e.ok) return e;
  const r = await guildCall(`/${g.code}/hall/donate`, { memberId: g.memberId, key: g.key, walletId: save.wallet.id, walletKey: save.wallet.key, item, amount });
  if (!r.ok) { guildGone(r); return r; }
  coinCache = { balance: r.balance, at: Date.now() };
  refresh(true);
  const back = r.refunded ? ` (먼저 다 모여서 🪙${r.refunded}은 돌려받았습니다)` : "";
  if (r.done) return { ok: true, done: true, hall: r.hall, message: `🎉 ${it.name} 모금이 다 모였습니다! 홀에 놓였습니다${back}` };
  return { ok: true, hall: r.hall, message: r.used ? `${it.name}에 🪙${r.used}을 보탰습니다 (🪙${r.balance} 남음)${back}` : `이미 다 모였습니다${back}` };
}

/** 홀 배경 고르기 — 길드장만. "stone" 은 기본 돌 홀 */
async function hallTheme(theme) {
  const g = save.guild;
  if (!g || g.gone) return { ok: false, reason: "길드에 들어가 있지 않습니다" };
  const r = await guildCall(`/${g.code}/hall/theme`, { memberId: g.memberId, key: g.key, theme });
  if (!r.ok) return r;
  return { ok: true, hall: r.hall, message: "홀 배경을 바꿨습니다" };
}

/** 길드원과 결투 — 내 대표 팀 코드 vs 그 사람이 올려 둔 코드. Lv.50, 보상 없음 */
async function guildBattle(memberId) {
  const theirs = guildCache && guildCache.members.get(memberId);
  if (!theirs) return { ok: false, reason: "이 길드원은 아직 대표 포켓몬을 올리지 않았습니다" };
  const mine = guildTeamCode();
  if (!mine) return { ok: false, reason: "방에 둘 포켓몬이 없습니다(알은 싸울 수 없습니다)" };
  return friendBattle(theirs, { team: mine });
}

/* ---------------- 코인 지갑 · 상점에 팔기 · 길드 몰 (server/src/wallet.js · market.js) ----------------
   코인(🪙)은 서버가 잔액을 들고 있다 — 여기서는 지갑 번호와 열쇠만 세이브에 둔다(save.wallet).
   길드 몰은 포켓몬을 서버에 맡겨서 판다. 맡기면 박스에서 빠지고, 팔리면 산 사람에게 간다.
   취소·만료·내보내짐이면 돌려받는다. 상점에 팔기는 사람 대신 상점이 바로 사 준다(박스 정리). */

const walletCall = (path, body) => serverCall("/wallet" + path, body);

/** 지갑이 없으면 만든다. 처음 지원금은 없다 — 지갑만 만들어 코인을 모으지 못하게(wallet.js) */
async function walletEnsure() {
  if (save.wallet && save.wallet.id) return { ok: true, wallet: save.wallet };
  const r = await walletCall("", {});
  if (!r.ok) return r;
  save.wallet = { id: r.walletId, key: r.key };
  writeSave();
  return { ok: true, wallet: save.wallet, created: true };
}

async function walletInfo() {
  const e = await walletEnsure();
  if (!e.ok) return e;
  const r = await walletCall("/" + save.wallet.id, { key: save.wallet.key });
  if (!r.ok) return r;
  decoFrom(r);
  const today = dayKey(new Date());
  return {
    ok: true,
    id: save.wallet.id,
    created: Boolean(e.created),
    balance: r.balance,
    canBuyAt: r.canBuyAt || 0, // 새 지갑은 이틀 뒤부터 몰에서 산다
    checkedIn: r.checkin === today,
    exLeft: r.exDay === today ? r.exLeft : 5,
    sellLeft: r.sellDay === today ? r.sellLeft : 10,
    sellCoinsLeft: r.sellDay === today ? r.sellCoinsLeft : 100,
    cbLeft: r.cbDay === today ? r.cbLeft : 5, // 코인 → 사탕 오늘 남은 개수
    candyCoins: r.candyCoins || 20, // 사탕 하나 값(🪙)
    log: r.log || [],
    candy: candy().left,
  };
}

async function walletCheckin() {
  const e = await walletEnsure();
  if (!e.ok) return e;
  const r = await walletCall(`/${save.wallet.id}/checkin`, { key: save.wallet.key, day: dayKey(new Date()) });
  return r.ok ? { ok: true, message: `출석 코인 🪙${r.got}을 받았습니다 (🪙${r.balance})` } : r;
}

/** 사탕 → 코인. 사탕은 내 세이브에서 빠진다(서버는 확인할 수 없어 하루 한도로 묶는다) */
async function walletExchange(n) {
  n = Math.floor(Number(n) || 0);
  if (n < 1 || n > 5) return { ok: false, reason: "환전은 한 번에 사탕 1~5개입니다" };
  if (candy().left < n) return { ok: false, reason: "사탕이 모자랍니다" };
  const e = await walletEnsure();
  if (!e.ok) return e;
  const r = await walletCall(`/${save.wallet.id}/exchange`, { key: save.wallet.key, day: dayKey(new Date()), n });
  if (!r.ok) return r;
  save.candySpent = (save.candySpent ?? 0) + n;
  writeSave();
  refresh(true);
  pushShop();
  return { ok: true, message: `🍬${n} → 🪙${r.got} 환전했습니다 (🪙${r.balance})` };
}

/**
 * 코인 → 사탕. 코인은 서버 지갑에서 빠지고(서버가 값 · 하루 한도를 정한다), 사탕은 내 세이브에
 * 보너스로 더한다(candyBonus — 졸업 보상과 같은 칸)
 */
async function walletBuyCandy(n) {
  n = Math.floor(Number(n) || 0);
  if (n < 1 || n > 5) return { ok: false, reason: "사탕은 한 번에 1~5개까지 삽니다" };
  const e = await walletEnsure();
  if (!e.ok) return e;
  const r = await walletCall(`/${save.wallet.id}/candy`, { key: save.wallet.key, day: dayKey(new Date()), n });
  if (!r.ok) return r;
  save.candyBonus = (save.candyBonus ?? 0) + r.got;
  coinCache = { balance: r.balance, at: Date.now() };
  writeSave();
  refresh(true);
  pushShop();
  return { ok: true, message: `🪙${r.paid} → 🍬${r.got} 샀습니다 (🍬${candy().left} · 🪙${r.balance})` };
}

/** 박스에서 뺀다 — 팔거나 몰에 맡길 때. 키우던 아이·펫·방에서도 정리한다 */
function removeMon(id) {
  save.box = save.box.filter((x) => x.id !== id);
  save.petIds = (save.petIds || []).filter((x) => x !== id);
  if (save.activeId === id) save.activeId = save.box[0].id; // 키우던 아이가 빠지면 다른 아이가 자란다
  destroyPet(id);
  writeSave();
  syncPets();
  refresh(true);
  pushDex();
}

/** 팔거나 맡길 수 있나 — 알과 마지막 한 마리는 안 된다 */
function sellable(id) {
  const m = box.find(save.box, id);
  if (!m) return { ok: false, reason: "없는 아이입니다" };
  if (save.box.length <= 1) return { ok: false, reason: "마지막 한 마리는 팔 수 없습니다" };
  if (isEggMon(m)) return { ok: false, reason: "알은 팔 수 없습니다" };
  return { ok: true, m };
}

/** 상점에 판다. 값은 서버가 다시 센다(pokemon.shopPrice 는 화면에 보일 값) */
async function shopSell(id) {
  const c = sellable(id);
  if (!c.ok) return c;
  const m = c.m;
  const grown = box.effOf(m, growthSpeed());
  const name = poke.describe(grown, m.line, { shiny: m.shiny }).name;
  const e = await walletEnsure();
  if (!e.ok) return e;
  const r = await walletCall(`/${save.wallet.id}/sell`, { key: save.wallet.key, day: dayKey(new Date()), mon: { line: m.line, grown: Math.round(grown), shiny: Boolean(m.shiny) } });
  if (!r.ok) return r;
  if (m.hold === "everstone") save.items = { ...(save.items || {}), everstone: stoneCount() + 1 }; // 돌은 가방으로
  removeMon(id);
  return { ok: true, message: `${battle.josa(name, "을를")} 상점에 팔았습니다 +🪙${r.got}${r.got < r.price ? " (오늘 한도까지)" : ""}` };
}

/** 몰에 올릴 내용 — 교환 코드와 같다. 변하지않는돌을 지녔으면 레벨용 성장량도 */
function monPayload(m) {
  const grown = box.effOf(m, growthSpeed());
  const lv = box.withLv(m, growthSpeed()).lvGrown;
  return {
    line: m.line, nature: m.nature ?? 0, shiny: Boolean(m.shiny), ivs: m.ivs, gender: m.gender, ability: m.ability ?? 0,
    eggMoves: m.eggMoves || [], tmMoves: m.tmMoves || [], grown: Math.round(grown), lvGrown: lv > grown ? Math.round(lv) : null,
    hold: m.hold === "everstone", ot: m.ot || save.trainerName || "", caughtAt: m.caughtAt || null,
  };
}

/**
 * 몰에서 산(또는 돌려받은) 아이를 박스에 넣는다. 산 아이는 교환 진화 — 원작에서 교환으로 진화하는
 * 아이는 사는 순간 진화한다(교환 대신 몰이 그 자리를 맡는다). 돌려받을 때는 진화하지 않는다.
 */
function addMon(p, { evolve = false } = {}) {
  let grown = p.grown;
  const evo = evolve && !p.hold ? tradeEvolves(p.line, grown) : -1;
  const before = poke.describe(grown, p.line, { shiny: p.shiny }).name;
  if (evo >= 0) grown = Math.max(grown, poke.STAGES[evo + 1].at);
  const st = poke.stageFor(grown);
  const m = {
    id: box.newId(),
    line: p.line, nature: p.nature, shiny: Boolean(p.shiny), ivs: p.ivs, gender: p.gender, ability: p.ability,
    eggMoves: p.eggMoves || [], tmMoves: p.tmMoves || [],
    raw: 0, bonus: 0, boost: 0, fed: grown, maxStage: st,
    caughtAt: p.caughtAt || new Date().toISOString().slice(0, 10), graduatedAt: null,
    ot: p.ot || "", traded: evolve ? new Date().toISOString().slice(0, 10) : undefined,
  };
  if (p.hold) {
    const cap = poke.stoneCap(m.line, grown);
    if (cap != null) Object.assign(m, { hold: "everstone", holdCap: cap, fed: Math.max(grown, p.lvGrown || 0) });
    else save.items = { ...(save.items || {}), everstone: stoneCount() + 1 };
  }
  save.box.push(m);
  if (!save.seen.includes(m.line)) save.seen.push(m.line);
  save.maxStage[m.line] = Math.max(save.maxStage[m.line] ?? -1, st);
  writeSave();
  refresh(true);
  pushDex();
  const after = poke.describe(grown, m.line, { shiny: m.shiny }).name;
  if (evo >= 0 && save.notifyEnabled && Notification.isSupported()) {
    new Notification({ title: `${battle.josa(before, "이가")} 진화했다!`, body: `몰에서 데려오자 ${after}(으)로 진화했습니다`, silent: false }).show();
  }
  return { name: after, before, evolved: evo >= 0 };
}

const mallReady = () => {
  if (!onlineCfg().enabled) return { ok: false, reason: "설정 › 온라인 기능을 켜야 몰을 쓸 수 있습니다", offline: true };
  if (!save.guild || save.guild.gone) return { ok: false, reason: "길드에 들어가야 길드 몰을 쓸 수 있습니다", noGuild: true };
  return { ok: true };
};
const auth = () => ({ memberId: save.guild.memberId, key: save.guild.key, walletId: save.wallet.id, walletKey: save.wallet.key });

/** 몰 보기 — 매물마다 그림·레벨·개체값·성격·특성을 붙이고, 사기 전에 말이 되는 값인지 본다 */
async function marketView() {
  const ready = mallReady();
  if (!ready.ok) return ready;
  const e = await walletEnsure();
  if (!e.ok) return e;
  const r = await guildCall(`/${save.guild.code}/market`);
  if (!r.ok) return r;
  const url = async (d, kind) => {
    const p = await poke.spriteWithFallback(d, CACHE, kind).catch(() => null);
    return p ? pathToFileURL(p).href : null;
  };
  // 내 매물 중 만료됐거나 내보내져서 돌려받을 것은 저절로 돌려받는다
  for (const l of r.listings) {
    if (l.wallet === save.wallet.id && (l.expired || l.state === "returned")) await marketCancel(l.id, true);
  }
  const live = r.listings.filter((l) => !(l.wallet === save.wallet.id && (l.expired || l.state === "returned")));
  const listings = await Promise.all(live.map(async (l) => {
    const mon = l.mon;
    const d = poke.describe(mon.grown, mon.line, { shiny: mon.shiny });
    const p = profile.build({ ...mon, lvGrown: mon.lvGrown || undefined }, mon.grown);
    const bad = friend.validate(mon, mon.grown);
    const rr = poke.rarityOf(mon.line);
    return {
      id: l.id, price: l.price, seller: l.trainer, mine: l.wallet === save.wallet.id, state: l.state, expired: l.expired, expires: l.expires,
      name: d.name, stage: d.stage.label, stageKey: d.stage.key, shiny: d.isShiny, stars: rr.stars, rarity: rr.label, legendary: Boolean((poke.LINES[mon.line] || {}).legendary),
      level: p ? p.level : null, ivTotal: p ? p.ivTotal : null, types: p ? p.types : [], typeKeys: p ? p.typeKeys : [],
      nature: (poke.NATURES[mon.nature] || {}).name || "", ability: p ? p.ability : "", passives: p ? p.eggMoves.map((x) => x.name) : [],
      hold: mon.hold, ot: mon.ot, evolvesTo: !mon.hold && tradeEvolves(mon.line, mon.grown) >= 0 ? poke.LINES[mon.line].names[tradeEvolves(mon.line, mon.grown) + 1] : null,
      valid: !bad, invalidWhy: bad || null,
      url: await url(d, "still"), animUrl: await url(d, "anim"),
    };
  }));
  const sales = (r.sales || []).slice(0, 15).map((s) => ({ ...s, name: poke.describe(s.grown, s.line, { shiny: s.shiny }).name }));
  return { ok: true, listings, sales, fee: r.fee, max: r.max };
}

async function marketList({ id, price } = {}) {
  const ready = mallReady();
  if (!ready.ok) return ready;
  const c = sellable(id);
  if (!c.ok) return c;
  price = Math.floor(Number(price) || 0);
  if (price < 1 || price > 9999) return { ok: false, reason: "가격은 🪙1~9999 입니다" };
  const e = await walletEnsure();
  if (!e.ok) return e;
  const m = c.m;
  const name = poke.describe(box.effOf(m, growthSpeed()), m.line, { shiny: m.shiny }).name;
  const r = await guildCall(`/${save.guild.code}/market/list`, { ...auth(), mon: monPayload(m), price });
  if (!r.ok) return r;
  removeMon(id); // 서버가 맡았다
  return { ok: true, message: `${battle.josa(name, "을를")} 🪙${price}에 올렸습니다. 7일 안에 안 팔리면 돌아옵니다` };
}

async function marketBuy(listingId) {
  const ready = mallReady();
  if (!ready.ok) return ready;
  const e = await walletEnsure();
  if (!e.ok) return e;
  const r = await guildCall(`/${save.guild.code}/market/buy`, { ...auth(), listingId });
  if (!r.ok) return r;
  const got = addMon(r.mon, { evolve: true });
  return { ok: true, message: got.evolved ? `${got.before}을(를) 데려오자 ${got.name}(으)로 진화했다! (🪙${r.balance})` : `${battle.josa(got.name, "을를")} 🪙${r.price}에 샀습니다 (🪙${r.balance})` };
}

/** 내 매물을 돌려받는다 — 취소 · 만료 · 내보내짐 */
async function marketCancel(listingId, quiet = false) {
  if (!save.guild || !save.wallet) return { ok: false, reason: "길드와 지갑이 있어야 합니다" };
  const r = await guildCall(`/${save.guild.code}/market/cancel`, { walletId: save.wallet.id, walletKey: save.wallet.key, listingId });
  if (!r.ok) return r;
  const got = addMon(r.mon);
  return { ok: true, message: quiet ? "" : `${battle.josa(got.name, "을를")} 돌려받았습니다` };
}

/** 길드를 떠나기 전에 맡겨 둔 아이를 모두 돌려받는다 */
async function marketReclaimAll() {
  if (!save.guild || !save.wallet || !onlineCfg().enabled) return;
  const r = await guildCall(`/${save.guild.code}/market`);
  if (!r.ok) return;
  for (const l of r.listings || []) if (l.wallet === save.wallet.id) await marketCancel(l.id, true);
}

/* ---------------- 버닝타임 (burning.js) ---------------- */

const burnCfg = () => burning.normalize(save.burning);
let burnWasOn = null; // 켜지는 순간에만 알린다. 앱을 켠 첫 갱신은 알리지 않는다

function notifyBurning(st) {
  const was = burnWasOn;
  burnWasOn = st.on;
  if (was !== false || !st.on || !save.notifyEnabled || !Notification.isSupported()) return;
  const end = st.until ? new Date(st.until) : null;
  new Notification({
    title: `🔥 버닝타임 시작 — 성장 ×${st.mult}`,
    body: end ? `${end.getHours()}시${end.getMinutes() ? " " + end.getMinutes() + "분" : ""}까지 쓰는 토큰은 ${st.mult}배로 자랍니다` : `지금 쓰는 토큰은 ${st.mult}배로 자랍니다`,
    silent: false,
  }).show();
}

/* ---------------- 미니룸 (room.js) ---------------- */

const isEggMon = (m) => !poke.stageFor(box.effOf(m, growthSpeed()));
const roomPrice = (cost) => (cost ? priceOf(cost) : 0);

/** 화면에 넘길 방 — 가진 것·놓은 것·둘 아이와 기록 장식에 쓸 숫자 */
function roomState() {
  room.normalize(save);
  const r = save.room;
  return {
    theme: r.theme,
    themes: [
      ...room.THEMES.map((t) => ({ ...t, cost: roomPrice(t.cost), owned: r.themes.includes(t.id) })),
      ...room.COIN_THEMES.map((t) => ({ ...t, coin: true, cost: t.coins, owned: r.coin.includes(t.id) })),
    ],
    furni: [
      ...room.FURNI.map((f) => ({ ...f, cost: roomPrice(f.cost), owned: r.owned.includes(f.id), on: r.owned.includes(f.id) && !r.off.includes(f.id) })),
      ...room.COIN_FURNI.map((f) => ({ ...f, coin: true, cost: f.coins, owned: r.coin.includes(f.id), on: r.coin.includes(f.id) && !r.off.includes(f.id) })),
    ],
    // 코인 꾸미기 — 잔액은 서버가 들고 있어 마지막으로 받아 둔 값을 보인다(방 탭을 열 때 다시 받는다)
    coins: coinCache ? coinCache.balance : null,
    online: onlineCfg().enabled,
    hasLegend: hasLegend(),
    statue: statueDex(), // 전설 석상에 깎을 전설(도감 번호)
    pos: r.pos, // 끌어 옮긴 가구 자리
    tags: r.tags, // 이름표 늘 보이기
    mons: room.monsIn(save, isEggMon),
    max: room.MAX_MONS,
    // 기록 장식 — 졸업 트로피(마지막 졸업생 이름), 결투 배지(친선 + 박스 결투 승수)
    graduated: (save.graduated || []).length,
    lastGrad: ((save.graduated || []).slice(-1)[0] || {}).name || null,
    wins: ((save.friendRecord || {}).w || 0) + (save.box || []).reduce((a, m) => a + ((m.record || {}).w || 0), 0),
    weekTop: (save.weekTop || []).length, // 길드 주간 1위 메달
  };
}

/** 배경·가구를 산다. 사탕은 상점과 같은 지갑에서 나간다. 코인 꾸미기는 코인 지갑으로(coinBuy) */
function roomBuy(kind, id) {
  if (room.isCoin(id)) return coinBuy(kind, id);
  room.normalize(save);
  const r = save.room;
  const list = kind === "theme" ? room.THEMES : room.FURNI;
  const it = list.find((x) => x.id === id);
  if (!it) return { ok: false, reason: "없는 물건입니다" };
  const have = kind === "theme" ? r.themes : r.owned;
  if (have.includes(id)) return { ok: false, reason: "이미 가지고 있습니다" };
  const cost = roomPrice(it.cost);
  if (candy().left < cost) return { ok: false, reason: "사탕이 모자랍니다" };
  save.candySpent = (save.candySpent ?? 0) + cost;
  have.push(id);
  if (kind === "theme") r.theme = id; // 산 배경은 바로 바른다
  writeSave();
  refresh(true);
  pushShop();
  return { ok: true, message: kind === "theme" ? `${it.name} 배경으로 바꿨습니다` : `${battle.josa(it.name, "을를")} 방에 놓았습니다` };
}

/* ---- 코인 꾸미기 (server/src/wallet.js buy) ----
   코인으로만 사는 배경·가구. 산 것은 서버 지갑이 기억하고 세이브(room.coin)에는 받아 둔 목록만
   있다 — 꺼져 있을 때도 방을 그리려고. 지갑을 볼 때마다(상점 탭 · 방 탭) 서버 목록으로 맞춘다. */

let coinCache = null; // { balance, at } — 방 탭에 보일 코인

/** 전설 석상은 전설이 있어야 산다 — 내가 가진 전설의 모습으로 깎인다 */
const hasLegend = () => save.box.some((m) => !isEggMon(m) && (poke.LINES[m.line] || {}).legendary);

/** 전설 석상의 모델 — 방에 둔 전설이 있으면 그 아이, 없으면 가장 많이 자란 전설 */
function statueDex() {
  const legends = save.box.filter((m) => !isEggMon(m) && (poke.LINES[m.line] || {}).legendary);
  if (!legends.length) return null;
  const inRoom = room.monsIn(save, isEggMon);
  const m = legends.find((x) => inRoom.includes(x.id)) || legends.reduce((a, x) => (box.effOf(x, growthSpeed()) > box.effOf(a, growthSpeed()) ? x : a));
  return poke.describe(box.effOf(m, growthSpeed()), m.line).dexId;
}

/** 석상 그림 — 화면이 캔버스로 읽어 돌 색으로 바꾼다. file: 그림은 캔버스로 못 읽어서 data: 로 준다 */
const statueImages = new Map();
async function statueImage(dexId) {
  dexId = Number(dexId);
  if (!Number.isInteger(dexId) || dexId < 1 || dexId > 1100) return null;
  if (!statueImages.has(dexId)) {
    statueImages.set(dexId, (async () => {
      const p = await poke.spriteWithFallback({ dexId, isShiny: false }, CACHE, "still").catch(() => null);
      return p ? "data:image/png;base64," + fs.readFileSync(p).toString("base64") : null;
    })());
  }
  const v = await statueImages.get(dexId);
  if (!v) statueImages.delete(dexId); // 못 받았으면 다음에 다시
  return v;
}

/** 지갑이 알려 준 잔액 · 산 목록을 받아 둔다. 서버 목록이 맞다 */
function decoFrom(r) {
  coinCache = { balance: r.balance, at: Date.now() };
  room.normalize(save);
  const next = (r.deco || []).filter(room.isCoin);
  if (JSON.stringify(next) !== JSON.stringify(save.room.coin)) {
    save.room.coin = next;
    room.normalize(save); // 없어진 배경을 바르고 있었으면 오두막으로
    writeSave();
  }
}

/** 방 탭을 열 때 — 지갑이 있으면 잔액 · 산 목록을 다시 받는다. 지갑을 새로 만들지는 않는다 */
async function roomCoins() {
  if (!onlineCfg().enabled || !save.wallet || !save.wallet.id) return { ok: true };
  const r = await walletCall("/" + save.wallet.id, { key: save.wallet.key });
  if (!r.ok) return r;
  decoFrom(r);
  refresh(true);
  return { ok: true };
}

async function coinBuy(kind, id) {
  const it = (kind === "theme" ? room.COIN_THEMES : room.COIN_FURNI).find((x) => x.id === id);
  if (!it) return { ok: false, reason: "없는 물건입니다" };
  room.normalize(save);
  if (save.room.coin.includes(id)) return { ok: false, reason: "이미 가지고 있습니다" };
  if (it.needs === "legend" && !hasLegend()) return { ok: false, reason: "전설의 포켓몬이 있어야 살 수 있습니다 — 석상은 내가 가진 전설의 모습으로 깎입니다" };
  const e = await walletEnsure();
  if (!e.ok) return e;
  const r = await walletCall(`/${save.wallet.id}/buy`, { key: save.wallet.key, item: id });
  if (!r.ok) {
    if (r.status === 409) await roomCoins(); // 다른 PC 에서 이미 샀다 — 목록을 맞춘다
    return r;
  }
  decoFrom(r);
  if (kind === "theme") save.room.theme = id; // 산 배경은 바로 바른다
  writeSave();
  refresh(true);
  return { ok: true, message: `${kind === "theme" ? `${it.name} 배경으로 바꿨습니다` : `${battle.josa(it.name, "을를")} 방에 놓았습니다`} (🪙${r.balance} 남음)` };
}

/** 배경 바꾸기 · 가구 놓기/치우기 · 둘 아이 고르기 */
function roomSet(patch = {}) {
  room.normalize(save);
  const r = save.room;
  if (patch.theme != null) {
    if (!r.themes.includes(patch.theme) && !r.coin.includes(patch.theme)) return { ok: false, reason: "아직 없는 배경입니다" };
    r.theme = patch.theme;
  }
  if (patch.toggle != null) {
    if (!r.owned.includes(patch.toggle) && !r.coin.includes(patch.toggle)) return { ok: false, reason: "아직 없는 가구입니다" };
    r.off = r.off.includes(patch.toggle) ? r.off.filter((x) => x !== patch.toggle) : [...r.off, patch.toggle];
  }
  // 가구 옮기기 — { id, x, y } 그림 좌표. 가진 가구만. reset 이면 모두 처음 자리로
  if (patch.pos) {
    const { id, x, y } = patch.pos;
    if (!room.MOVABLE.includes(id) || !(r.owned.includes(id) || r.coin.includes(id))) return { ok: false, reason: "옮길 수 없는 가구입니다" };
    if (!room.okPos([x, y])) return { ok: false, reason: "자리가 올바르지 않습니다" };
    r.pos = { ...r.pos, [id]: [x, y] };
  }
  if (patch.posReset) r.pos = {};
  if (patch.tags != null) r.tags = Boolean(patch.tags);
  if (Array.isArray(patch.mons)) {
    const ok = (id) => { const m = box.find(save.box, id); return m && !isEggMon(m); };
    r.mons = [...new Set(patch.mons.map(String))].filter(ok).slice(0, room.MAX_MONS);
  }
  writeSave();
  refresh(true);
  return { ok: true };
}

/* ---------------- 변하지않는돌 ---------------- */

const stoneCount = () => (save.items && save.items.everstone) || 0;

/**
 * 지니게 하거나 뺀다. 지니는 순간 "다음 진화 바로 앞"(pokemon.stoneCap)을 holdCap 으로
 * 적어 두고 성장을 거기서 멈춘다(box.effOf). 빼면 돌이 가방으로 돌아오고, 그동안 쌓인
 * 토큰만큼 바로 자란다 — 진화 알림은 평소처럼 refresh 가 띄운다.
 */
function toggleStone(id) {
  const m = box.find(save.box, id);
  if (!m) return { ok: false, reason: "없는 아이입니다" };
  save.items = save.items || {};
  const name = poke.describe(box.effOf(m, growthSpeed()), m.line, { shiny: m.shiny }).name;

  if (m.hold === "everstone") {
    m.hold = null;
    m.holdCap = null;
    save.items.everstone = stoneCount() + 1;
    const after = poke.describe(box.effOf(m, growthSpeed()), m.line, { shiny: m.shiny }).name;
    writeSave();
    refresh(true);
    pushShop();
    return { ok: true, message: after !== name ? `변하지않는돌을 뺐다 — ${battle.josa(name, "이가")} ${after}(으)로 진화했다!` : `${name}에게서 변하지않는돌을 뺐습니다` };
  }

  if (!stoneCount()) return { ok: false, reason: "변하지않는돌이 없습니다. 상점에서 살 수 있습니다" };
  const eff = box.effOf(m, growthSpeed());
  if (!poke.stageFor(eff)) return { ok: false, reason: "알에게는 지니게 할 수 없습니다" };
  const cap = poke.stoneCap(m.line, eff);
  if (cap == null) return { ok: false, reason: `${battle.josa(name, "은는")} 더 진화하지 않는 모습이라 돌이 필요 없습니다` };
  m.hold = "everstone";
  m.holdCap = cap;
  save.items.everstone = stoneCount() - 1;
  writeSave();
  refresh(true);
  pushShop();
  return { ok: true, message: `${battle.josa(name, "이가")} 변하지않는돌을 지녔다. 이제 진화하지 않습니다` };
}

const SHOP = [
  { id: "egg", name: "포켓몬 알", cost: 2, desc: "평범한 알. 박스에 한 마리 늘어난다", icon: "🥚" },
  { id: "egg-super", name: "슈퍼 알", cost: 7, desc: "★3 이상 확정", icon: "🥚" },
  { id: "egg-legend", name: "희귀 알", cost: 18, desc: "★4 이상 확정. 진짜 전설은 알에서 안 나오고 야생에서만 만난다", icon: "🥚" },
  { id: "rare-candy", name: "이상한사탕", cost: 1, desc: "키우는 아이를 1000만 만큼 자라게 한다", icon: "🍬" },
  { id: "mint", name: "민트", cost: 2, desc: "성격만 다시 뽑는다. 키우던 건 그대로", icon: "🌿" },
  { id: "everstone", name: "변하지않는돌", cost: 3, desc: "지닌 아이는 진화하지 않는다. 박스 › 상세에서 지니게 하거나 뺀다. 빼면 돌아온다", icon: "🪨" },
  { id: "tm", name: "기술머신", cost: 3, desc: "키우는 아이가 배울 수 있는 기술머신 기술 하나를 가르친다", icon: "💿" },
  { id: "great-ball", name: "슈퍼볼 3개", cost: 1, desc: "야생 포켓몬이 1.5배 잘 잡힌다", icon: "🔵", ball: "great" },
  { id: "ultra-ball", name: "하이퍼볼 3개", cost: 2, desc: "야생 포켓몬이 2배 잘 잡힌다", icon: "🟡", ball: "ultra" },
  { id: "master-ball", name: "마스터볼", cost: 40, desc: "던지면 반드시 잡힌다. 전설도. 한 주에 1개만 살 수 있다", icon: "🟣", ball: "master", weekly: true },
  { id: "charm", name: "반짝이는 부적", cost: 60, desc: "이로치 확률 2배. 한 번만 살 수 있다", icon: "✨", once: true },
];

let save = {
  /**
   * 박스 — 보유한 아이들. box.js 참고.
   *
   * activeId 가 "키우는 중"이고, 늘어난 토큰은 그 아이에게만 적립된다.
   * petIds 는 바탕화면에 띄운 아이들 (여러 마리 가능).
   */
  box: [],
  activeId: null,
  petIds: [],
  lastTotal: undefined, // 성장 적립의 기준점. undefined면 이번엔 적립하지 않는다

  /* ---- 아래는 0.1.x 세이브를 읽기 위한 것. 옮긴 뒤에는 쓰지 않는다 ---- */
  lineIndex: null, // null이면 아직 안 뽑은 것. 첫 실행에 뽑는다
  natureIndex: null,
  /**
   * 이 개체를 받은 시점의 누적 토큰.
   *
   * 성장은 (누적 - bornAt)으로 잰다. 누적 전체로 재면 뭘 뽑든
   * 곧바로 최종 진화라서, 키우는 게임인데 키우는 과정이 없어진다.
   */
  bornAt: 0,
  candySpent: 0, // 지금까지 쓴 사탕
  candyBonus: 0, // 졸업·한도 달성으로 받은 보너스 사탕
  charm: false, // 반짝이는 부적 보유
  shiny: false, // 지금 키우는 개체가 이로치인가
  seen: [], // 한 번이라도 받아본 라인 (도감 진행도)
  /**
   * 라인별로 실제 도달한 최고 단계. { lineIndex: stageIndex }
   *
   * 이게 없으면 도감이 최종 진화 모습만 보여준다 —
   * 아직 파비코인데 도감엔 파비코리로 뜨는 문제가 생긴다.
   * 안 키운 모습을 가진 것처럼 보여주면 도감이 거짓말을 한다.
   */
  maxStage: {},
  graduated: [], // 마스터까지 키운 개체들
  graduatedAt: null, // 마지막으로 졸업 처리한 개체의 bornAt (중복 기록 방지)
  /**
   * 바탕화면 펫으로 띄울 라인. null이면 지금 키우는 개체를 따라간다.
   *
   * 키우는 건 한 마리뿐이지만, 도감에 있는 아이를 대표로 세워두고
   * 싶을 수 있다. 키우는 개체와 보이는 개체를 분리한다.
   */
  petLine: null,
  petVisible: false,
  petPos: null,
  wanderLevel: "rare",
  /**
   * 펫이 기술을 쓰는 빈도. "off" | "rare" | "often"
   * 언제 쓰는지는 펫 창이 정한다 (renderer/pet.js). 여기선 얼마나 자주인지만.
   */
  moveLevel: "rare",

  /* ---- 설정 ---- */
  /**
   * 난이도. 둘 다 100%가 기본이다.
   *   growthPct  성장 속도. 200%면 같은 토큰으로 두 배 빨리 자란다
   *   pricePct   상점 가격에 곱한다
   */
  /**
   * 직접 적어 넣은 한도(토큰). { claude: {block, week}, codex: {...} }
   *
   * Claude의 공식 한도는 로컬 어디에도 없다 — 로그에도, 캐시에도.
   * 그래서 지어내는 대신 사용자가 아는 값을 받는다. 비워 두면 %를 내지 않고
   * 쓴 양만 보여준다.
   */
  limits: {},
  /**
   * 결투 보상으로 받은 나무열매. { "figy-berry": 2, ... }
   * battleDay/battleRewards 는 하루 보상 횟수를 센다 (BATTLE_REWARDS_PER_DAY).
   */
  berries: {},
  /** 가방의 도구. { everstone: 1 } — 지니게 하면 줄고, 빼면 돌아온다 */
  items: {},
  battleDay: null,
  battleRewards: 0,
  /**
   * 야생 포켓몬이 나오는 빈도. "off" | "rare" | "often" (wild.js PACE)
   * wildDay/wildCount 는 오늘 몇 번 나왔나 — 하루 상한을 센다.
   */
  wildLevel: "rare",
  wildDay: null,
  wildCount: 0,
  /**
   * 친선 배틀. friendTeam 은 등록해 둔 내 팀 코드 — 친구에게 보낸 바로 그 코드로 싸워야
   * 두 PC에서 같은 결투가 나온다. 등록한 뒤에 아이가 자라도 코드는 그대로다.
   */
  trainerName: "",
  friendTeam: null, // { code, monId, at }
  friendRecord: { w: 0, l: 0, d: 0 },
  /**
   * 교환. tradeSent 는 보낸 코드(잃어버리면 다시 복사할 수 있게 최근 몇 개),
   * tradeReceived 는 받은 코드의 nonce — 같은 코드를 두 번 받지 못하게 한다.
   */
  tradeSent: [],
  tradeReceived: [],
  /**
   * 온라인 기능(실시간 배틀). 이 앱이 처음으로 밖으로 무언가를 보내는 기능이라 기본은 꺼짐.
   * 켜면 결투 탭의 실시간 배틀이 중계 서버(server/)에 붙는다. 보내는 건 팀 코드와 이름뿐 —
   * 토큰 기록은 보내지 않는다. relay 가 비어 있으면 DEFAULT_RELAY 를 쓴다.
   */
  online: { enabled: false, relay: "" },
  /** 방해 금지 시간. 이 사이에는 저절로 나오지 않는다 (wild.js inQuiet) */
  wildQuiet: { enabled: false, from: 22, to: 8 },
  /**
   * 들어가 있는 길드. { code, name, memberId, key, leader } — key 는 서버가 준 내 칸 열쇠.
   * 내보내졌거나 길드가 없어졌으면 gone 에 이유가 남는다(화면이 알려 주고 지운다).
   */
  guild: null,
  /** 길드 순위에 내 토큰 합계(이번 주·오늘)를 공개하나. 끄면 순위에 "비공개"로 나온다 */
  guildShare: true,
  /** 코인 지갑 { id, key } — 잔액은 서버에 있다(server/src/wallet.js). 열쇠를 잃으면 지갑도 잃는다 */
  wallet: null,
  /** 길드 주간 1위를 한 주들. [{ guild, week }] — 방에 메달 액자로 걸린다 */
  weekTop: [],
  /** 버닝타임 — 정해 둔 시간에 쓴 토큰은 성장 몇 배 (burning.js). 없으면 기본(코어 10~16 · 야근 18~0, 4배) */
  burning: null,
  /** 상점에서 산 볼. 몬스터볼은 출현마다 공짜로 주니 여기 없다 */
  balls: { great: 0, ultra: 0 },
  /**
   * 사용자가 더해 준 경로.
   *
   * 기본 경로를 대체하지 않고 앞에 끼워 넣는다 — "여기도 봐 줘"이지
   * "여기만 봐"가 아니다. 잘못 지정했을 때 멀쩡히 읽히던 게 통째로
   * 사라지는 쪽이 더 나쁘다.
   *
   *   logs   { claude: [폴더...], codex: [폴더...] }
   *   quota  { claude: 파일, codex: 파일 }
   */
  logRoots: { claude: [], codex: [] },
  quotaFiles: {},
  growthPct: 100,
  pricePct: 100,
  notifyEnabled: true,
  warnPercent: 80, // Codex 주간 한도 경고 기준
  /**
   * 트레이 아이콘. "logo" | "mon"
   *
   * 기본은 로고다. 알림 영역에는 앱이 스무 개쯤 모여 있고, 16px로 줄인
   * 포켓몬 스프라이트는 뭉개져서 어느 앱인지 알아볼 수가 없다.
   * 현재 포켓몬을 보고 싶으면 "mon"으로 바꾼다.
   */
  trayIcon: "logo",
  petSize: 128,
  /** 팝오버 창 크기. 테두리를 끌어 바꾸면 기억한다. null 이면 기본(400 × 화면에 맞는 높이) */
  popSize: null,
  pollMinutes: 0.5, // 갱신 주기(분). 0.5 = 30초
  autoLaunch: false,
};

let hadSave = false; // 세이브 파일이 원래 있었는가 (첫 실행 vs 이전 버전 이어받기)
/*
 * 읽어들인 순간의 원문.
 *
 * 기동 중에 세이브는 여러 번 다시 쓰인다(이전 버전 이어받기·프로필 채우기·
 * 토큰 적립). 그래서 나중에 "원본을 남겨 두자"며 파일을 복사하면 이미 우리가
 * 손댄 뒤의 것이 남는다. 사용자가 켜기 전에 뭐가 있었는지는 여기에만 있다.
 */
let rawAtLoad = null;

/**
 * 세이브를 못 읽었는가. "파일이 없다"와는 다른 뜻이다.
 *
 * 이게 참이면 아무것도 새로 만들지 않고 아무것도 쓰지 않는다 —
 * 읽지 못한 것을 첫 실행으로 오해하면 멀쩡한 진행 위에 새 알을 깐다.
 */
let loadFailed = false;

function loadSave() {
  let raw = null;
  try {
    // BOM이 붙은 파일(PowerShell 등 다른 도구가 쓴 경우)에서 JSON.parse가 터진다.
    // 그러면 설정이 통째로 기본값으로 떨어지는데, 오류도 안 나서 원인을 찾기 어렵다.
    raw = fs.readFileSync(SAVE, "utf8");
  } catch (e) {
    /*
     * 파일이 없으면 진짜 첫 실행이다. 그 외(잠김·권한·설치 중 교체)는 다르다.
     *
     * 예전에는 둘을 같이 삼켰다. 설치 관리자가 파일을 바꾸는 중에 앱이 떠서
     * 못 읽자 첫 실행으로 보고 알을 하나 깠고, 화면에는 없던 포켓몬 한 마리가,
     * 디스크에는 원래 박스가 남아 서로 다른 말을 했다.
     */
    if (e.code !== "ENOENT") {
      loadFailed = true;
      console.error("[save] 읽지 못했습니다 (" + e.code + "). 이번 실행에서는 아무것도 저장하지 않습니다.");
    }
  }

  if (raw !== null) {
    try {
      const clean = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
      const loaded = JSON.parse(clean);
      hadSave = true;
      rawAtLoad = raw;
      save = { ...save, ...loaded };
      // bornAt이 없던 시절의 세이브는 0으로 둔다 —
      // 지금 키우던 개체가 갑자기 알로 돌아가면 진행을 빼앗는 셈이다.
      if (typeof loaded.bornAt !== "number") save.bornAt = 0;
    } catch (e) {
      // 파일은 있는데 깨졌다. 덮어쓰지 않고 따로 치워 둔 뒤 멈춘다.
      loadFailed = true;
      try {
        fs.copyFileSync(SAVE, SAVE + ".corrupt-" + Date.now());
        console.error("[save] 깨진 파일을 .corrupt-* 로 복사해 뒀습니다: " + e.message);
      } catch {}
      console.error("[save] 해석하지 못했습니다. 이번 실행에서는 아무것도 저장하지 않습니다.");
    }
  }
  if (!Array.isArray(save.seen)) save.seen = [];
  if (!Array.isArray(save.graduated)) save.graduated = [];
  if (!save.maxStage || typeof save.maxStage !== "object") save.maxStage = {};
  if (!Array.isArray(save.box)) save.box = [];
  if (!Array.isArray(save.petIds)) save.petIds = [];
}

function writeSave() {
  // 못 읽고 시작한 판은 저장하지 않는다. 덮어쓰면 진짜 진행이 날아간다.
  if (loadFailed) return;
  /*
   * 임시 파일에 다 쓴 뒤 이름을 바꾼다.
   *
   * writeFileSync 는 먼저 파일을 비우고 쓴다. 그 사이에 앱이 죽거나 다른
   * 인스턴스가 읽으면 반쪽짜리를 보게 되고, 그걸 "빈 세이브"로 읽은 쪽이
   * 알을 까서 덮어쓴다. rename 은 원자적이라 중간 상태가 없다.
   */
  const tmp = SAVE + ".tmp";
  // 그날 처음 쓰는 거라면 덮기 전의 파일을 남긴다. backup.js 참고.
  backup.daily(SAVE, BACKUPS);
  try {
    fs.writeFileSync(tmp, JSON.stringify(save), "utf8");
    fs.renameSync(tmp, SAVE);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch {}
    // 조용히 넘어가면 "왜 진행이 안 남지"를 영영 못 찾는다.
    console.error("[save] 쓰지 못했습니다 (" + (e.code || e.message) + ")");
  }
}

const fmt = (n) =>
  n >= 1e9 ? (n / 1e9).toFixed(2) + "B"
  : n >= 1e6 ? (n / 1e6).toFixed(1) + "M"
  : n >= 1e3 ? (n / 1e3).toFixed(1) + "K"
  : String(n);

/** 남은 시간을 "3일 4시간" / "4시간 10분" 형태로 */
const hm = (ms) => {
  if (ms <= 0) return "곧";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 24) return Math.floor(h / 24) + "일 " + (h % 24) + "시간";
  return h ? h + "시간 " + m + "분" : m + "분";
};

let lastTotal = 0; // 마지막으로 읽은 누적 토큰. 사탕 계산에 쓴다.

/**
 * 성장 속도 배수. 200%면 2 — 같은 토큰으로 두 배 빨리 자란다.
 *
 * 처음엔 이 값을 임계값에 곱했는데 그러면 200%가 "두 배 더 써야 한다"가 되어
 * 이름과 반대로 움직였다. 속도는 성장량에 곱하는 쪽이 맞다.
 */
const growthSpeed = () => Math.max(0.1, (save.growthPct ?? 100) / 100);
/** 난이도를 반영한 상점 가격. 공짜가 되지는 않게 최소 1개. */
const priceOf = (cost) => Math.max(1, Math.round((cost * (save.pricePct ?? 100)) / 100));

/** 이상한사탕 현황 */
function candy(total = lastTotal) {
  const fromTokens = Math.floor(total / CANDY_PER);
  const earned = fromTokens + (save.candyBonus ?? 0);
  return {
    earned,
    spent: save.candySpent ?? 0,
    left: Math.max(0, earned - (save.candySpent ?? 0)),
    per: CANDY_PER,
    // 다음 사탕까지 얼마나 남았나
    toNext: CANDY_PER - (total % CANDY_PER),
  };
}

/**
 * 새 개체를 받는다. minStars가 있으면 그 등급 이상으로 뽑는다.
 *
 * 0.1.x에서는 여기서 키우던 아이를 덮어썼다. 이제는 박스에 더하고
 * 새 아이를 "키우는 중"으로 옮긴다 — 이전 아이는 그 자리에 남는다.
 */
function hatch(minStars = 0) {
  const cur = box.active(save);
  const exclude = cur ? cur.line : null;
  const line = minStars > 0 ? poke.rollAtLeast(minStars, exclude) : poke.roll(exclude);
  const m = box.make(line, poke.rollNature(), poke.rollShiny(Boolean(save.charm)));
  save.box.push(m);
  save.activeId = m.id;
  if (!save.seen.includes(line)) save.seen.push(line);
  return m;
}

/**
 * 상점 구매. 사탕이 모자라면 아무 일도 일어나지 않는다.
 * 살 수 있는지 판단은 여기서만 한다 — 렌더러가 보낸 값을 믿지 않는다.
 */
function buy(itemId) {
  const item = SHOP.find((x) => x.id === itemId);
  if (!item) return { ok: false, reason: "없는 물건" };
  if (item.once && save.charm) return { ok: false, reason: "이미 가지고 있습니다" };
  if (item.weekly && save.masterWeek === localMonday()) return { ok: false, reason: "마스터볼은 한 주에 1개만 살 수 있습니다. 다음 주 월요일에 다시 살 수 있습니다" };
  const c = candy();
  const cost = priceOf(item.cost);
  if (c.left < cost) return { ok: false, reason: "사탕이 모자랍니다" };

  save.candySpent = (save.candySpent ?? 0) + cost;
  let msg = "";
  if (itemId === "egg") { hatch(0); msg = "새 알을 받았습니다"; }
  else if (itemId === "egg-super") { hatch(3); msg = "슈퍼 알 — ★3 이상"; }
  else if (itemId === "egg-legend") { hatch(4); msg = "희귀 알 — ★4 이상"; }
  else if (itemId === "mint") {
    const a = box.active(save);
    if (!a) { save.candySpent -= cost; return { ok: false, reason: "키우는 아이가 없습니다" }; }
    a.nature = poke.rollNature();
    msg = "성격이 " + poke.NATURES[a.nature].name + "(으)로 바뀌었습니다";
  } else if (itemId === "rare-candy") {
    const a = box.active(save);
    if (!a) { save.candySpent -= cost; return { ok: false, reason: "키우는 아이가 없습니다" }; }
    a.fed = (a.fed || 0) + CANDY_FEED;
    msg = poke.describe(box.effOf(a, growthSpeed()), a.line, { shiny: a.shiny }).name + "이(가) 자랐습니다";
    if (a.hold === "everstone" && box.effOf(a, growthSpeed(), true) > box.effOf(a, growthSpeed())) msg += " — 변하지않는돌 때문에 진화는 멈춰 있습니다";
  } else if (itemId === "tm") {
    const a = box.active(save);
    const eff = box.effOf(a, growthSpeed());
    // 알에게는 가르칠 수 없다. 기술을 쓰지도 않는다
    if (!a || poke.stageFor(eff) === 0) { save.candySpent -= cost; return { ok: false, reason: "알에게는 가르칠 수 없습니다" }; }
    const pool = profile.tmCandidates(box.withLv(a, growthSpeed()), eff);
    if (!pool.length) { save.candySpent -= cost; return { ok: false, reason: "더 배울 수 있는 기술머신이 없습니다" }; }
    const id = pool[Math.floor(Math.random() * pool.length)];
    a.tmMoves = [...(a.tmMoves || []), id];
    const learned = profile.build(box.withLv(a, growthSpeed()), eff).tmMoves.find((m) => m.id === id);
    msg = poke.describe(eff, a.line, { shiny: a.shiny }).name + "이(가) " + (learned ? learned.name : "새 기술") + "을(를) 배웠습니다";
  } else if (itemId === "great-ball" || itemId === "ultra-ball") {
    const key = itemId === "great-ball" ? "great" : "ultra";
    save.balls = save.balls || { great: 0, ultra: 0 };
    save.balls[key] = (save.balls[key] || 0) + 3;
    msg = BALLS[key].name + " 3개를 샀습니다 (가진 수 " + save.balls[key] + ")";
    if (wildNow) ballInfo();
  } else if (itemId === "master-ball") {
    save.balls = save.balls || { great: 0, ultra: 0 };
    save.balls.master = (save.balls.master || 0) + 1;
    save.masterWeek = localMonday(); // 한 주에 1개 — 이번 주 월요일을 적어 둔다
    msg = "마스터볼을 샀습니다 (가진 수 " + save.balls.master + ") — 야생에서 볼을 눌러 마스터볼로 바꿔 던지세요";
    if (wildNow) ballInfo();
  } else if (itemId === "everstone") {
    save.items = save.items || {};
    save.items.everstone = (save.items.everstone || 0) + 1;
    msg = "변하지않는돌을 샀습니다 (가진 수 " + save.items.everstone + ") — 박스 › 상세에서 지니게 하세요";
  } else if (itemId === "charm") { save.charm = true; msg = "이로치 확률이 2배가 됩니다"; }

  writeSave();
  refresh(true);
  pushDex();
  pushShop();
  const a = box.active(save);
  return { ok: true, message: msg, shiny: itemId.startsWith("egg") && Boolean(a && a.shiny) };
}

/**
 * 마스터에 도달했으면 도감에 졸업 기록을 남기고 공짜 뽑기를 준다.
 *
 * graduatedAt으로 개체를 특정해 중복 기록을 막는다 —
 * 30초마다 도는 refresh가 같은 개체를 계속 졸업시키면 안 된다.
 */
/**
 * 도달한 최고 단계를 갱신한다. 내려가지는 않는다.
 *
 * 개체와 라인 양쪽에 남긴다. 개체 쪽은 박스에서 그 아이의 현재 모습을
 * 그리는 데 쓰고, 라인 쪽은 도감이 "이 종을 어디까지 키워봤나"를 쓰는 데 쓴다.
 */
function recordStage(m, grown) {
  if (!m) return;
  const st = poke.stageFor(grown);
  let dirty = false;
  if ((m.maxStage ?? -1) < st) { m.maxStage = st; dirty = true; }
  if ((save.maxStage[m.line] ?? -1) < st) { save.maxStage[m.line] = st; dirty = true; }
  if (dirty) writeSave();
}

function checkGraduation(m, grown) {
  if (!m) return;
  const idx = poke.stageFor(grown);
  if (poke.STAGES[idx].key !== "master") return;
  if (m.graduatedAt) return; // 이미 처리한 개체

  const mon = poke.describe(grown, m.line, { shiny: m.shiny });
  const r = poke.rarityOf(m.line);
  m.graduatedAt = new Date().toISOString().slice(0, 10);
  save.graduated.push({
    line: m.line,
    name: mon.name,
    dexId: mon.dexId,
    stars: r.stars,
    nature: (poke.NATURES[m.nature ?? 0] || {}).name ?? null,
    grown,
    at: m.graduatedAt,
  });
  save.candyBonus = (save.candyBonus ?? 0) + 5; // 졸업 보상
  writeSave();
}

/** 졸업 기록에 남은 성격 이름을 인덱스로 되돌린다. 못 찾으면 0. */
const natureIndexByName = (name) =>
  Math.max(0, poke.NATURES.findIndex((n) => n.name === name));

async function buildStats() {
  const u = usage.collect(save.logRoots || {});
  lastUsage = u;
  lastTotal = u.total;

  // 0.1.x 세이브라면 여기서 한 번 박스로 옮긴다. 옮긴 뒤로는 그냥 지나간다.
  if (box.migrate(save, u.total, natureIndexByName)) {
    console.log("[box] 세이브를 박스로 옮겼습니다 — " + save.box.length + "마리");
    writeSave();
  }
  // 처음 실행이라 박스가 비었으면 한 마리 준다.
  // 못 읽고 시작한 판에서는 주지 않는다 — 있는 박스를 못 본 것일 수 있다.
  if (!save.box.length && !loadFailed) {
    /*
     * 세이브를 읽었는데 박스가 비어 있다 — 우리가 모르는 상태다.
     * 여기서 알을 까면 그 파일을 그대로 덮어쓴다. 키우던 게 있었는지
     * 없었는지 확인할 방법이 영영 사라진다. 먼저 남긴다.
     */
    if (hadSave) {
      try {
        const at = SAVE + ".pre-hatch-" + Date.now();
        fs.writeFileSync(at, rawAtLoad ?? "", "utf8");
        console.error("[save] 박스가 빈 세이브를 읽었습니다. 덮어쓰기 전에 " + path.basename(at) + " 로 남겨 둡니다.");
      } catch (e) {
        console.error("[save] 덮어쓰기 전 보존에 실패했습니다 (" + (e.code || e.message) + ")");
      }
    }
    hatch(0);
    writeSave();
  }

  // 프로필이 없던 시절의 개체를 채운다 (한 번만 걸린다)
  if (box.backfill(save.box)) writeSave();
  if (room.normalize(save)) writeSave(); // 미니룸이 없던 세이브

  // 늘어난 토큰은 키우는 아이에게만 적립된다.
  const burn = burnCfg();
  if (box.accrue(save, u.total, (from, to) => ({ share: burning.share(u.events, from, to, burn), mult: burn.mult }))) writeSave();
  guildUsage = weekUsage(u, burn);

  const act = box.active(save);
  // 속도는 임계값을 고치는 대신 성장량에 곱해서 적용한다.
  // STAGES를 원본 그대로 둘 수 있어 난이도를 되돌리면 값이 정확히 복원된다.
  const eff = box.effOf(act, growthSpeed());
  const grown = act ? act.raw || 0 : 0;
  recordStage(act, eff);
  checkGraduation(act, eff);
  const mon = poke.describe(eff, act ? act.line : 0, { shiny: act && act.shiny });
  // 트레이는 정적 PNG(nativeImage는 GIF를 움직이지 못한다), 화면은 애니메이션 GIF.
  const still = await poke.spriteWithFallback(mon, CACHE, "still");
  const anim = await poke.spriteWithFallback(mon, CACHE, "anim");
  // events는 한도 계산에만 쓴다. 수천 건을 30초마다 IPC로 보낼 이유가 없다.
  const { events, ...slim } = u;

  // 박스 목록. 화면에서 고르고 바꾸려면 각자의 모습이 필요하다.
  const boxList = await Promise.all(
    save.box.map(async (m) => {
      const e = box.effOf(m, growthSpeed());
      const d = poke.describe(e, m.line, { shiny: m.shiny });
      const p = await poke.spriteWithFallback(d, CACHE, "still");
      // 바탕화면 펫은 움직이는 쪽을 쓴다. 한 번 받으면 디스크에 남는다.
      const ap = await poke.spriteWithFallback(d, CACHE, "anim");
      const r = poke.rarityOf(m.line);
      return {
        id: m.id,
        name: d.name,
        stage: d.stage.label,
        stageKey: d.stage.key,
        ratio: d.progress.ratio,
        next: d.progress.next,
        remaining: d.progress.remaining,
        grown: e,
        stars: r.stars,
        rarity: r.label,
        shiny: Boolean(m.shiny),
        nature: (poke.NATURES[m.nature ?? 0] || {}).name ?? null,
        // 결투·나무열매. 맛은 화면에서 "좋아함/싫어함"으로 보여 준다
        likes: tasteOf(m).likes,
        dislikes: tasteOf(m).dislikes,
        boost: m.boost || 0,
        sellPrice: poke.shopPrice(m.line, e, m.shiny), // 상점에 팔면 받을 코인(서버가 다시 센다)
        // 변하지않는돌. evolveTo — 지금 빼면 무엇으로 진화하나(쌓인 토큰이 문턱을 넘었을 때만)
        stone: m.hold === "everstone",
        evolveTo: (() => {
          if (m.hold !== "everstone") return null;
          const f = poke.describe(box.effOf(m, growthSpeed(), true), m.line, { shiny: m.shiny });
          return f.name !== d.name ? f.name : null;
        })(),
        record: m.record || { w: 0, l: 0 },
        caughtAt: m.caughtAt,
        graduated: Boolean(m.graduatedAt),
        active: m.id === (act && act.id),
        isPet: save.petIds.includes(m.id),
        url: p ? pathToFileURL(p).href : null,
        animUrl: ap ? pathToFileURL(ap).href : null,
        profile: profile.build(box.withLv(m, growthSpeed()), e),
      };
    }),
  );

  // 펫은 박스에서 고른 아이들. 아무도 안 골랐으면 키우는 아이 하나.
  const petMon = mon;
  const petStill = still;
  const petAnim = anim;

  return {
    usage: slim,
    mon,
    stillPath: still,
    // 렌더러에 Windows 경로를 넘기면 역슬래시를 직접 다뤄야 한다. 변환은 Node가 한다.
    stillUrl: still ? pathToFileURL(still).href : null,
    animUrl: anim ? pathToFileURL(anim).href : null,
    petName: petMon.name,
    petStillUrl: petStill ? pathToFileURL(petStill).href : null,
    petAnimUrl: petAnim ? pathToFileURL(petAnim).href : null,
    petLine: null, // 0.1.x 호환. 이제 petIds 를 쓴다
    petVisible: Boolean(save.petVisible),
    dex: {
      // 도감이 종 단위가 됐으므로 홈의 진행도도 종으로 센다.
      // 라인 수(221)와 종 수(519)가 섞이면 어느 쪽이 진짜인지 알 수 없다.
      seen: dexSpecies().filter((sp) => (save.maxStage[sp.line] ?? -1) >= sp.stage).length,
      total: dexSpecies().length,
      graduated: save.graduated.length,
    },
    grown,
    refreshedAt: Date.now(),
    growthPct: save.growthPct ?? 100,
    trayIcon: save.trayIcon ?? "logo",
    petSize: save.petSize,
    moveLevel: save.moveLevel ?? "rare",
    candy: candy(u.total),
    charm: Boolean(save.charm),
    shiny: Boolean(act && act.shiny),
    tree: await buildTree(act, eff),
    limits: limits.summarize(u, Date.now(), save.limits || {}, save.quotaFiles || {}),
    box: boxList,
    berries: berryBag(),
    stones: stoneCount(),
    room: roomState(),
    guild: save.guild ? { code: save.guild.code, name: save.guild.name, leader: Boolean(save.guild.leader), memberId: save.guild.memberId, gone: save.guild.gone || null, share: save.guildShare !== false } : null,
    burning: burning.status(new Date(), burn),
    online: onlineCfg(),
    friend: {
      team: save.friendTeam,
      trainer: save.trainerName || "",
      record: save.friendRecord || { w: 0, l: 0, d: 0 },
      sent: (save.tradeSent || []).slice(-3).reverse(),
    },
    battleRewardsLeft: battleRewardsLeft(),
    battleRewardsMax: BATTLE_REWARDS_PER_DAY,
    activeId: act ? act.id : null,
    petIds: save.petIds,
    rarity: act
      ? { ...poke.rarityOf(act.line), chance: poke.rollChance(act.line) }
      : null,
    nature: act ? poke.NATURES[act.nature ?? 0] ?? null : null,
  };
}

/** 진화 트리에 쓸 작은 정적 스프라이트를 붙인다. 못 받으면 그림 없이 이름만 나온다. */
async function buildTree(m, grown) {
  const nodes = poke.evolutionTree(m ? m.line : 0, grown);
  return Promise.all(
    nodes.map(async (n) => {
      const p = await poke.spriteWithFallback(
        { dexId: n.dexId, isShiny: n.isShiny },
        CACHE,
        "still",
      );
      // at은 원본 임계값이다. 화면에는 속도를 반영한 실제 필요량을 보여준다.
      return { ...n, at: Math.round(n.at / growthSpeed()), url: p ? pathToFileURL(p).href : null };
    }),
  );
}

/** 앱 로고. 256px 원본에서 줄여야 16px에서 또렷하다. */
let logoIcon = null;
function getLogo() {
  if (logoIcon) return logoIcon;
  const p = path.join(__dirname, "..", "..", "assets", "icon.png");
  const img = nativeImage.createFromPath(p);
  logoIcon = img.isEmpty() ? null : img.resize({ width: 16, height: 16, quality: "best" });
  return logoIcon;
}

/** Windows 트레이는 macOS 메뉴바와 달리 글자를 못 띄운다. 숫자는 툴팁으로 간다. */
function applyTray(s) {
  if (!tray) return;
  if (save.trayIcon === "mon" && s.stillPath) {
    const img = nativeImage.createFromPath(s.stillPath).resize({ width: 16, height: 16 });
    if (!img.isEmpty()) tray.setImage(img);
  } else {
    const logo = getLogo();
    if (logo) tray.setImage(logo);
  }
  const p = s.mon.progress;
  const b = s.limits && s.limits.block;
  const q = s.limits && s.limits.codex;
  tray.setToolTip(
    s.mon.name + " · " + s.mon.stage.label +
      (s.rarity ? "  " + "★".repeat(s.rarity.stars) : "") +
      (s.nature ? "  (" + s.nature.name + ")" : "") + "\n" +
      "오늘 " + fmt(s.usage.today) + " · 누적 " + fmt(s.usage.total) +
      (p.next ? "\n다음(" + p.next + ")까지 " + fmt(p.remaining) : "\n최고 단계입니다") +
      (b ? "\n5시간 창 " + fmt(b.used) + " · " + hm(b.remainingMs) + " 남음" : "") +
      (q ? "\nCodex 주간 " + q.percent + "%" : "") +
      (s.burning && s.burning.on ? "\n🔥 버닝타임 ×" + s.burning.mult + " 중" : ""),
  );
}

function push(target, s) {
  if (target && !target.isDestroyed()) target.webContents.send("stats", s);
}

/**
 * 떠 있는 펫 전부에 밀어준다.
 *
 * 한 마리이던 시절의 전역 pet 하나에 밀고 있었는데, 여러 마리로 바꾸면서
 * 그 변수가 null 로 남았다. push(null) 은 조용히 아무것도 안 해서
 * 펫은 창을 만들 때 받은 값에 그대로 멈춰 있었다 — 알이 부화해도
 * 계속 알이었다. 조용히 실패하는 쪽이 제일 찾기 어렵다.
 */
function pushPets(s) {
  for (const rec of pets.values()) push(rec.win, s);
}

let prevSnap = null;

/** 상태가 바뀐 순간에만 알린다. 자세한 판단은 notify.js가 한다. */
function sendNotifications(s) {
  if (!save.notifyEnabled || !Notification.isSupported()) return;
  const cur = {
    ...notify.snapshot({ ...s, bornAtRaw: s.activeId }),
    name: s.mon.name,
    stageLabel: s.mon.stage.label,
    body: s.mon.progress.next
      ? s.mon.progress.next + "까지 " + fmt(s.mon.progress.remaining)
      : "최고 단계입니다",
    resetIn: s.limits && s.limits.codex ? hm(s.limits.codex.resetAt - Date.now()) : null,
  };
  for (const n of notify.pending(prevSnap, cur, { warnPercent: save.warnPercent })) {
    try {
      new Notification({ title: n.title, body: n.body, silent: false }).show();
    } catch (e) {
      console.error("[notify]", e.message);
    }
  }
  prevSnap = cur;
}

let refreshing = false;
let lastScanAt = 0;

/**
 * 로그 다시 읽기.
 *
 * 기동할 때 여러 경로가 동시에 부른다 — 최초 1회, 펫 띄우기, 렌더러의 요청,
 * did-finish-load, 창 열기. 그대로 두면 10초 안에 로그 103개를 네 번 훑는다.
 * 이미 도는 중이면 건너뛰고, 방금 읽었으면 그 결과를 다시 쓴다.
 * force=true 면(구매·뽑기처럼 값이 바뀐 직후) 무조건 다시 읽는다.
 */
async function refresh(force = false) {
  if (refreshing) return;
  if (!force && lastStats && Date.now() - lastScanAt < 3000) {
    // 최근 결과를 그대로 다시 밀어준다. 화면은 갱신되고 디스크는 안 건드린다.
    push(win, lastStats);
    pushPets(lastStats);
    return;
  }
  refreshing = true;
  try {
    const s = await buildStats();
    // 언제 읽은 값인지 화면이 말할 수 있어야 한다.
    // "왜 안 바뀌지"의 절반은 갱신이 안 된 건지 값이 그대로인 건지 모르는 데서 온다.
    s.scannedAt = Date.now();
    lastStats = s;
    guildPush().catch((e) => console.error("[guild]", e.message)); // 방이 바뀌었으면 길드에도 올린다
    sendNotifications(s);
    if (s.burning) notifyBurning(s.burning);
    push(win, s);
    pushPets(s);
    try {
      applyTray(s);
    } catch (e) {
      console.error("[tray]", e.message);
    }
  } catch (e) {
    console.error("[refresh 실패]", e && e.stack ? e.stack : e);
  } finally {
    refreshing = false;
    lastScanAt = Date.now();
  }
}

/** 렌더러 오류는 메인 stdout에 안 나온다. 끌어오지 않으면 조용히 죽는다. */
function logConsole(tag) {
  return (_e, lvl, msg, line, src) =>
    console.log("[" + tag + ":" + lvl + "] " + msg + " (" + src + ":" + line + ")");
}

/* ---------------- 팝오버 ---------------- */

/** 팝오버가 이보다 작아지면 탭 줄과 카드가 깨진다. 화면 배치는 400px 을 기준으로 짰다 */
const POP_MIN = { w: 400, h: 460 };

function createWindow() {
  // 700px가 늘 들어간다는 보장이 없다. 작업 영역을 넘지 않게 자르고,
  // 잘린 만큼은 본문 스크롤이 받아준다.
  const area = screen.getPrimaryDisplay().workArea;
  // 끌어서 바꾼 크기를 기억해 둔다. 모니터가 바뀌었을 수 있어 작업 영역 안으로 자른다
  const ps = save.popSize || {};
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
  win = new BrowserWindow({
    width: clamp(ps.w || POP_MIN.w, POP_MIN.w, area.width),
    height: clamp(ps.h || Math.min(760, area.height - 60), POP_MIN.h, area.height),
    minWidth: POP_MIN.w,
    minHeight: POP_MIN.h,
    show: false,
    frame: false,
    resizable: true,
    // 테두리 없는 창은 탭 줄(끌기 영역)을 두 번 누르면 최대화된다. 팝오버가 화면을 덮으면 안 된다
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true },
  });
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  // 최초 refresh가 로드보다 빠르면 그 send는 허공에 사라진다. 로드 후 한 번 더 민다.
  win.webContents.on("did-finish-load", () => (lastStats ? push(win, lastStats) : refresh()));
  win.webContents.on("console-message", logConsole("renderer"));
  // 크기를 바꾸면 기억한다. 끄는 동안 수십 번 오니 멈춘 뒤에 한 번만 쓴다
  let sizeTimer = null;
  win.on("resize", () => {
    clearTimeout(sizeTimer);
    sizeTimer = setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      const [w, h] = win.getSize();
      save.popSize = { w, h };
      writeSave();
    }, 600);
  });
  /**
   * 팝오버답게 포커스를 잃으면 닫는다.
   *
   * 다만 펫 창을 만들거나 없앨 때도 포커스가 흔들려 blur가 온다.
   * 그대로 두면 "펫 숨기기"를 눌렀는데 펫이 아니라 이 창이 닫힌다.
   * 우리 창 때문에 생긴 blur인지 확인하고 넘긴다.
   */
  win.on("blur", () => {
    if (petBusy) return;
    setTimeout(() => {
      if (!win || win.isDestroyed() || petBusy) return;
      // 우리 창(설정 등)이 포커스를 가져갔으면 닫지 않는다
      const focused = BrowserWindow.getFocusedWindow();
      if (focused && !focused.isDestroyed() && focused !== win) return;
      if (win.isFocused()) return;
      win.hide();
    }, 120);
  });
}

function showNearTray() {
  const b = tray.getBounds();
  const area = screen.getDisplayNearestPoint({ x: b.x, y: b.y }).workArea;
  const size = win.getSize();
  const w = size[0];
  const h = size[1];
  const x = Math.min(Math.max(area.x, Math.round(b.x + b.width / 2 - w / 2)), area.x + area.width - w);
  const y = b.y > area.y + area.height / 2 ? b.y - h - 8 : b.y + b.height + 8;
  win.setPosition(x, Math.min(Math.max(area.y, y), area.y + area.height - h));
  win.show();
  win.focus();
  // 숨어 있는 동안 갱신이 밀렸을 수 있다. 열자마자 다시 읽는다.
  refresh();
}

/* ---------------- 도감 ---------------- */


/**
 * 도감 데이터.
 *
 * 안 만난 종은 이름도 그림도 넘기지 않는다 — 렌더러에 보내놓고 CSS로만
 * 가리면 개발자 도구로 다 보인다. 모으는 재미가 거기서 끝난다.
 * 스프라이트도 만난 것만 받는다. 221개를 미리 받을 이유가 없다.
 */
/**
 * 보유한 라인.
 *
 * 도감에 있다고 가진 게 아니다 — 도감은 "만난 적 있다"는 기록이다.
 * 실제로 가진 건 지금 키우는 아이와, 마스터까지 키워 졸업시킨 아이들이다.
 * 뽑기로 갈아치운 아이는 떠나보낸 것이므로 보유가 아니다.
 */
function ownedLines() {
  const set = new Set(save.graduated.map((g) => g.line));
  for (const m of save.box) set.add(m.line);
  return set;
}

/**
 * 도감에 들어갈 종 목록.
 *
 * 라인이 아니라 종 단위다. 전에는 라인 하나에 칸 하나였는데,
 * 고라파덕을 골덕으로 키우면 고라파덕이 도감에서 사라졌다.
 * 진화는 기록을 덮어쓰는 일이 아니다 — 거쳐 온 모습도 만난 것이다.
 *
 * 라인 안에서 같은 종이 여러 단계에 걸쳐 있으면(2단 진화 라인은
 * 1차와 최종이 같은 종이다) 가장 이른 단계 하나로 합친다.
 */
let dexSpeciesCache = null;
function dexSpecies() {
  if (dexSpeciesCache) return dexSpeciesCache;
  const out = [];
  poke.LINES.forEach((L, line) => {
    const firstStage = new Map(); // dexId -> 가장 이른 단계
    L.ids.forEach((id, st) => {
      if (!id) return; // 0단계(알)는 종이 아니다
      if (!firstStage.has(id)) firstStage.set(id, st);
    });
    for (const [dexId, st] of firstStage) {
      out.push({ dexId, line, stage: st, name: L.names[st] });
    }
  });
  // 도감 번호 순. 라인 순으로 두면 같은 번호가 흩어져 훑을 수가 없다.
  out.sort((a, b) => a.dexId - b.dexId);
  dexSpeciesCache = out;
  return out;
}

async function buildDex() {
  const owned = ownedLines();
  const gradCount = new Map();
  for (const g of save.graduated) gradCount.set(g.line, (gradCount.get(g.line) ?? 0) + 1);

  // 지금 바탕화면에 떠 있는 아이들의 현재 모습
  const petDex = new Set();
  for (const m of save.box) {
    if (!save.petIds.includes(m.id)) continue;
    const L = poke.LINES[m.line];
    if (L) petDex.add(L.ids[poke.stageFor(box.effOf(m, growthSpeed()))]);
  }

  const list = dexSpecies();
  const entries = await Promise.all(
    list.map(async (sp) => {
      // 그 라인을 만났고, 이 모습까지 실제로 키웠을 때만 만난 것으로 친다.
      const reached = (save.maxStage[sp.line] ?? -1) >= sp.stage;
      const seen = save.seen.includes(sp.line) && reached;
      if (!seen) return { dexId: sp.dexId, seen: false };
      const r = poke.rarityOf(sp.line);
      const p = await poke.spriteWithFallback({ dexId: sp.dexId, isShiny: false }, CACHE, "still");
      return {
        dexId: sp.dexId,
        line: sp.line,
        seen: true,
        name: sp.name,
        stage: poke.STAGES[sp.stage].label,
        stars: r.stars,
        label: r.label,
        graduated: gradCount.get(sp.line) ?? 0,
        owned: owned.has(sp.line),
        isPet: petDex.has(sp.dexId),
        url: p ? pathToFileURL(p).href : null,
      };
    }),
  );

  return {
    entries,
    seen: entries.filter((e) => e.seen).length,
    total: list.length,
    graduated: save.graduated.length,
  };
}

/**
 * 도감·상점은 메인 창의 탭이다. 별도 창을 띄우지 않는다.
 *
 * 처음엔 창을 따로 뒀는데, 원본처럼 한 창에서 탭으로 오가는 편이
 * 훨씬 덜 번거롭다. 창이 셋이면 어디에 뭐가 있었는지 매번 찾게 된다.
 */
async function pushDex() {
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send("dex", await buildDex());
  } catch (e) {
    console.error("[dex]", e && e.message);
  }
}

function pushShop() {
  if (!win || win.isDestroyed()) return;
  const c = candy();
  win.webContents.send("shop", {
    candy: c,
    charm: Boolean(save.charm),
    items: SHOP.map((x) => ({
      ...x,
      cost: priceOf(x.cost),
      owned: x.once ? Boolean(save.charm) : x.weekly ? save.masterWeek === localMonday() : false,
      have: x.id === "everstone" ? stoneCount() : x.ball ? ((save.balls || {})[x.ball] || 0) : undefined,
      afford: c.left >= priceOf(x.cost),
    })),
  });
}

/** 트레이 메뉴에서 부르면 창을 열고 그 탭으로 보낸다. */
function openTab(name) {
  if (!win || win.isDestroyed()) return;
  if (!win.isVisible()) showNearTray();
  win.webContents.send("go-tab", name);
  win.focus();
}
const openDex = () => openTab("dex");
const openShop = () => openTab("shop");

/* ---------------- 설정 ---------------- */

let setWin = null;
let pollTimer = null;

/** 설정 화면에 보여줄 경로 상태. 실제로 읽히는지까지 확인해서 준다. */
function pathReport() {
  const u = lastUsage || usage.collect(save.logRoots || {});
  return {
    logs: usage.diagnose(save.logRoots || {}),
    quota: limits.diagnoseQuota(u, save.quotaFiles || {}),
    roots: save.logRoots || { claude: [], codex: [] },
    files: save.quotaFiles || {},
  };
}

function settingsPayload() {
  return {
    limits: save.limits || {},
    growthPct: save.growthPct ?? 100,
    pricePct: save.pricePct ?? 100,
    notifyEnabled: save.notifyEnabled,
    warnPercent: save.warnPercent,
    petSize: save.petSize,
    wanderLevel: save.wanderLevel,
    moveLevel: save.moveLevel ?? "rare",
    wildLevel: save.wildLevel ?? "rare",
    wildLeft: wildLeftToday(),
    wildQuiet: save.wildQuiet || { enabled: false, from: 22, to: 8 },
    burning: burnCfg(),
    pollMinutes: save.pollMinutes,
    autoLaunch: save.autoLaunch,
    online: onlineCfg(),
    onlineDefault: DEFAULT_RELAY,
    autoSources: officialSources(),
    dataPath: app.getPath("userData"),
    dataDefault: DEFAULT_DATA,
    dataOverride: dataDirOverride(),
    dataByEnv: !!(process.env.POKETOKENBAR_DATA || "").trim(),
  };
}

/**
 * 지금 공식 사용률이 들어오는 도구들.
 *
 * 설정 화면의 "한도 맞추기"는 공식값이 없을 때를 위한 대비책인데,
 * 들어오고 있는데도 입력란만 보이면 "자동이라더니"가 된다. 어느 쪽인지 밝힌다.
 */
function officialSources() {
  const files = save.quotaFiles || {};
  const out = [];
  try {
    if (limits.claudeQuota(files.claude)) out.push("Claude");
  } catch {}
  try {
    if (limits.codexQuota(files.codex) || ((lastUsage && lastUsage.quota) || {}).codex) out.push("Codex");
  } catch {}
  return out;
}

function pushSettings() {
  if (setWin && !setWin.isDestroyed()) setWin.webContents.send("settings", settingsPayload());
}

/** 폴링 주기를 다시 건다. 설정이 바뀌면 즉시 반영되어야 한다. */
function restartPolling() {
  if (pollTimer) clearInterval(pollTimer);
  const ms = Math.max(10_000, (save.pollMinutes ?? 0.5) * 60_000);
  // setInterval은 콜백에 인자를 넘기므로 감싸지 않으면 force로 오해된다
  pollTimer = setInterval(() => refresh(true), ms);
}

function applySettings(patch) {
  Object.assign(save, patch);
  if ("burning" in patch) save.burning = burning.normalize(patch.burning); // 설정 창 값을 믿지 않는다
  writeSave();

  if ("wanderLevel" in patch) for (const id of pets.keys()) startWander(id);
  if ("wildLevel" in patch || "wildQuiet" in patch) scheduleWild(); // 바꾼 간격으로 다시 잡는다. 끄면 여기서 멈춘다
  if ("petSize" in patch && pets.size) {
    // 투명 창은 setSize로 크기가 제대로 안 바뀐다 — 내용이 다시 그려지지
    // 않아 사라진 것처럼 보인다. 전부 없애고 새 크기로 다시 만든다.
    const first = [...pets.values()][0];
    if (first && !first.win.isDestroyed()) {
      const p = first.win.getPosition();
      save.petPos = { x: p[0], y: p[1] };
    }
    petBusy = true;
    for (const id of [...pets.keys()]) destroyPet(id);
    syncPets(); // 여기서 새 크기에 맞게 자리를 다시 잡는다
    setTimeout(() => (petBusy = false), 400);
  }
  if ("trayIcon" in patch && lastStats) applyTray(lastStats);
  if ("pollMinutes" in patch) restartPolling();
  if ("growthPct" in patch || "pricePct" in patch) pushShop();
  if ("autoLaunch" in patch) {
    // 패키징 전(개발 중 electron.exe 실행)에는 등록해도 의미가 없다.
    try {
      app.setLoginItemSettings({ openAtLogin: Boolean(save.autoLaunch) });
    } catch (e) {
      console.error("[autoLaunch]", e.message);
    }
  }
  pushSettings();
  // 합치기 가드를 통과해야 한다. force가 없으면 옛 petSize가 그대로 다시 가서
  // 창만 커지고 스프라이트는 그대로인 상태가 된다.
  refresh(true);
}

function openSettings() {
  if (setWin && !setWin.isDestroyed()) {
    setWin.show();
    setWin.focus();
    return;
  }
  const area = screen.getPrimaryDisplay().workArea;
  setWin = new BrowserWindow({
    width: 420,
    height: Math.min(620, area.height - 80),
    frame: false,
    resizable: true,
    minWidth: 340,
    minHeight: 320,
    backgroundColor: "#14151a",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true },
  });
  setWin.loadFile(path.join(__dirname, "..", "renderer", "settings.html"));
  setWin.webContents.on("did-finish-load", pushSettings);
  setWin.webContents.on("console-message", logConsole("settings"));
  setWin.on("closed", () => (setWin = null));
}

/**
 * 진행 초기화. 토큰 기록은 로그가 원본이라 지워지지 않는다 —
 * 지워지는 건 이 앱이 만든 것(도감·졸업·뽑기권·현재 개체)뿐이다.
 */
function resetProgress() {
  // 버튼 한 번에 전부 사라진다. 되돌릴 길을 먼저 만들어 둔다.
  backup.snapshot(SAVE, BACKUPS, "before-reset");
  save.box = [];
  save.activeId = null;
  save.petIds = [];
  save.lastTotal = lastTotal; // 지금부터 알로 다시 시작
  save.candySpent = 0;
  save.candyBonus = 0;
  save.charm = false;
  save.items = {}; // 사탕으로 산 것은 같이 비운다 — 변하지않는돌·미니룸
  save.room = room.fresh();
  save.seen = [];
  save.maxStage = {};
  save.graduated = [];
  hatch(0); // 첫 알 한 마리
  prevSnap = null; // 초기화 직후 "진화했습니다"가 뜨지 않게
  writeSave();
  refresh(true);
  pushDex();
}


/* ---------------- 데스크톱 펫 ---------------- */

/**
 * 여러 마리를 동시에 띄운다.
 *
 * 0.1.x에서는 창 하나에 전역 변수 한 벌(wanderTarget, selfPos, 타이머 둘)로
 * 관리했다. 여러 마리가 되면 그 한 벌을 공유할 수가 없다 —
 * 한 마리가 목적지에 도착해 target을 비우면 나머지도 같이 멈춘다.
 * 그래서 상태를 창마다 들고 다니게 바꿨다.
 *
 * 키는 개체 id다. 같은 종을 두 마리 보유할 수 있으므로 라인으로는 안 된다.
 */
const pets = new Map(); // id -> { win, target, selfPos, wanderTimer, stepTimer }

/** 펫 창을 만들거나 없애는 중. 그동안의 blur는 무시한다. */
let petBusy = false;

const petW = () => save.petSize ?? 128;

/**
 * 펫 창을 옮긴다. 위치만이 아니라 **크기까지 함께** 지정한다.
 *
 * setPosition 만 쓰던 때, 끄는 동안 창이 1319x1416 까지 부풀어 화면 위쪽을
 * 통째로 덮고 클릭을 먹은 일이 있었다. 배율은 두 모니터 다 100% 였으니
 * DPI 탓이 아니고, 우리 코드에 크기를 바꾸는 곳도 없었다. 원인이 무엇이든
 * 위치만 주는 호출로는 크기가 보장되지 않는다 — 매번 같이 박아 둔다.
 *
 * 화면 밖으로도 못 나가게 가둔다. 저장된 자리가 y=-636 이 된 적이 있는데
 * 그러면 다음에 켤 때 보이지도 않는다.
 */
function movePet(win, x, y) {
  if (!win || win.isDestroyed()) return;
  const w = petW();
  const area = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }).workArea;
  const nx = Math.min(Math.max(area.x, Math.round(x)), area.x + area.width - w);
  const ny = Math.min(Math.max(area.y, Math.round(y)), area.y + area.height - w);
  win.setBounds({ x: nx, y: ny, width: w, height: w });
  return { x: nx, y: ny };
}

/**
 * 배회 강도. 기본은 "가끔" — 데스크톱 펫이 쉬지 않고 돌아다니면
 * 귀여운 게 아니라 작업에 거슬린다. 대부분의 시간은 가만히 있어야 한다.
 *
 * pause  다음 목적지를 잡기까지 쉬는 시간(ms)
 * range  한 번에 움직이는 거리(px, 좌우/상하)
 * px/ms  이동 속도
 */
const WANDER = {
  off: null,
  rare: { pause: 35_000, range: [150, 90], px: 1, ms: 50 },
  often: { pause: 12_000, range: [380, 220], px: 2, ms: 40 },
};

/** 실제로 띄울 아이들. 아무도 안 골랐으면 키우는 아이 한 마리. */
function petTargets() {
  const ids = (save.petIds || []).filter((id) => box.find(save.box, id));
  if (ids.length) return ids;
  const a = box.active(save);
  return a ? [a.id] : [];
}

/**
 * 처음 놓을 자리.
 *
 * 여러 마리가 같은 좌표에 겹쳐 뜨면 한 마리처럼 보인다.
 * 저장된 자리를 기준으로 순서대로 비켜 놓는다.
 */
function startPos(nth) {
  // 저장된 자리가 속한 화면을 기준으로 한다. 주 모니터로 고정하면
  // 보조 모니터에 뒀던 펫이 매번 주 모니터로 끌려온다.
  const base0 = save.petPos || { x: 0, y: 0 };
  const area = screen.getDisplayNearestPoint({ x: base0.x, y: base0.y }).workArea;
  const base = save.petPos || {
    x: area.x + area.width - petW() - 40,
    y: area.y + area.height - petW() - 60,
  };
  const want = { x: base.x - nth * (petW() + 12), y: base.y };
  // 크기를 키우면 전에 있던 자리가 화면 밖으로 밀려날 수 있다. 다시 가둔다.
  return {
    x: Math.min(Math.max(area.x, want.x), area.x + area.width - petW()),
    y: Math.min(Math.max(area.y, want.y), area.y + area.height - petW()),
  };
}

function createPet(id, nth) {
  const pos = startPos(nth);
  const w = new BrowserWindow({
    width: petW(),
    height: petW(),
    x: pos.x,
    y: pos.y,
    // 만들자마자 보여주지 않는다. 숨김 상태에서 크기를 바꿀 때 튀어나오면 안 된다.
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      // 어느 아이의 창인지 렌더러가 알아야 자기 그림을 고를 수 있다
      additionalArguments: ["--ptb-pet-id=" + id],
    },
  });
  const rec = { win: w, target: null, selfPos: null, wanderTimer: null, stepTimer: null };
  pets.set(id, rec);

  w.setAlwaysOnTop(true, "screen-saver"); // 전체화면 위에도 뜨게
  w.loadFile(path.join(__dirname, "..", "renderer", "pet.html"));
  w.webContents.on("did-finish-load", () => lastStats && push(w, lastStats));
  w.webContents.on("console-message", logConsole("pet:" + id));

  w.on("moved", () => {
    if (w.isDestroyed()) return;
    /*
     * 끄는 동안에는 아무것도 하지 않는다.
     *
     * 여기서 writeSave() 를 부르고 있었다. 드래그 한 번에 moved 가 수십 번
     * 오는데 그때마다 동기 디스크 쓰기를 하니 메인이 밀렸고, setPosition 이
     * 커서를 못 따라가 펫이 뒤처져 보였다. 위로 끌면 아래로 처지는 게
     * 그래서였다. 자리는 놓을 때 한 번만 저장한다.
     */
    if (rec.dragging) return;
    const p = w.getPosition();
    if (rec.selfPos && p[0] === rec.selfPos.x && p[1] === rec.selfPos.y) return; // 우리가 옮긴 것
    save.petPos = { x: p[0], y: p[1] };
    writeSave();
    rec.target = null; // 사용자가 놓은 자리에서 다시 시작한다
  });

  startWander(id);
  return rec;
}

/**
 * 한 마리를 배회시킨다.
 *
 * 상태를 rec에 담아 두므로 여러 마리가 서로 간섭하지 않는다.
 * 목적지도 따로, 타이머도 따로다.
 */
function startWander(id) {
  stopWander(id);
  const rec = pets.get(id);
  const cfg = WANDER[save.wanderLevel];
  if (!cfg || !rec || rec.win.isDestroyed()) return;

  const pickTarget = () => {
    if (rec.win.isDestroyed()) return;
    const p = rec.win.getPosition();
    const area = screen.getDisplayNearestPoint({ x: p[0], y: p[1] }).workArea;
    const dx = (Math.random() - 0.5) * cfg.range[0];
    const dy = (Math.random() - 0.5) * cfg.range[1];
    rec.target = {
      x: Math.min(Math.max(area.x, Math.round(p[0] + dx)), area.x + area.width - petW()),
      y: Math.min(Math.max(area.y, Math.round(p[1] + dy)), area.y + area.height - petW()),
    };
  };

  rec.wanderTimer = setInterval(pickTarget, cfg.pause);
  // 여러 마리가 동시에 출발하면 줄지어 움직이는 것처럼 보인다. 조금씩 어긋나게.
  setTimeout(pickTarget, 4000 + Math.random() * 3000);

  rec.stepTimer = setInterval(() => {
    if (rec.win.isDestroyed() || !rec.target) return;
    const p = rec.win.getPosition();
    const dx = rec.target.x - p[0];
    const dy = rec.target.y - p[1];
    if (Math.abs(dx) <= cfg.px && Math.abs(dy) <= cfg.px) {
      rec.target = null; // 도착. 다음 pause 동안 가만히 있는다
      return;
    }
    const step = (d) => Math.sign(d) * Math.min(Math.abs(d), cfg.px);
    const nx = Math.round(p[0] + step(dx));
    const ny = Math.round(p[1] + step(dy));
    rec.selfPos = movePet(rec.win, nx, ny) || { x: nx, y: ny };
    push(rec.win, { facing: dx < 0 ? "left" : "right" }); // 진행 방향으로 뒤집게
  }, cfg.ms);
}

function stopWander(id) {
  const rec = pets.get(id);
  if (!rec) return;
  if (rec.wanderTimer) clearInterval(rec.wanderTimer);
  if (rec.stepTimer) clearInterval(rec.stepTimer);
  rec.wanderTimer = null;
  rec.stepTimer = null;
  rec.target = null;
}

function stopAllWander() {
  for (const id of pets.keys()) stopWander(id);
}

/** 창을 통째로 없앤다 (박스에서 뺐거나 크기가 바뀐 경우) */
function destroyPet(id) {
  const rec = pets.get(id);
  if (!rec) return;
  stopWander(id);
  if (!rec.win.isDestroyed()) rec.win.destroy();
  pets.delete(id);
}

/**
 * 띄울 목록과 실제 창을 맞춘다.
 *
 * 숨길 때 창을 없애지 않는다. 다시 만들려면 BrowserWindow 생성 + HTML 로드 +
 * 스프라이트 로드를 처음부터 다시 해야 해서 눈에 띄게 느리다.
 * 감췄다 보이는 것은 즉시 끝난다. 대신 배회는 멈춰 둔다.
 *
 * 목록에서 빠진 아이의 창은 없앤다 — 숨겨만 두면 박스에서 뺀 아이의 창이
 * 계속 메모리에 남는다.
 */
function syncPets() {
  const want = petTargets();
  petBusy = true;

  // 싸우는 중인 둘은 건드리지 않는다. 결투가 끝나면 이 함수가 다시 불려 정리한다
  const fighting = (id) => Boolean(duel && duel.ids.includes(id));
  for (const id of [...pets.keys()]) if (!want.includes(id) && !fighting(id)) destroyPet(id);

  want.forEach((id, nth) => {
    if (fighting(id)) return;
    let rec = pets.get(id);
    if (!rec || rec.win.isDestroyed()) {
      if (!save.petVisible) return; // 숨긴 상태면 만들지 않는다
      rec = createPet(id, nth);
    }
    if (save.petVisible) {
      startWander(id);
      rec.win.showInactive();
    } else {
      stopWander(id);
      rec.win.hide();
    }
  });

  // 창 조작으로 생긴 blur가 도착할 시간을 준 뒤 푼다
  setTimeout(() => (petBusy = false), 250);
}

function togglePet(on) {
  save.petVisible = on === undefined ? !save.petVisible : on;
  writeSave();
  syncPets();

  /* 버튼 라벨 하나 바꾸자고 로그 103개를 다시 읽을 이유가 없다.
     마지막 결과에 표시 여부만 갈아 끼워 바로 밀어준다. */
  if (lastStats) {
    lastStats = { ...lastStats, petVisible: save.petVisible };
    push(win, lastStats);
  } else {
    refresh(true);
  }
}

/** 박스에서 이 아이를 바탕화면에 띄울지 토글 */
function togglePetMember(id) {
  if (!box.find(save.box, id)) return;
  const ids = new Set(save.petIds || []);
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  save.petIds = [...ids];
  // 한 마리라도 고르면 자동으로 보이게 — 골랐는데 아무것도 안 나타나면 고장으로 보인다
  if (save.petIds.length && !save.petVisible) save.petVisible = true;
  writeSave();
  syncPets();
  refresh(true);
}

function setWanderLevel(level) {
  save.wanderLevel = level;
  writeSave();
  for (const id of pets.keys()) startWander(id);
}

/* ---------------- 바탕화면 결투 ---------------- */

/**
 * 지금 바탕화면에서 싸우는 중인 판. null 이면 없다.
 *   ids   싸우는 두 아이
 *   temp  결투 때문에 잠깐 띄운 창 — 끝나면 다시 거둔다
 *
 * 싸우는 동안에는 syncPets 가 이 둘을 건드리면 안 된다. 띄울 목록(petTargets)에
 * 없는 아이를 데려왔으면 그대로 두면 결투 도중에 창이 사라진다.
 */
let duel = null;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 펫 창에 결투 장면 하나를 보낸다 */
function duelSend(id, msg) {
  const rec = pets.get(id);
  if (rec && !rec.win.isDestroyed()) rec.win.webContents.send("duel", msg);
}

/** 창이 다 뜰 때까지. 막 만든 창에 장면을 보내면 받을 사람이 없다 */
function whenLoaded(rec) {
  if (!rec.win.webContents.isLoading()) return Promise.resolve();
  return new Promise((r) => rec.win.webContents.once("did-finish-load", () => setTimeout(r, 300)));
}

/** 두 창을 나란히 세울 자리까지 걸어가게 한다. 순간이동하면 누가 누군지 놓친다 */
async function duelWalk(recs, to) {
  const from = recs.map((r) => {
    const p = r.win.getPosition();
    return { x: p[0], y: p[1] };
  });
  const N = 30;
  for (let k = 1; k <= N; k++) {
    const t = k / N;
    const e = 1 - Math.pow(1 - t, 2);
    recs.forEach((rec, i) => {
      if (rec.win.isDestroyed() || rec.dragging) return;
      const x = Math.round(from[i].x + (to[i].x - from[i].x) * e);
      const y = Math.round(from[i].y + (to[i].y - from[i].y) * e);
      rec.selfPos = movePet(rec.win, x, y) || { x, y };
    });
    await wait(16);
  }
}

const STAT_SHORT = { atk: "공격", def: "방어", spa: "특공", spd: "특방", spe: "스피드", acc: "명중", eva: "회피" };
const AIL_SHORT = { paralysis: "마비!", burn: "화상!", poison: "독!", sleep: "잠들었다", freeze: "얼었다!", confusion: "혼란!" };

/**
 * 로그 한 줄을 펫 머리 위에 띄울 짧은 말로. 창이 펫 크기만 해서 이름이 들어간
 * 문장은 다 안 들어간다. 못 줄이는 줄은 null — 띄우지 않는다.
 */
function duelSay(ev) {
  const t = ev.text || "";
  if (ev.eff > 1) return { side: ev.side, text: "효과가 굉장했다!", kind: "good" };
  if (ev.eff < 1) return { side: ev.side, text: "효과가 별로…", kind: "bad" };
  if (ev.stat) return { side: ev.side, text: STAT_SHORT[ev.stat] + " " + (ev.change > 0 ? "↑" : "↓").repeat(Math.min(3, Math.abs(ev.change))), kind: ev.change > 0 ? "up" : "down" };
  if (ev.status) return { side: ev.side, text: AIL_SHORT[ev.status] || "", kind: "bad" };
  if (/맞지 않았다/.test(t)) return { side: ev.side, text: "빗나갔다!", kind: "bad" };
  if (/효과가 없는/.test(t)) return { side: ev.side, text: "효과가 없다…", kind: "bad" };
  if (/급소/.test(t)) return { side: ev.side, text: "급소!", kind: "good" };
  if (/흡수/.test(t)) return { side: ev.side, text: "흡수", kind: "up" };
  if (/반동/.test(t)) return { side: ev.side, text: "반동!", kind: "bad" };
  if (/화상 데미지/.test(t)) return { side: ev.side, text: "화상", kind: "bad" };
  if (/독 데미지/.test(t)) return { side: ev.side, text: "독", kind: "bad" };
  if (/회복/.test(t)) return { side: ev.side, text: "회복!", kind: "up" };
  if (/잠들어/.test(t)) return { side: ev.side, text: "쿨쿨…", kind: "" };
  if (/풀이 죽어/.test(t)) return { side: ev.side, text: "풀이 죽었다", kind: "bad" };
  if (/몸이 저려/.test(t)) return { side: ev.side, text: "몸이 저리다!", kind: "bad" };
  if (/얼어붙어/.test(t)) return { side: ev.side, text: "꽁꽁", kind: "bad" };
  if (/자신을 공격/.test(t)) return { side: ev.side, text: "자기를 때렸다!", kind: "bad" };
  if (/아무 일도/.test(t)) return { side: ev.side, text: "…", kind: "" };
  if (/눈을 떴다|녹았다|풀렸다/.test(t)) return { side: ev.side, text: "회복!", kind: "up" };
  return null;
}

/**
 * 사건 목록을 두 창에 나눠 재생한다. send[i](msg) 가 i 쪽 창에 보낸다.
 * 펫끼리 결투와 야생 약하게 만들기가 같이 쓴다 — 받는 쪽이 펫 창이든 야생 창이든
 * 같은 duel.js 가 그린다.
 */
async function playDuel(send, r) {
  for (const ev of r.log) {
    if (ev.t === "move") {
      send[ev.side]({ t: "move", move: ev.move });
      await wait(ev.move.damageClass === "status" ? 1000 : 750);
    } else if (ev.t === "hp") {
      send[ev.side]({ t: "hp", hp: ev.hp, max: ev.max });
      const s = duelSay(ev);
      if (s) send[s.side]({ t: "say", text: s.text, kind: s.kind });
      await wait(500);
    } else if (ev.t === "faint") {
      send[ev.side]({ t: "faint" });
      await wait(900);
    } else if (ev.side >= 0) {
      if (ev.transform) {
        const p = await poke.spriteWithFallback({ dexId: ev.transform.dexId, isShiny: ev.transform.shiny }, CACHE, "anim").catch(() => null);
        if (p) send[ev.side]({ t: "transform", url: pathToFileURL(p).href });
        send[ev.side]({ t: "say", text: "변신!", kind: "up" });
        await wait(900);
        continue;
      }
      if (ev.status !== undefined) send[ev.side]({ t: "status", status: ev.status && ev.status !== "unconfused" ? ev.status : null });
      const s = duelSay(ev);
      if (s && s.text) {
        send[s.side]({ t: "say", text: s.text, kind: s.kind });
        await wait(650);
      }
    }
  }
}

/**
 * 바탕화면에서 싸운다.
 *
 * 승패와 보상은 결투 탭과 똑같이 startBattle 이 정한다(하루 상한 포함).
 * 여기서는 그 사건 목록을 두 펫 창에 나눠 재생하기만 한다.
 */
async function desktopBattle(idA, idB, level) {
  if (duel) return { ok: false, reason: "이미 바탕화면에서 결투 중입니다" };
  const r = startBattle(idA, idB, level);
  if (!r.ok) return r;
  const ids = [idA, idB];
  duel = { ids, temp: [] };
  if (win && !win.isDestroyed() && win.isVisible()) win.hide(); // 바탕화면이 보여야 한다

  try {
    petBusy = true;
    const recs = ids.map((id, n) => {
      let rec = pets.get(id);
      if (!rec || rec.win.isDestroyed()) {
        rec = createPet(id, n);
        duel.temp.push(id);
      }
      stopWander(id);
      rec.win.showInactive();
      return rec;
    });
    setTimeout(() => (petBusy = false), 250);
    await Promise.all(recs.map(whenLoaded));
    ids.forEach(stopWander); // 막 만든 창은 createPet 이 배회를 켜 둔다

    // 자리 — A 가 있던 화면에서, A 자리 근처에 나란히. 화면 밖으로 안 나가게 가둔다
    const w = petW();
    const gap = Math.round(w * 0.15);
    const pa = recs[0].win.getPosition();
    const area = screen.getDisplayNearestPoint({ x: pa[0], y: pa[1] }).workArea;
    const x0 = Math.min(Math.max(area.x, pa[0]), area.x + area.width - (2 * w + gap));
    const y0 = Math.min(Math.max(area.y, pa[1]), area.y + area.height - w);
    const f = r.fighters;

    // 서로 마주 본다 — 왼쪽(A)이 뒤집혀 오른쪽을 본다
    ids.forEach((id, i) => duelSend(id, { t: "start", flip: i === 0, name: f[i].name, level: f[i].level, hp: f[i].hp, max: f[i].maxHp }));
    await duelWalk(recs, [{ x: x0, y: y0 }, { x: x0 + w + gap, y: y0 }]);
    await wait(500);

    await playDuel(ids.map((id) => (m) => duelSend(id, m)), r);

    ids.forEach((id, i) => duelSend(id, { t: "end", result: r.winner == null ? "draw" : r.winner === i ? "win" : "lose" }));
    // 보상은 알림으로. 팝오버는 닫혀 있다
    if (save.notifyEnabled && Notification.isSupported()) {
      const who = r.winner == null ? "무승부" : f[r.winner].name + "의 승리!";
      const body = r.reward ? `${r.reward.name}(${r.reward.flavorName})을 얻었습니다` : r.winner != null && !r.rewardsLeft ? "오늘 받을 수 있는 보상은 다 받았습니다" : "";
      new Notification({ title: who, body, silent: true }).show();
    }
    await wait(3200);
    ids.forEach((id) => duelSend(id, { t: "clear" }));
  } catch (e) {
    console.error("[duel]", e.message);
    ids.forEach((id) => duelSend(id, { t: "clear" }));
  } finally {
    duel = null;
    // 잠깐 데려온 아이는 거두고, 원래 있던 아이는 다시 배회한다. 띄울 목록에 맞추는 게 그거다
    syncPets();
  }
  return r;
}

/* ---------------- 야생 포켓몬 ---------------- */

/**
 * 지금 나와 있는 야생 한 마리. null 이면 없다. 한 번에 한 마리만 나온다.
 *   win · ball  야생 창 · 몬스터볼 창
 *   pos         야생 창 자리 (매번 getPosition 을 부르지 않으려고 들고 있다)
 *   home        볼이 놓여 있는 자리. 빗나가면 여기로 돌아온다
 *   busy        볼이 날아가거나 흔들리는 중. 그동안은 걷지도, 볼을 잡지도 못한다
 */
let wildNow = null;
let wildTimer = null;

/** 이만큼 아무 입력이 없으면 자리를 비운 것으로 본다. 그때는 나오지 않고 미룬다 */
const WILD_AWAY_SEC = 300;
const BALL_W = 64;

/**
 * 볼. 보정은 원작 그대로다. 몬스터볼은 출현마다 공짜(wild.BALLS_PER_ENCOUNTER),
 * 슈퍼볼·하이퍼볼·마스터볼은 상점에서 사서 가방(save.balls)에 둔다.
 * 마스터볼은 무조건 잡힌다(wild.MASTER). 한 주에 1개만 산다.
 */
const BALLS = {
  poke: { name: "몬스터볼", mul: 1 },
  great: { name: "슈퍼볼", mul: 1.5 },
  ultra: { name: "하이퍼볼", mul: 2 },
  master: { name: "마스터볼", mul: wild.MASTER },
};
const BALL_ORDER = ["poke", "great", "ultra", "master"];

/** 지금 이 볼을 몇 개 던질 수 있나 */
function ballsLeft(W, key) {
  if (key === "poke") return W.balls;
  return ((save.balls || {})[key]) || 0;
}

/** 볼 창에 지금 고른 볼·남은 수·잡힐 확률을 알린다 */
function ballInfo() {
  const W = wildNow;
  if (!W) return;
  ballSend({ t: "set", key: W.ballKey, name: BALLS[W.ballKey].name, n: ballsLeft(W, W.ballKey), p: wildOdds(W) });
}

/**
 * 남은 볼이 있는 다음 종류로. 없으면 그대로.
 * auto(던진 볼이 떨어져 저절로 바꿀 때)면 마스터볼은 건너뛴다 — 다른 볼이 하나도 없을 때만.
 * 한 주에 하나뿐인 마스터볼을 아무 포켓몬에게나 모르고 던지지 않게, 마스터볼은 눌러서 고른다
 */
function nextBall(W, from = W.ballKey, auto = false) {
  const i = BALL_ORDER.indexOf(from);
  let master = null;
  for (let k = 1; k <= BALL_ORDER.length; k++) {
    const key = BALL_ORDER[(i + k) % BALL_ORDER.length];
    if (ballsLeft(W, key) <= 0) continue;
    if (auto && key === "master") { master = key; continue; }
    return key;
  }
  return master || from;
}

/** 오늘 더 나올 수 있는 횟수 */
function wildLeftToday() {
  const p = wild.PACE[save.wildLevel || "rare"];
  if (!p) return 0;
  if (save.wildDay !== todayKey()) return p.cap;
  return Math.max(0, p.cap - (save.wildCount || 0));
}

/** 다음 출현을 잡는다. ms 를 주면 그만큼 뒤에 다시 본다(미룰 때) */
function scheduleWild(ms) {
  clearTimeout(wildTimer);
  wildTimer = null;
  const d = ms ?? wild.nextDelay(save.wildLevel || "rare");
  if (d == null) return;
  wildTimer = setTimeout(tryWild, d);
}

function tryWild() {
  wildTimer = null;
  if (!wild.PACE[save.wildLevel || "rare"]) return;
  // 방해 금지 시간이면 끝난 뒤로 미룬다. 끝나자마자 튀어나오면 그것도 돌발이 아니라 알람이다
  const quiet = wild.quietEndsIn(new Date(), save.wildQuiet);
  if (quiet) return scheduleWild(quiet + Math.round((5 + Math.random() * 25) * 60_000));
  // 이미 나와 있거나 결투 중이거나 자리를 비웠으면 잠시 뒤에 다시 본다
  if (wildNow || duel || powerMonitor.getSystemIdleTime() > WILD_AWAY_SEC) return scheduleWild(10 * 60_000);
  // 오늘 몫을 다 썼으면 평소 간격 뒤에 다시 본다 — 날이 바뀌면 다시 찬다
  if (wildLeftToday()) spawnWild().catch((e) => console.error("[wild]", e.message));
  scheduleWild();
}

const wildSend = (msg) => wildNow && !wildNow.win.isDestroyed() && wildNow.win.webContents.send("wild", msg);
const ballSend = (msg) => wildNow && !wildNow.ball.isDestroyed() && wildNow.ball.webContents.send("ball", msg);

/** 펫 창과 같은 투명 창 */
function overlayWindow(file, width, height, x, y) {
  const w = new BrowserWindow({
    width, height, x, y,
    show: false, frame: false, transparent: true, hasShadow: false,
    resizable: false, skipTaskbar: true, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true },
  });
  w.setAlwaysOnTop(true, "screen-saver");
  w.loadFile(path.join(__dirname, "..", "renderer", file));
  w.webContents.on("console-message", logConsole(file));
  return w;
}

const loaded = (w) => new Promise((r) => (w.webContents.isLoading() ? w.webContents.once("did-finish-load", r) : r()));

/** 야생 창을 걸어서 옮긴다. 걷는 중에 새로 걸으라고 하면 앞의 걸음은 멈춘다 */
async function walkWild(to, ms) {
  const W = wildNow;
  if (!W) return;
  const id = (W.walkId = (W.walkId || 0) + 1);
  const from = { ...W.pos };
  wildSend({ t: "face", dir: Math.sign(to.x - from.x) || 1 });
  const N = Math.max(1, Math.round(ms / 16));
  for (let k = 1; k <= N; k++) {
    if (wildNow !== W || W.walkId !== id || W.win.isDestroyed()) return;
    const t = k / N;
    W.pos = { x: Math.round(from.x + (to.x - from.x) * t), y: Math.round(from.y + (to.y - from.y) * t) };
    W.win.setBounds({ x: W.pos.x, y: W.pos.y, width: petW(), height: petW() });
    await wait(16);
  }
}

/** 볼 창을 옮긴다. 좌표는 볼의 왼쪽 위 */
function placeBall(x, y) {
  const W = wildNow;
  if (!W || W.ball.isDestroyed()) return;
  W.ballPos = { x: Math.round(x), y: Math.round(y) };
  W.ball.setBounds({ ...W.ballPos, width: BALL_W, height: BALL_W });
}

async function slideBall(to, ms) {
  const W = wildNow;
  if (!W) return;
  const from = { ...W.ballPos };
  const N = Math.max(1, Math.round(ms / 16));
  for (let k = 1; k <= N; k++) {
    if (wildNow !== W) return;
    const e = 1 - Math.pow(1 - k / N, 2);
    placeBall(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
    await wait(16);
  }
}

/**
 * 한 마리 불러낸다. 자동 출현과 트레이 메뉴의 "부르기"가 같이 쓴다 —
 * 메뉴로 부른 것도 하루 몫에서 빠진다. 안 그러면 메뉴가 공짜 알 버튼이 된다.
 */
async function spawnWild() {
  if (wildNow) return { ok: false, reason: "이미 야생 포켓몬이 나와 있습니다" };
  if (!wildLeftToday()) return { ok: false, reason: "오늘은 더 나오지 않습니다" };
  if (save.wildDay !== todayKey()) { save.wildDay = todayKey(); save.wildCount = 0; }
  save.wildCount = (save.wildCount || 0) + 1;
  writeSave();

  const r = wild.roll(save.charm);
  // 부화한 모습(첫 형태)으로 나온다. 잡으면 그 모습 그대로 박스에 들어간다
  const d = poke.describe(poke.STAGES[1].at, r.line, { shiny: r.shiny });
  const sprite = await poke.spriteWithFallback(d, CACHE, "anim");
  const isNew = (save.maxStage[r.line] ?? -1) < 1; // 이 종을 만난 적이 없다 — 놓치기 아까운 아이

  // 커서가 있는 화면에 나온다. 보고 있는 화면이어야 알아챈다
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const w = petW();
  const fromLeft = Math.random() < 0.5;
  const y = Math.round(area.y + area.height * 0.3 + Math.random() * Math.max(0, area.height * 0.7 - w));
  const start = { x: fromLeft ? area.x - w : area.x + area.width, y };
  const spot = { x: Math.round(area.x + w + Math.random() * Math.max(0, area.width - 3 * w)), y };
  /*
   * 볼은 화면 아래 가운데에 둔다. 처음엔 오른쪽 아래였는데, 거기는 "나타났다!" 알림이
   * 몇 초 동안 덮는 자리다 — 알림을 보고 볼을 찾으면 볼이 알림 밑에 있었다.
   */
  const home = { x: Math.round(area.x + area.width / 2 - BALL_W / 2), y: area.y + area.height - BALL_W - 16 };

  wildNow = {
    ...r,
    rate: poke.rarityOf(r.line).captureRate,
    name: d.name,
    area,
    pos: { ...start },
    home,
    ballPos: { ...home },
    balls: wild.BALLS_PER_ENCOUNTER,
    ballKey: "poke",
    busy: false,
    win: overlayWindow("wild.html", w, w, start.x, start.y),
    ball: overlayWindow("ball.html", BALL_W, BALL_W, home.x, home.y),
  };
  const W = wildNow;
  await Promise.all([loaded(W.win), loaded(W.ball)]);
  if (wildNow !== W) return { ok: false };
  wildSend({ t: "init", url: sprite ? pathToFileURL(sprite).href : null, name: d.name, shiny: r.shiny, isNew });
  ballInfo();
  W.win.showInactive();
  W.ball.showInactive();

  if (save.notifyEnabled && Notification.isSupported()) {
    const L = poke.LINES[r.line] || {};
    new Notification({
      title: L.legendary && L.single
        ? `✨ ${L.mythical ? "환상" : "전설"}의 포켓몬 ${battle.josa(d.name, "이가")} 나타났다!`
        : `야생 ${r.shiny ? "★ " : ""}${battle.josa(d.name, "이가")} 나타났다!`,
      body: (L.legendary && L.single ? "아주 잡기 어렵습니다. 결투로 약하게 만들고 하이퍼볼을 쓰세요(마스터볼이면 반드시 잡힙니다). " : "") + (isNew ? "처음 보는 포켓몬입니다. " : "") + "화면 아래 몬스터볼을 잡고 던져 보세요",
      silent: false,
    }).show();
  }

  await walkWild(spot, 2600);
  // 가만히 있지 않는다. 가끔 자리를 옮겨서 던지는 맛이 있게
  W.wander = setInterval(() => {
    if (wildNow !== W || W.busy || Date.now() < (W.holdUntil || 0)) return;
    const nx = Math.min(Math.max(area.x, W.pos.x + Math.round((Math.random() - 0.5) * 260)), area.x + area.width - w);
    const ny = Math.min(Math.max(area.y, W.pos.y + Math.round((Math.random() - 0.5) * 120)), area.y + area.height - w);
    walkWild({ x: nx, y: ny }, 1400);
  }, 8000 + Math.random() * 4000);
  W.leave = setTimeout(() => wildFlee("떠나 버렸다…"), wild.STAY_MS);
  return { ok: true };
}

/** 끝. 창을 거두고 다음 출현을 기다린다 */
function endWild() {
  const W = wildNow;
  if (!W) return;
  clearInterval(W.wander);
  clearTimeout(W.leave);
  wildNow = null;
  for (const x of [W.win, W.ball]) if (!x.isDestroyed()) x.destroy();
}

/** 도망친다 — 가까운 화면 가장자리로 뛰어 나간다 */
async function wildFlee(text) {
  const W = wildNow;
  if (!W || W.fleeing) return;
  W.fleeing = W.busy = true;
  if (!W.ball.isDestroyed()) W.ball.hide();
  wildSend({ t: "gone", text });
  const w = petW();
  const left = W.pos.x + w / 2 < W.area.x + W.area.width / 2;
  await walkWild({ x: left ? W.area.x - w : W.area.x + W.area.width, y: W.pos.y }, 900);
  if (wildNow === W) endWild();
}

/**
 * 던졌다 — 겨눈 방향으로 날아가며 포물선을 그린다.
 *
 * 처음엔 놓는 순간의 속도에 중력만 얹었다. 손으로 휙 던지면 0.3초 만에 도착해서
 * 휘어질 틈이 없었고, 직선으로 쏘는 것처럼 보였다. 중력을 세게 하면 이번엔 공이
 * 겨눈 곳 아래로 떨어져 안 맞는다.
 *
 * 그래서 둘을 나눈다:
 *   바닥 길  겨눈 방향 그대로 곧게 간다. 맞았는지는 이 길로 판정한다 — 맞히기 난이도는 그대로
 *   높이     그 위에 포물선을 얹는다. 겨눈 선이 야생 근처를 지나면 야생 자리에서 내려앉도록,
 *            아니면 적당한 거리에서 내려앉도록 높이를 정한다
 * 속도는 조금 줄여서(0.75배, 최대 프레임당 30px) 날아가는 게 눈에 보이게 한다.
 */
async function flyBall(vx, vy) {
  const W = wildNow;
  if (!W) return;
  const MAX = 30;
  vx *= 0.75;
  vy *= 0.75;
  let sp = Math.hypot(vx, vy);
  if (sp > MAX) { vx = (vx / sp) * MAX; vy = (vy / sp) * MAX; sp = MAX; }
  if (ballsLeft(W, W.ballKey) <= 0) {
    // 고른 볼이 없다 — 던지지 않고 제자리로
    slideBall(W.home, 300).then(() => wildNow === W && ballSend({ t: "land" }));
    return;
  }
  W.busy = true;
  W.thrown = W.ballKey;
  ballSend({ t: "fly" });
  let x = W.ballPos.x;
  let y = W.ballPos.y;
  const w = petW();
  const a = W.area;

  // 야생 위에 바로 놓았으면 그대로 맞은 걸로 친다 — 포물선으로 머리 위를 넘겨 버리면 억울하다
  {
    const cx = x + BALL_W / 2;
    const cy = y + BALL_W / 2;
    const m = w * 0.18;
    if (!W.fleeing && cx > W.pos.x + m && cx < W.pos.x + w - m && cy > W.pos.y + m && cy < W.pos.y + w - m * 0.3) return hitWild();
  }

  // 겨눈 선 위에서 야생까지의 거리 — 선이 야생 근처를 지나면 거기서 내려앉는다
  const ux = vx / sp;
  const uy = vy / sp;
  const dx = W.pos.x + w / 2 - (x + BALL_W / 2);
  const dy = W.pos.y + w / 2 - (y + BALL_W / 2);
  const along = dx * ux + dy * uy;
  const off = Math.abs(dx * uy - dy * ux);
  const D = along > 0 && off < w ? along : Math.max(320, sp * 28);
  const H = Math.min(180, Math.max(50, D * 0.35)); // 멀리 던질수록 높이 뜬다
  let d = 0;

  // 맞았나 — 공 가운데가 야생 창 안쪽(가장자리 18%를 뺀)에 들어왔나
  const inWild = (cx, cy) => {
    const m = w * 0.18;
    return !W.fleeing && cx > W.pos.x + m && cx < W.pos.x + w - m && cy > W.pos.y + m && cy < W.pos.y + w - m * 0.3;
  };

  // 1) 포물선 — 겨눈 지점까지
  let h = 0;
  while (d < D) {
    if (wildNow !== W) return;
    x += vx;
    y += vy;
    d += sp;
    const t = Math.min(1, d / D);
    h = 4 * H * t * (1 - t);
    placeBall(x, y - h);
    // 아직 높이 떠 있을 때(올라가는 중)는 머리 위로 넘어간다
    if (h < H * 0.45 && t > 0.5 && inWild(x + BALL_W / 2, y + BALL_W / 2)) return hitWild();
    if (x + BALL_W / 2 < a.x - BALL_W || x + BALL_W / 2 > a.x + a.width + BALL_W || y - h < a.y - BALL_W * 3) break;
    await wait(16);
  }

  /*
   * 2) 빗나갔다 — 그대로 떨어진다. 처음엔 겨눈 지점에 "착지"시켜 굴렸는데, 허공에서
   * 보이지 않는 바닥에 걸려 튕기는 것처럼 보였다. 화면 바닥(작업표시줄 윗선)까지
   * 중력으로 떨어져 통통 튀다가 사라진다. 떨어지다 야생 몸에 닿으면 그것도 맞은 거다.
   */
  const floor = a.y + a.height - BALL_W;
  let py = y - h;
  let fvx = vx;
  let fvy = vy + (4 * H * sp) / D; // 포물선이 내려오던 빠르기를 그대로 잇는다
  const G = 0.9;
  let bounces = 0;
  for (let f = 0; f < 240; f++) {
    if (wildNow !== W) return;
    x += fvx;
    py += fvy;
    fvy += G;
    if (py >= floor) {
      py = floor;
      fvy = -fvy * 0.45; // 튈 때마다 낮아진다
      fvx *= 0.7;
      bounces++;
      if (bounces >= 3 || Math.abs(fvy) < 2.5) { placeBall(x, py); break; }
    }
    placeBall(x, py);
    if (bounces === 0 && inWild(x + BALL_W / 2, py + BALL_W / 2)) return hitWild();
    if (x + BALL_W / 2 < a.x - BALL_W || x + BALL_W / 2 > a.x + a.width + BALL_W) break; // 화면 밖으로 굴러 나갔다
    await wait(16);
  }

  // 3) 스르르 사라졌다가 제자리에 다시 나타난다. 볼은 잃지 않는다 —
  //    던지는 솜씨로 볼을 잃으면 마우스가 서툰 사람만 손해다
  ballSend({ t: "vanish" });
  await wait(450);
  if (wildNow !== W) return;
  placeBall(W.home.x, W.home.y);
  ballSend({ t: "land" });
  W.busy = false;
}

/** 맞았다 — 빨려 들어가고, 떨어지고, 세 번 흔들린다 */
async function hitWild() {
  const W = wildNow;
  const w = petW();
  ballSend({ t: "hit" });
  placeBall(W.pos.x + w / 2 - BALL_W / 2, W.pos.y + w * 0.3);
  wildSend({ t: "absorb" });
  await wait(600);
  await slideBall({ x: W.pos.x + w / 2 - BALL_W / 2, y: W.pos.y + w - BALL_W }, 260);
  await wait(400);

  const st = W.state || {};
  const res = wild.throwBall(W.rate, BALLS[W.thrown].mul, st.hp ?? 1, CATCH_STATUS[st.status] || 1);
  /*
   * 흔들림. 원작처럼 "흔들 — 멈칫 — 흔들 — 멈칫" 리듬을 준다. 흔들림 자체는 0.7초,
   * 그 뒤 잠깐 멈춰 있어야 몇 번째인지 셀 수 있다. 다 버티면 한 번 더 멈췄다가 딸깍.
   */
  for (let i = 0; i < res.shakes; i++) {
    if (wildNow !== W) return;
    ballSend({ t: "shake" });
    await wait(1250);
  }
  if (res.caught) await wait(300);
  if (wildNow !== W) return;
  if (W.thrown === "poke") W.balls -= 1;
  else { save.balls[W.thrown] = Math.max(0, (save.balls[W.thrown] || 0) - 1); writeSave(); }

  if (res.caught) {
    ballSend({ t: "caught" });
    catchWild(W);
    await wait(1800);
    if (wildNow === W) endWild();
    return;
  }

  // 튀어나왔다
  ballSend({ t: "open" });
  wildSend({ t: "out", text: res.shakes === 2 ? "아깝다! 조금만 더…" : "튀어나왔다!" });
  await wait(900);
  if (wildNow !== W) return;
  if (!BALL_ORDER.some((k) => ballsLeft(W, k) > 0)) return wildFlee("볼이 다 떨어졌다… 도망쳤다");
  if (Math.random() < wild.fleeChance(W.rate)) return wildFlee("도망쳐 버렸다!");
  if (ballsLeft(W, W.ballKey) <= 0) W.ballKey = nextBall(W, W.ballKey, true);
  ballInfo();
  await slideBall(W.home, 400);
  if (wildNow !== W) return;
  ballSend({ t: "land" });
  W.busy = false;
}

/**
 * 상태이상 포획 보정 (5세대). 잠듦·얼음 2.5배, 마비·화상·독 1.5배.
 * 혼란은 주요 상태이상이 아니라 보정이 없다.
 */
const CATCH_STATUS = { sleep: 2.5, freeze: 2.5, paralysis: 1.5, burn: 1.5, poison: 1.5 };

/** 지금 던지면 얼마나 잡히나 — 볼 창에 보여 준다 */
function wildOdds(W, ballKey = W.ballKey || "poke") {
  const st = W.state || {};
  return wild.odds(W.rate, BALLS[ballKey].mul, st.hp ?? 1, CATCH_STATUS[st.status] || 1).total;
}

/**
 * 내 펫으로 약하게 만든다 — 바탕화면에서 펫을 끌어 야생 위에 놓으면 시작한다.
 *
 * 원작의 핵심이다. 체력이 가득이면 a = 포획률 × 볼 / 3 이지만, 빨간 체력이면
 * 거의 세 배가 된다. 잠들게 하거나 마비시키면 더 잘 잡힌다.
 *
 * 펫은 야생 체력이 40% 아래로 떨어지면 공격을 멈춘다. 쓰러뜨릴 것 같은 기술은
 * 웬만하면 안 고르고 상태이상 기술을 즐겨 쓴다(battle.js gentle). 그래도 급소로
 * 넘칠 수 있다 — 쓰러지면 잡을 수 없다. 그 긴장이 재미다.
 *
 * 둘 다 Lv.50 이다. 야생은 레벨이 없다(부화한 모습으로 나온다). 깎인 체력과
 * 상태이상은 야생이 들고 있다가 다음 결투와 포획에 그대로 쓴다.
 */
async function wildBattle(petId) {
  const W = wildNow;
  const pm = box.find(save.box, petId);
  const rec = pets.get(petId);
  if (!W || W.busy || W.fleeing || duel || !pm || !rec) return false;
  const grown = box.effOf(pm, growthSpeed());
  if (!poke.stageFor(grown)) return false; // 알은 못 싸운다

  W.busy = true;
  W.walkId = (W.walkId || 0) + 1; // 걷던 걸음을 멈춘다
  // 야생의 개체값·성격은 처음 싸울 때 정해 두고 계속 쓴다 — 잡으면 이 아이가 박스에 들어간다
  W.mon = W.mon || box.make(W.line, W.nature, W.shiny);
  const r = battle.run(box.withLv(pm, growthSpeed()), grown, W.mon, poke.STAGES[1].at, Math.random, {
    level: 50,
    gentle: 0,
    init: [null, W.state || null],
    stop: (F) => F[1].hp <= F[1].maxHp * 0.4,
  });
  if (!r) { W.busy = false; return false; }

  duel = { ids: [petId], temp: [] }; // 싸우는 동안 syncPets 가 이 펫을 건드리지 않게
  try {
    stopWander(petId);
    const w = petW();
    const gap = Math.round(w * 0.1);
    // 야생 옆에 선다. 왼쪽에 자리가 없으면 오른쪽에
    const left = W.pos.x - w - gap >= W.area.x;
    const to = { x: left ? W.pos.x - w - gap : W.pos.x + w + gap, y: W.pos.y };
    const f = r.fighters;
    const wildDuel = (m) => !W.win.isDestroyed() && W.win.webContents.send("duel", m);
    duelSend(petId, { t: "start", flip: left, name: f[0].name, level: f[0].level, hp: f[0].hp, max: f[0].maxHp });
    wildDuel({ t: "start", flip: !left, name: "야생 " + f[1].name, level: f[1].level, hp: f[1].hp, max: f[1].maxHp });
    await duelWalk([rec], [to]);
    await wait(400);

    await playDuel([(m) => duelSend(petId, m), wildDuel], r);

    const e = r.end[1];
    if (e.hp <= 0) {
      // 쓰러뜨렸다 — 잡을 수 없다
      duelSend(petId, { t: "end", result: "win" });
      await wait(1200);
      duelSend(petId, { t: "clear" });
      W.busy = false;
      wildFlee("쓰러져서 잡을 수 없다…");
      return true;
    }
    W.state = { hp: e.hp / e.max, status: e.status };
    duelSend(petId, { t: "end", result: r.end[0].hp <= 0 ? "lose" : "stay" });
    if (r.end[0].hp > 0) duelSend(petId, { t: "say", text: "지금 던져!", kind: "win" });
    wildDuel({ t: "end", result: "stay" });
    ballInfo(); // 깎인 만큼 잡힐 확률이 올랐다
    await wait(2200);
    duelSend(petId, { t: "clear" });
  } catch (err) {
    console.error("[wild-battle]", err.message);
    duelSend(petId, { t: "clear" });
  } finally {
    duel = null;
    syncPets();
    if (wildNow === W && !W.fleeing) W.busy = false;
  }
  return true;
}

/** 잡았다 — 박스에 넣는다. 이미 부화한 모습이다 */
function catchWild(W) {
  // 싸워 본 아이면 그때 정해진 개체값·성격 그대로 들어간다
  const m = W.mon || box.make(W.line, W.nature, W.shiny);
  m.fed = poke.STAGES[1].at;
  m.maxStage = 1;
  m.wild = true; // 알이 아니라 바탕화면에서 잡은 아이
  save.box.push(m);
  if (!save.seen.includes(W.line)) save.seen.push(W.line);
  save.maxStage[W.line] = Math.max(save.maxStage[W.line] ?? -1, 1);
  writeSave();
  refresh(true);
  pushDex();
  if (save.notifyEnabled && Notification.isSupported()) {
    new Notification({ title: `${W.shiny ? "★ " : ""}${battle.josa(W.name, "을를")} 잡았다!`, body: "박스에 들어갔습니다", silent: true }).show();
  }
}

/* ---------------- 앱 ---------------- */

function buildMenu() {
  const lvl = (label, key) => ({
    label,
    type: "radio",
    checked: save.wanderLevel === key,
    click: () => setWanderLevel(key),
  });
  return Menu.buildFromTemplate([
    { label: save.petVisible ? "펫 숨기기" : "바탕화면에 펫 띄우기", click: () => togglePet() },
    {
      label: "펫 움직임",
      submenu: [lvl("가만히 있기", "off"), lvl("가끔 (기본)", "rare"), lvl("자주", "often")],
    },
    { type: "separator" },
    {
      // 기다리지 않고 바로 불러낸다. 오늘 몫에서 빠진다
      label: wildNow
        ? "🌿 야생 포켓몬이 나와 있습니다"
        : "🌿 야생 포켓몬 부르기 (" + (wild.inQuiet(new Date(), save.wildQuiet) ? "방해 금지 중 · " : "") + "오늘 " + wildLeftToday() + "번 남음)",
      enabled: !wildNow && !duel && wildLeftToday() > 0,
      click: () => spawnWild().catch((e) => console.error("[wild]", e.message)),
    },
    { label: "🍬 상점 (사탕 " + candy().left + ")", click: openShop },
    { label: "📖 도감 열기", click: openDex },
    { label: "⚙️ 설정", click: openSettings },
    { label: "새로고침", click: () => refresh(true) },
    { type: "separator" },
    { label: "종료", click: () => app.quit() },
  ]);
}

/**
 * 한 벌만 뜨게 한다.
 *
 * 이게 없어서 실행할 때마다 완전히 독립된 앱이 하나씩 더 떴다. 각자
 * 트레이 아이콘과 각자의 메모리 상태를 갖고, 같은 save.json 에 서로
 * 덮어썼다. 설치 중에 세이브를 못 읽고 뜬 인스턴스가 계속 살아남아
 * 화면에는 없던 포켓몬이, 파일에는 원래 박스가 있는 상태가 됐다.
 *
 * 트레이 앱은 창을 닫아도 살아 있으니 "이미 떠 있나"를 사용자가 알기
 * 어렵다. 두 번째 실행은 조용히 죽고 원래 창을 띄워 준다.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // 또 눌렀다는 건 보고 싶다는 뜻이다
    if (win && !win.isDestroyed()) showNearTray();
  });

app.whenReady().then(async () => {
  loadSave();

  /*
   * 첫 알도, 0.1.x 세이브를 옮기는 것도 buildStats 에서 한다.
   * 둘 다 "지금 누적 토큰이 얼마인가"를 알아야 하는데 그건 로그를
   * 읽어봐야 나온다. 여기서 미리 하면 스캔을 두 번 하게 된다.
   */

  // Windows 트레이는 빈 아이콘을 받으면 아무것도 표시하지 않는다.
  tray = new Tray(getLogo() ?? nativeImage.createEmpty());
  tray.setToolTip("PokeTokenBar — 불러오는 중…");

  createWindow();
  tray.on("click", () => (win.isVisible() ? win.hide() : showNearTray()));
  tray.on("right-click", () => tray.popUpContextMenu(buildMenu()));

  // on 핸들러는 event 객체를 첫 인자로 넘긴다. 그대로 두면 force=truthy가 된다.
  ipcMain.on("request-stats", () => refresh());
  // 사용자가 직접 부르는 갱신은 3초 창을 건너뛰고 디스크를 다시 읽는다
  ipcMain.on("refresh-now", () => refresh(true));
  /**
   * 한도 보정 — 퍼센트를 받아 한도를 역산한다.
   *
   * 사용자가 넣을 수 있는 건 토큰 수가 아니라 퍼센트다. Claude는
   * 토큰 단위 한도를 공개하지 않고 /usage 도 %만 보여준다.
   * 그런데 쓴 양은 우리가 정확히 알고 있으니 분모를 되돌릴 수 있다:
   *
   *   한도 = 쓴 양 / (퍼센트 / 100)
   *
   * 한 번 맞춰 두면 그 뒤로는 계속 막대가 나온다.
   */
  ipcMain.handle("calibrate-limit", (_e, { src, win: w, percent }) => {
    const pct = Number(percent);
    if (!Number.isFinite(pct) || pct < 1 || pct > 100) {
      return { ok: false, error: "1에서 100 사이로 넣어 주세요." };
    }
    const p = lastStats && lastStats.limits && (lastStats.limits.perSource || {})[src];
    if (!p) return { ok: false, error: "아직 사용 기록을 읽지 못했습니다." };

    const used = w === "block" ? (p.block && p.block.used) || 0 : p.week || 0;
    if (!used) {
      // 쓴 게 0이면 분자가 0이라 역산이 안 된다. 조용히 이상한 값을 넣지 않는다.
      return { ok: false, error: "이 구간에 쓴 기록이 없어 역산할 수 없습니다." };
    }
    const limit = Math.round(used / (pct / 100));
    save.limits = save.limits || {};
    save.limits[src] = { ...(save.limits[src] || {}), [w]: limit };
    writeSave();
    refresh(true);
    pushSettings();
    return { ok: true, limit, used };
  });
  ipcMain.on("quit", () => app.quit());
  ipcMain.on("hide-popover", () => win && !win.isDestroyed() && win.hide());
  ipcMain.on("toggle-pet", () => togglePet());
  ipcMain.on("open-shop", openShop);
  ipcMain.on("request-shop", () => pushShop());
  ipcMain.handle("buy", (_e, id) => buy(id));
  ipcMain.on("open-dex", openDex);
  ipcMain.on("request-dex", () => pushDex());
  /** 박스: 키우는 아이 바꾸기 */
  ipcMain.on("set-active", (_e, id) => {
    if (!box.find(save.box, id)) return; // 렌더러가 보낸 값을 그대로 믿지 않는다
    save.activeId = id;
    writeSave();
    refresh(true);
    pushDex();
  });

  /** 박스: 바탕화면에 띄울지 토글 */
  ipcMain.on("toggle-pet-member", (_e, id) => togglePetMember(id));

  /** 박스: 놓아주기 */
  ipcMain.handle("battle", (_e, { a, b, level } = {}) => startBattle(a, b, level));
  // 바탕화면 결투는 재생이 끝난 뒤에 돌아온다. 그때 탭이 로그를 채운다
  ipcMain.handle("battle-desktop", (_e, { a, b, level } = {}) => desktopBattle(a, b, level));

  /*
   * 몬스터볼 끌기. 펫 드래그처럼 화면 좌표만 받고 창은 여기서 옮긴다.
   * 놓는 순간의 속도는 마지막 100ms 동안 움직인 거리로 잰다 — 마지막 한 칸만
   * 보면 손을 떼며 멈칫한 것까지 속도가 되어 볼이 툭 떨어진다.
   */
  ipcMain.handle("wild-spawn", () => spawnWild());
  const okPt = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
  ipcMain.on("ball-drag-start", (_e, p) => {
    const W = wildNow;
    if (!W || W.busy || !okPt(p)) return;
    W.drag = [{ ...p, t: Date.now() }];
    // 볼을 잡으면 야생이 멈칫 선다. 걷는 중에 던지면 날아가는 사이 자리를 옮겨서
    // 겨눈 곳에 떨어진 볼이 빗나갔다 — 원작에서도 던질 때 상대는 서 있다
    W.walkId = (W.walkId || 0) + 1;
    W.holdUntil = Date.now() + 4000;
  });
  ipcMain.on("ball-drag", (_e, p) => {
    const W = wildNow;
    if (!W || !W.drag || !okPt(p)) return;
    W.drag.push({ ...p, t: Date.now() });
    if (W.drag.length > 12) W.drag.shift();
    placeBall(p.x - BALL_W / 2, p.y - BALL_W / 2);
  });
  // 끌지 않고 누르기만 하면 볼 종류를 바꾼다
  ipcMain.on("ball-click", () => {
    const W = wildNow;
    if (!W || W.busy) return;
    W.drag = null;
    W.ballKey = nextBall(W);
    ballInfo();
    slideBall(W.home, 1);
  });
  ipcMain.on("ball-drag-end", (_e, p) => {
    const W = wildNow;
    if (!W || !W.drag) return;
    const hist = W.drag;
    W.drag = null;
    if (okPt(p)) hist.push({ ...p, t: Date.now() });
    const last = hist[hist.length - 1];
    const first = hist.find((h) => last.t - h.t <= 100) || hist[0];
    const dt = Math.max(1, last.t - first.t);
    const vx = ((last.x - first.x) / dt) * 16;
    const vy = ((last.y - first.y) / dt) * 16;
    // 거의 안 움직였으면 던진 게 아니라 내려놓은 것이다 — 제자리로
    if (Math.hypot(vx, vy) < 4) {
      slideBall(W.home, 300).then(() => wildNow === W && ballSend({ t: "land" }));
      return;
    }
    flyBall(vx, vy);
  });
  ipcMain.handle("guild-create", (_e, a) => guildCreate(a));
  ipcMain.handle("guild-join", (_e, a) => guildJoin(a));
  ipcMain.handle("guild-leave", () => guildLeave());
  ipcMain.handle("guild-kick", (_e, id) => guildKick(String(id || "")));
  ipcMain.handle("guild-view", () => guildView());
  ipcMain.handle("guild-share", (_e, on) => guildShare(on));
  ipcMain.handle("guild-rename", (_e, trainer) => guildRename(trainer));
  ipcMain.handle("guild-list", () => guildList());
  ipcMain.handle("guild-listing", (_e, a) => guildListing(a));
  ipcMain.handle("hall-donate", (_e, a) => hallDonate(a));
  ipcMain.handle("hall-theme", (_e, theme) => hallTheme(theme));
  // 코인 지갑 · 상점에 팔기 · 길드 몰
  ipcMain.handle("wallet-info", () => walletInfo());
  ipcMain.handle("wallet-checkin", () => walletCheckin());
  ipcMain.handle("wallet-exchange", (_e, n) => walletExchange(n));
  ipcMain.handle("wallet-buy-candy", (_e, n) => walletBuyCandy(n));
  ipcMain.handle("shop-sell", (_e, id) => shopSell(String(id || "")));
  ipcMain.handle("market-view", () => marketView());
  ipcMain.handle("market-list", (_e, a) => marketList(a || {}));
  ipcMain.handle("market-buy", (_e, id) => marketBuy(String(id || "")));
  ipcMain.handle("market-cancel", (_e, id) => marketCancel(String(id || "")));
  ipcMain.handle("guild-battle", (_e, id) => guildBattle(String(id || "")));
  ipcMain.handle("room-buy", (_e, { kind, id } = {}) => roomBuy(kind, id));
  ipcMain.handle("room-coins", () => roomCoins());
  ipcMain.handle("statue-image", (_e, dexId) => statueImage(dexId));
  ipcMain.handle("room-set", (_e, patch) => roomSet(patch || {}));
  ipcMain.handle("toggle-stone", (_e, id) => toggleStone(id));
  ipcMain.handle("feed-berry", (_e, { id, key } = {}) => feedBerry(id, key));
  ipcMain.handle("friend-register", (_e, { id, trainer } = {}) => friendRegister(id, trainer));
  ipcMain.handle("friend-inspect", (_e, code) => friendInspect(code));
  ipcMain.handle("friend-battle", (_e, code) => friendBattle(code));
  // 실시간 배틀 — 고른 아이로 코드를 만들고(방 안에서 바꿔도 된다), 그 코드로 싸운다
  ipcMain.handle("live-team", (_e, id) => liveRegister(id));
  ipcMain.handle("live-battle", (_e, code) => friendBattle(code, { live: true }));
  ipcMain.handle("trade-send", (_e, id) => tradeSend(id));
  ipcMain.handle("trade-inspect", (_e, code) => tradeInspect(code));
  ipcMain.handle("trade-receive", (_e, code) => tradeReceive(code));
  ipcMain.handle("release", (_e, id) => {
    const m = box.find(save.box, id);
    if (!m) return { ok: false, reason: "없는 아이" };
    if (save.box.length <= 1) return { ok: false, reason: "마지막 한 마리는 놓아줄 수 없습니다" };
    if (m.hold === "everstone") save.items = { ...(save.items || {}), everstone: stoneCount() + 1 }; // 돌은 가방으로
    save.box = save.box.filter((x) => x.id !== id);
    save.petIds = save.petIds.filter((x) => x !== id);
    if (save.activeId === id) save.activeId = save.box[0].id;
    destroyPet(id);
    writeSave();
    syncPets();
    refresh(true);
    pushDex();
    return { ok: true };
  });
  ipcMain.on("open-settings", openSettings);
  ipcMain.on("request-settings", () => pushSettings());
  ipcMain.on("set-settings", (_e, patch) => applySettings(patch || {}));
  ipcMain.on("close-settings", () => setWin && !setWin.isDestroyed() && setWin.close());
  ipcMain.on("open-data-folder", () => shell.openPath(app.getPath("userData")));

  /**
   * 데이터 폴더를 바꾼다. 실행 파일 옆의 data-dir.txt 에 적어 두고
   * 다음 실행부터 적용한다 — 돌고 있는 상태에서 밑을 바꾸면 창마다
   * 다른 세이브를 들고 있게 된다.
   */
  ipcMain.handle("set-data-dir", async (_e, { reset } = {}) => {
    if ((process.env.POKETOKENBAR_DATA || "").trim()) {
      return { ok: false, reason: "POKETOKENBAR_DATA 환경변수가 우선합니다. 그걸 지우고 다시 시도하세요." };
    }
    let dir = "";
    if (!reset) {
      const r = await dialog.showOpenDialog(setWin || win, {
        title: "데이터 폴더 고르기",
        properties: ["openDirectory", "createDirectory"],
      });
      if (r.canceled || !r.filePaths.length) return { ok: false };
      dir = r.filePaths[0];
    }
    try {
      if (dir) fs.writeFileSync(DATA_DIR_FILE, dir, "utf8");
      else fs.rmSync(DATA_DIR_FILE, { force: true });
    } catch (e) {
      return { ok: false, reason: "설정을 쓰지 못했습니다 (" + (e.code || e.message) + ")" };
    }
    return { ok: true, dir: dir || DEFAULT_DATA };
  });
  ipcMain.on("reset-progress", resetProgress);

  /* ---- 백업 ---- */
  ipcMain.handle("list-backups", () => backup.list(BACKUPS));

  /**
   * 백업으로 되돌린다.
   *
   * 세이브는 박스·펫 창·알림 스냅샷 곳곳에 메모리로 퍼져 있다. 그걸 하나하나
   * 갈아 끼우면 어딘가 옛 값이 남는다. 파일만 바꾸고 다시 켜는 게 확실하다.
   * 못 읽고 시작한 판(loadFailed)에서도 된다 — 오히려 그때 제일 필요하다.
   */
  ipcMain.handle("restore-backup", async (_e, file) => {
    const raw = backup.read(BACKUPS, file);
    if (!raw) return { ok: false, reason: "백업을 읽지 못했습니다." };
    const r = await dialog.showMessageBox(setWin || win, {
      type: "warning",
      buttons: ["되돌리고 다시 켜기", "취소"],
      defaultId: 1,
      cancelId: 1,
      title: "백업으로 되돌리기",
      message: file + " 로 되돌립니다.",
      detail: "지금 진행은 백업 폴더에 따로 남겨 두므로 다시 돌아올 수 있습니다. 앱이 다시 켜집니다.",
    });
    if (r.response !== 0) return { ok: false };
    backup.snapshot(SAVE, BACKUPS, "before-restore");
    const tmp = SAVE + ".tmp";
    try {
      fs.writeFileSync(tmp, raw, "utf8");
      fs.renameSync(tmp, SAVE);
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch {}
      return { ok: false, reason: "세이브를 쓰지 못했습니다 (" + (e.code || e.message) + ")" };
    }
    // 이 뒤로 메모리의 옛 판이 파일을 덮지 않게 한다.
    loadFailed = true;
    app.relaunch();
    app.exit(0);
    return { ok: true };
  });

  /* ---- 읽을 경로 ---- */
  ipcMain.handle("path-report", () => pathReport());

  /** 폴더/파일 고르기. 취소하면 아무 일도 없다. */
  ipcMain.handle("pick-path", async (_e, { kind, title }) => {
    const r = await dialog.showOpenDialog(setWin || win, {
      title: title || "선택",
      properties: kind === "file" ? ["openFile"] : ["openDirectory"],
      filters: kind === "file" ? [{ name: "JSON", extensions: ["json"] }] : undefined,
    });
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
  });

  /**
   * 경로 추가/제거. 저장하고 바로 다시 스캔한다 —
   * 넣자마자 몇 개가 잡혔는지 보여야 맞게 넣었는지 알 수 있다.
   */
  ipcMain.handle("set-log-root", async (_e, { src, path: p, remove }) => {
    if (src !== "claude" && src !== "codex") return pathReport();
    const roots = save.logRoots || (save.logRoots = { claude: [], codex: [] });
    if (!Array.isArray(roots[src])) roots[src] = [];
    if (remove) roots[src] = roots[src].filter((x) => x !== p);
    else if (p && !roots[src].includes(p)) roots[src].push(p);
    writeSave();
    await refresh(true);
    return pathReport();
  });

  ipcMain.handle("set-quota-file", async (_e, { src, path: p }) => {
    if (src !== "claude" && src !== "codex") return pathReport();
    save.quotaFiles = save.quotaFiles || {};
    if (p) save.quotaFiles[src] = p;
    else delete save.quotaFiles[src];
    writeSave();
    await refresh(true);
    return pathReport();
  });

  // 펫을 클릭하면 팝오버를 연다. 펫 옆이 아니라 트레이 옆에 띄운다 —
  // 펫은 화면 아무 데나 있을 수 있어서, 늘 같은 자리에 뜨는 편이 덜 헷갈린다.
  ipcMain.on("pet-click", () => {
    if (win.isVisible()) win.hide();
    else showNearTray();
  });

  // 펫 드래그. 창 전체가 app-region:drag면 클릭 이벤트가 오지 않으므로
  // 드래그를 직접 구현하고, 움직임이 거의 없으면 클릭으로 친다.
  /**
   * 여러 마리가 떠 있으므로 "어느 창이 보냈나"를 이벤트에서 알아낸다.
   * 전역 pet 하나를 옮기면 엉뚱한 아이가 끌려간다.
   */
  const petIdOf = (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    for (const [id, rec] of pets) if (rec.win === w) return id;
    return null;
  };

  /**
   * 끌기 시작. 그 창의 현재 자리를 기억해 둔다.
   *
   * 렌더러가 보내온 화면 좌표에서 잡은 지점을 빼는 방식이었는데, 창 좌표와
   * 화면 좌표 사이에 조금이라도 어긋남이 있으면 그대로 오차가 된다.
   * 시작 자리 + 움직인 거리로 계산하면 그 어긋남이 상쇄된다.
   */
  ipcMain.on("pet-drag-start", (e) => {
    const id = petIdOf(e);
    const rec = id && pets.get(id);
    if (!rec || rec.win.isDestroyed()) return;
    const p = rec.win.getPosition();
    rec.dragFrom = { x: p[0], y: p[1] };
    rec.dragging = true;
    stopWander(id); // 끄는 동안 우리가 끼어들면 안 된다
  });

  ipcMain.on("pet-drag", (e, { dx, dy }) => {
    const id = petIdOf(e);
    const rec = id && pets.get(id);
    if (!rec || rec.win.isDestroyed() || !rec.dragFrom) return;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return; // NaN 이 오면 창이 엉뚱해진다
    /*
     * 마우스는 초당 수십~수백 번 움직인다. 그때마다 창을 옮기면 합성기가
     * 못 따라가고, 실제로 창 크기가 망가진 적이 있다. 다음 프레임에 한 번만
     * 적용한다 — 눈에는 차이가 없고 호출은 몇 배로 줄어든다.
     */
    rec.pending = { x: rec.dragFrom.x + dx, y: rec.dragFrom.y + dy };
    if (rec.raf) return;
    rec.raf = setTimeout(() => {
      rec.raf = null;
      const p = rec.pending;
      if (!p || rec.win.isDestroyed()) return;
      rec.selfPos = movePet(rec.win, p.x, p.y) || null;
    }, 16);
  });

  ipcMain.on("pet-drag-end", (e) => {
    const id = petIdOf(e);
    const rec = id && pets.get(id);
    if (!rec) return;
    rec.dragging = false;
    rec.dragFrom = null;
    if (rec.raf) { clearTimeout(rec.raf); rec.raf = null; }
    if (rec.win.isDestroyed()) return;
    // 마지막 위치를 확실히 반영하고 크기도 다시 박는다
    if (rec.pending) rec.selfPos = movePet(rec.win, rec.pending.x, rec.pending.y) || null;
    rec.pending = null;
    const p = rec.win.getPosition();
    save.petPos = { x: p[0], y: p[1] };
    writeSave(); // 놓을 때 한 번만
    if (duel) return; // 싸우는 중이면 결투가 끝난 뒤 다시 걷는다

    /*
     * 다른 펫 위에 떨어뜨리면 결투. 메뉴를 찾아 들어가지 않아도 되는 제일 쉬운 길이다.
     * 겹친 정도는 중심 사이 거리로 잰다 — 살짝 스친 걸로 싸움이 나면 펫을 옮기기가 겁난다.
     */
    const w = petW();
    // 야생 위에 놓았나 — 그러면 잡으려고 약하게 만든다
    if (wildNow && !wildNow.busy && !wildNow.fleeing && Math.hypot(wildNow.pos.x - p[0], wildNow.pos.y - p[1]) < w * 0.6) {
      wildBattle(id).then((ok) => {
        if (!ok) startWander(id);
      });
      return;
    }
    let other = null;
    for (const [oid, o] of pets) {
      if (oid === id || o.win.isDestroyed() || !o.win.isVisible()) continue;
      const q = o.win.getPosition();
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) < w * 0.55) { other = oid; break; }
    }
    if (other) {
      desktopBattle(id, other, 50).then((r) => {
        if (r && !r.ok) startWander(id); // 알이라 못 싸우는 등
      });
      return;
    }
    startWander(id); // 놓은 자리에서 다시 시작
  });

  await refresh();
  if (save.petVisible) syncPets();
  restartPolling();
  scheduleWild();
});

app.on("window-all-closed", (e) => e.preventDefault()); // 트레이 앱은 창이 없어도 산다
}
