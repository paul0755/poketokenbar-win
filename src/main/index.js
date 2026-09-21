"use strict";
const { app, Tray, BrowserWindow, Menu, ipcMain, nativeImage, screen, Notification, shell, dialog } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const usage = require("./usage");
const poke = require("./pokemon");
const limits = require("./limits");
const box = require("./box");
const profile = require("./profile");
const notify = require("./notify");

const CACHE = path.join(app.getPath("userData"), "sprites");
const SAVE = path.join(app.getPath("userData"), "save.json");

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

const SHOP = [
  { id: "egg", name: "포켓몬 알", cost: 2, desc: "평범한 알. 박스에 한 마리 늘어난다", icon: "🥚" },
  { id: "egg-super", name: "슈퍼 알", cost: 7, desc: "★3 이상 확정", icon: "🥚" },
  { id: "egg-legend", name: "전설 알", cost: 18, desc: "★4 이상 확정", icon: "🥚" },
  { id: "rare-candy", name: "이상한사탕", cost: 1, desc: "키우는 아이를 1000만 만큼 자라게 한다", icon: "🍬" },
  { id: "mint", name: "민트", cost: 2, desc: "성격만 다시 뽑는다. 키우던 건 그대로", icon: "🌿" },
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
  pollMinutes: 0.5, // 갱신 주기(분). 0.5 = 30초
  autoLaunch: false,
};

let hadSave = false; // 세이브 파일이 원래 있었는가 (첫 실행 vs 이전 버전 이어받기)

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
  try {
    fs.writeFileSync(SAVE, JSON.stringify(save), "utf8");
  } catch (e) {
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
  const c = candy();
  const cost = priceOf(item.cost);
  if (c.left < cost) return { ok: false, reason: "사탕이 모자랍니다" };

  save.candySpent = (save.candySpent ?? 0) + cost;
  let msg = "";
  if (itemId === "egg") { hatch(0); msg = "새 알을 받았습니다"; }
  else if (itemId === "egg-super") { hatch(3); msg = "슈퍼 알 — ★3 이상"; }
  else if (itemId === "egg-legend") { hatch(4); msg = "전설 알 — ★4 이상"; }
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
  if (!save.box.length && !loadFailed) { hatch(0); writeSave(); }

  // 프로필이 없던 시절의 개체를 채운다 (한 번만 걸린다)
  if (box.backfill(save.box)) writeSave();

  // 늘어난 토큰은 키우는 아이에게만 적립된다.
  if (box.accrue(save, u.total)) writeSave();

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
        caughtAt: m.caughtAt,
        graduated: Boolean(m.graduatedAt),
        active: m.id === (act && act.id),
        isPet: save.petIds.includes(m.id),
        url: p ? pathToFileURL(p).href : null,
        animUrl: ap ? pathToFileURL(ap).href : null,
        profile: profile.build(m, e),
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
    candy: candy(u.total),
    charm: Boolean(save.charm),
    shiny: Boolean(act && act.shiny),
    tree: await buildTree(act, eff),
    limits: limits.summarize(u, Date.now(), save.limits || {}, save.quotaFiles || {}),
    box: boxList,
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
      (q ? "\nCodex 주간 " + q.percent + "%" : ""),
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
    lastStats = s;
    sendNotifications(s);
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

function createWindow() {
  // 700px가 늘 들어간다는 보장이 없다. 작업 영역을 넘지 않게 자르고,
  // 잘린 만큼은 본문 스크롤이 받아준다.
  const area = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    width: 400,
    height: Math.max(460, Math.min(760, area.height - 60)),
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true },
  });
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  // 최초 refresh가 로드보다 빠르면 그 send는 허공에 사라진다. 로드 후 한 번 더 민다.
  win.webContents.on("did-finish-load", () => (lastStats ? push(win, lastStats) : refresh()));
  win.webContents.on("console-message", logConsole("renderer"));
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
      owned: x.once ? Boolean(save.charm) : false,
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
    pollMinutes: save.pollMinutes,
    autoLaunch: save.autoLaunch,
    dataPath: app.getPath("userData"),
  };
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
  writeSave();

  if ("wanderLevel" in patch) for (const id of pets.keys()) startWander(id);
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
  save.box = [];
  save.activeId = null;
  save.petIds = [];
  save.lastTotal = lastTotal; // 지금부터 알로 다시 시작
  save.candySpent = 0;
  save.candyBonus = 0;
  save.charm = false;
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

  for (const id of [...pets.keys()]) if (!want.includes(id)) destroyPet(id);

  want.forEach((id, nth) => {
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
  ipcMain.handle("release", (_e, id) => {
    const m = box.find(save.box, id);
    if (!m) return { ok: false, reason: "없는 아이" };
    if (save.box.length <= 1) return { ok: false, reason: "마지막 한 마리는 놓아줄 수 없습니다" };
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
  ipcMain.on("reset-progress", resetProgress);

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
    startWander(id); // 놓은 자리에서 다시 시작
  });

  await refresh();
  if (save.petVisible) syncPets();
  restartPolling();
});

app.on("window-all-closed", (e) => e.preventDefault()); // 트레이 앱은 창이 없어도 산다
}
