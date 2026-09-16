"use strict";
const { app, Tray, BrowserWindow, Menu, ipcMain, nativeImage, screen } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const usage = require("./usage");
const poke = require("./pokemon");
const limits = require("./limits");

const CACHE = path.join(app.getPath("userData"), "sprites");
const SAVE = path.join(app.getPath("userData"), "save.json");
const POLL_MS = 30_000;

let tray = null;
let win = null; // 팝오버
let pet = null; // 데스크톱 펫
let lastStats = null;

// lineIndex가 null이면 아직 안 뽑은 것. 첫 실행에 뽑는다.
let save = { lineIndex: null, seen: [], petVisible: false, petPos: null, wanderLevel: "rare" };

function loadSave() {
  try {
    // BOM이 붙은 파일(PowerShell 등 다른 도구가 쓴 경우)에서 JSON.parse가 터진다.
    // 그러면 설정이 통째로 기본값으로 떨어지는데, 오류도 안 나서 원인을 찾기 어렵다.
    const raw = fs.readFileSync(SAVE, "utf8");
    const clean = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    save = { ...save, ...JSON.parse(clean) };
  } catch {
    /* 첫 실행 */
  }
  if (!Array.isArray(save.seen)) save.seen = [];
}

function writeSave() {
  try {
    fs.writeFileSync(SAVE, JSON.stringify(save), "utf8");
  } catch {
    /* 저장 실패는 치명적이지 않다 */
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

/** 뽑기. 뽑은 라인은 도감에 남는다. */
function rollLine() {
  save.lineIndex = poke.roll(save.lineIndex);
  if (!save.seen.includes(save.lineIndex)) save.seen.push(save.lineIndex);
  writeSave();
  refresh();
}

async function buildStats() {
  const u = usage.collect();
  const mon = poke.describe(u.total, save.lineIndex ?? 0);
  // 트레이는 정적 PNG(nativeImage는 GIF를 움직이지 못한다), 화면은 애니메이션 GIF.
  const still = await poke.spriteWithFallback(mon, CACHE, "still");
  const anim = await poke.spriteWithFallback(mon, CACHE, "anim");
  // events는 한도 계산에만 쓴다. 수천 건을 30초마다 IPC로 보낼 이유가 없다.
  const { events, ...slim } = u;
  return {
    usage: slim,
    mon,
    stillPath: still,
    // 렌더러에 Windows 경로를 넘기면 역슬래시를 직접 다뤄야 한다. 변환은 Node가 한다.
    stillUrl: still ? pathToFileURL(still).href : null,
    animUrl: anim ? pathToFileURL(anim).href : null,
    dex: { seen: save.seen.length, total: poke.LINES.length },
    tree: await buildTree(u.total),
    limits: limits.summarize(u),
  };
}

/** 진화 트리에 쓸 작은 정적 스프라이트를 붙인다. 못 받으면 그림 없이 이름만 나온다. */
async function buildTree(total) {
  const nodes = poke.evolutionTree(save.lineIndex ?? 0, total);
  return Promise.all(
    nodes.map(async (n) => {
      const p = await poke.spriteWithFallback(
        { dexId: n.dexId, isShiny: n.isShiny },
        CACHE,
        "still",
      );
      return { ...n, url: p ? pathToFileURL(p).href : null };
    }),
  );
}

/** Windows 트레이는 macOS 메뉴바와 달리 글자를 못 띄운다. 숫자는 툴팁으로 간다. */
function applyTray(s) {
  if (!tray) return;
  if (s.stillPath) {
    const img = nativeImage.createFromPath(s.stillPath).resize({ width: 16, height: 16 });
    if (!img.isEmpty()) tray.setImage(img);
  }
  const p = s.mon.progress;
  const b = s.limits && s.limits.block;
  const q = s.limits && s.limits.codex;
  tray.setToolTip(
    s.mon.name + " · " + s.mon.stage.label + "\n" +
      "오늘 " + fmt(s.usage.today) + " · 누적 " + fmt(s.usage.total) +
      (p.next ? "\n다음(" + p.next + ")까지 " + fmt(p.remaining) : "\n최고 단계입니다") +
      (b ? "\n5시간 창 " + fmt(b.used) + " · " + hm(b.remainingMs) + " 남음" : "") +
      (q ? "\nCodex 주간 " + q.percent + "%" : ""),
  );
}

function push(target, s) {
  if (target && !target.isDestroyed()) target.webContents.send("stats", s);
}

async function refresh() {
  try {
    const s = await buildStats();
    lastStats = s;
    push(win, s);
    push(pet, s);
    try {
      applyTray(s);
    } catch (e) {
      console.error("[tray]", e.message);
    }
  } catch (e) {
    console.error("[refresh 실패]", e && e.stack ? e.stack : e);
  }
}

/** 렌더러 오류는 메인 stdout에 안 나온다. 끌어오지 않으면 조용히 죽는다. */
function logConsole(tag) {
  return (_e, lvl, msg, line, src) =>
    console.log("[" + tag + ":" + lvl + "] " + msg + " (" + src + ":" + line + ")");
}

/* ---------------- 팝오버 ---------------- */

function createWindow() {
  win = new BrowserWindow({
    width: 340,
    height: 700,
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
  win.on("blur", () => win.hide()); // 팝오버답게 포커스를 잃으면 닫는다
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
}

/* ---------------- 데스크톱 펫 ---------------- */

const PET_W = 128;
const PET_H = 128;

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

let wanderTarget = null;
let wanderTimer = null;
let stepTimer = null;

/**
 * 우리가 옮긴 좌표. 'moved' 이벤트가 우리 때문인지 사용자가 끌어서인지 가린다.
 *
 * 불린 플래그로는 안 된다 — setPosition 직후 플래그를 되돌려도 'moved'는
 * OS 메시지 루프를 거쳐 그 뒤에 도착한다. 그러면 우리 이동이 전부
 * "사용자가 끌었다"로 오인돼 배회 목표가 계속 취소되고 펫이 버벅인다.
 */
let selfPos = null;

function createPet() {
  const area = screen.getPrimaryDisplay().workArea;
  const pos = save.petPos || {
    x: area.x + area.width - PET_W - 40,
    y: area.y + area.height - PET_H - 60,
  };
  pet = new BrowserWindow({
    width: PET_W,
    height: PET_H,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true },
  });
  pet.setAlwaysOnTop(true, "screen-saver"); // 전체화면 위에도 뜨게
  pet.loadFile(path.join(__dirname, "..", "renderer", "pet.html"));
  pet.webContents.on("did-finish-load", () => lastStats && push(pet, lastStats));
  pet.webContents.on("console-message", logConsole("pet"));

  pet.on("moved", () => {
    if (!pet || pet.isDestroyed()) return;
    const p = pet.getPosition();
    if (selfPos && p[0] === selfPos.x && p[1] === selfPos.y) return; // 우리가 옮긴 것
    save.petPos = { x: p[0], y: p[1] };
    writeSave();
    wanderTarget = null; // 사용자가 놓은 자리에서 다시 시작한다
  });

  startWander();
}

function startWander() {
  stopWander();
  const cfg = WANDER[save.wanderLevel];
  if (!cfg || !pet || pet.isDestroyed()) return;

  const pickTarget = () => {
    if (!pet || pet.isDestroyed()) return;
    const p = pet.getPosition();
    const area = screen.getDisplayNearestPoint({ x: p[0], y: p[1] }).workArea;
    const dx = (Math.random() - 0.5) * cfg.range[0];
    const dy = (Math.random() - 0.5) * cfg.range[1];
    wanderTarget = {
      x: Math.min(Math.max(area.x, Math.round(p[0] + dx)), area.x + area.width - PET_W),
      y: Math.min(Math.max(area.y, Math.round(p[1] + dy)), area.y + area.height - PET_H),
    };
  };

  wanderTimer = setInterval(pickTarget, cfg.pause);
  setTimeout(pickTarget, 4000);

  stepTimer = setInterval(() => {
    if (!pet || pet.isDestroyed() || !wanderTarget) return;
    const p = pet.getPosition();
    const dx = wanderTarget.x - p[0];
    const dy = wanderTarget.y - p[1];
    if (Math.abs(dx) <= cfg.px && Math.abs(dy) <= cfg.px) {
      wanderTarget = null; // 도착. 다음 pause 동안 가만히 있는다
      return;
    }
    const step = (d) => Math.sign(d) * Math.min(Math.abs(d), cfg.px);
    const nx = Math.round(p[0] + step(dx));
    const ny = Math.round(p[1] + step(dy));
    selfPos = { x: nx, y: ny };
    pet.setPosition(nx, ny);
    push(pet, { facing: dx < 0 ? "left" : "right" }); // 진행 방향으로 뒤집게
  }, cfg.ms);
}

function stopWander() {
  if (wanderTimer) clearInterval(wanderTimer);
  if (stepTimer) clearInterval(stepTimer);
  wanderTimer = null;
  stepTimer = null;
  wanderTarget = null;
}

function togglePet(on) {
  save.petVisible = on === undefined ? !save.petVisible : on;
  writeSave();
  if (save.petVisible) {
    if (!pet || pet.isDestroyed()) createPet();
    pet.showInactive();
  } else if (pet && !pet.isDestroyed()) {
    stopWander();
    pet.destroy();
    pet = null;
  }
}

function setWanderLevel(level) {
  save.wanderLevel = level;
  writeSave();
  if (pet && !pet.isDestroyed()) startWander();
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
    { label: "🎲 다시 뽑기", click: rollLine },
    { label: "새로고침", click: refresh },
    { type: "separator" },
    { label: "종료", click: () => app.quit() },
  ]);
}

app.whenReady().then(async () => {
  loadSave();

  // 첫 실행이면 뽑는다. 고정 1번으로 시작하면 누구나 같은 포켓몬을 받는다.
  if (save.lineIndex === null || save.lineIndex === undefined) {
    save.lineIndex = poke.roll(null);
    if (!save.seen.includes(save.lineIndex)) save.seen.push(save.lineIndex);
    writeSave();
  }

  // Windows 트레이는 빈 아이콘을 받으면 아무것도 표시하지 않는다.
  const fallback = nativeImage
    .createFromPath(path.join(__dirname, "..", "..", "assets", "pokeball.png"))
    .resize({ width: 16, height: 16 });
  tray = new Tray(fallback);
  tray.setToolTip("PokeTokenBar — 불러오는 중…");

  createWindow();
  tray.on("click", () => (win.isVisible() ? win.hide() : showNearTray()));
  tray.on("right-click", () => tray.popUpContextMenu(buildMenu()));

  ipcMain.on("request-stats", refresh);
  ipcMain.on("quit", () => app.quit());
  ipcMain.on("toggle-pet", () => togglePet());
  ipcMain.on("next-line", rollLine);

  // 펫을 클릭하면 팝오버를 연다. 펫 옆이 아니라 트레이 옆에 띄운다 —
  // 펫은 화면 아무 데나 있을 수 있어서, 늘 같은 자리에 뜨는 편이 덜 헷갈린다.
  ipcMain.on("pet-click", () => {
    if (win.isVisible()) win.hide();
    else showNearTray();
  });

  // 펫 드래그. 창 전체가 app-region:drag면 클릭 이벤트가 오지 않으므로
  // 드래그를 직접 구현하고, 움직임이 거의 없으면 클릭으로 친다.
  ipcMain.on("pet-drag", (_e, { x, y }) => {
    if (!pet || pet.isDestroyed()) return;
    stopWander(); // 끄는 동안 우리가 끼어들면 안 된다
    pet.setPosition(Math.round(x), Math.round(y));
  });

  ipcMain.on("pet-drag-end", () => {
    if (!pet || pet.isDestroyed()) return;
    const p = pet.getPosition();
    save.petPos = { x: p[0], y: p[1] };
    writeSave();
    startWander(); // 놓은 자리에서 다시 시작
  });

  await refresh();
  if (save.petVisible) togglePet(true);
  setInterval(refresh, POLL_MS);
});

app.on("window-all-closed", (e) => e.preventDefault()); // 트레이 앱은 창이 없어도 산다
