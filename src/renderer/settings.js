"use strict";
const $ = (id) => document.getElementById(id);

// 설정을 바꾸는 즉시 저장한다. "저장" 버튼을 따로 두면
// 안 누르고 닫았을 때 바뀐 줄 알았던 게 안 바뀌어 있다.
const send = (patch) => window.ptb.setSettings(patch);

let ready = false; // 초기 값을 채우는 동안 change 이벤트가 되돌아 저장되지 않게

window.ptb.onSettings((s) => {
  ready = false;
  $("growthPct").value = s.growthPct;
  $("pricePct").value = s.pricePct;
  showGrowth(s.growthPct);
  $("pricePctVal").textContent = s.pricePct + "%";
  $("notifyEnabled").checked = s.notifyEnabled;
  $("warnPercent").value = s.warnPercent;
  $("warnPercentVal").textContent = s.warnPercent + "%";
  $("petSize").value = s.petSize;
  $("petSizeVal").textContent = s.petSize + "px";
  const L = s.limits || {};
  $("limClaudeBlock").value = toUnit((L.claude || {}).block);
  $("limClaudeWeek").value = toUnit((L.claude || {}).week);
  $("limCodexBlock").value = toUnit((L.codex || {}).block);
  $("trayIcon").value = s.trayIcon || "logo";
  $("wanderLevel").value = s.wanderLevel;
  $("pollMinutes").value = String(s.pollMinutes);
  $("autoLaunch").checked = s.autoLaunch;
  $("dataPath").textContent = s.dataPath || "";
  ready = true;
});

/**
 * 난이도가 실제로 뭘 바꾸는지 숫자로 보여준다.
 * "150%"만 적어두면 그게 얼마나 느려지는 건지 감이 안 온다.
 */
const STAGES = [
  ["부화", 5e6],
  ["1차 진화", 8e7],
  ["최종 진화", 4e8],
  ["마스터", 1.5e9],
];
const fmt = (n) =>
  n >= 1e9 ? (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? (n / 1e6).toFixed(0) + "M" : Math.round(n / 1e3) + "K";

function showGrowth(pct) {
  $("growthPctVal").textContent = pct + "%";
  const k = pct / 100;
  // 속도가 빠를수록 필요한 토큰은 줄어든다
  $("growthNote").textContent =
    STAGES.map(([n, v]) => n + " " + fmt(v / k)).join(" · ") +
    (pct === 100 ? "" : pct > 100 ? "  (기본보다 빠르게)" : "  (기본보다 느리게)");
}

/**
 * "300M" · "2B" · "1500000" 을 모두 받는다.
 * 토큰 수를 자리수 그대로 치게 하면 0을 세다 틀린다.
 */
function parseTokens(v) {
  const t = String(v || "").trim().replace(/,/g, "");
  if (!t) return null;
  const m = t.match(/^([d.]+)s*([kmbKMB])?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const mul = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] || "").toLowerCase()] || 1;
  return Math.round(n * mul);
}

const toUnit = (n) =>
  !n ? "" : n >= 1e9 ? +(n / 1e9).toFixed(2) + "B" : n >= 1e6 ? +(n / 1e6).toFixed(1) + "M" : String(n);

/** 입력 셋을 모아 한 덩어리로 보낸다. 부분 저장하면 서로 덮어쓴다. */
function sendLimits() {
  const v = {
    claude: {
      block: parseTokens($("limClaudeBlock").value),
      week: parseTokens($("limClaudeWeek").value),
    },
    codex: { block: parseTokens($("limCodexBlock").value) },
  };
  // 못 읽은 값은 지운다 — 잘못 친 글자가 옛 한도로 남아 있으면 안 된다
  for (const k of Object.keys(v)) {
    for (const f of Object.keys(v[k])) if (!v[k][f]) delete v[k][f];
    if (!Object.keys(v[k]).length) delete v[k];
  }
  send({ limits: v });
}

const on = (id, ev, fn) => $(id).addEventListener(ev, (e) => ready && fn(e));

on("notifyEnabled", "change", () => send({ notifyEnabled: $("notifyEnabled").checked }));
on("autoLaunch", "change", () => send({ autoLaunch: $("autoLaunch").checked }));
for (const id of ["limClaudeBlock", "limClaudeWeek", "limCodexBlock"]) {
  on(id, "change", () => {
    sendLimits();
    // 입력한 값을 정리된 표기로 되돌려 보여준다 (1500000 → 1.5M)
    const el = $(id);
    const n = parseTokens(el.value);
    el.value = n ? toUnit(n) : "";
  });
}
on("trayIcon", "change", () => send({ trayIcon: $("trayIcon").value }));
on("wanderLevel", "change", () => send({ wanderLevel: $("wanderLevel").value }));
on("pollMinutes", "change", () => send({ pollMinutes: Number($("pollMinutes").value) }));

// 슬라이더는 끄는 동안 숫자만 갱신하고, 손을 뗄 때 저장한다.
$("growthPct").addEventListener("input", () => showGrowth(Number($("growthPct").value)));
on("growthPct", "change", () => send({ growthPct: Number($("growthPct").value) }));

$("pricePct").addEventListener("input", () => {
  $("pricePctVal").textContent = $("pricePct").value + "%";
});
on("pricePct", "change", () => send({ pricePct: Number($("pricePct").value) }));

$("warnPercent").addEventListener("input", () => {
  $("warnPercentVal").textContent = $("warnPercent").value + "%";
});
on("warnPercent", "change", () => send({ warnPercent: Number($("warnPercent").value) }));

$("petSize").addEventListener("input", () => {
  $("petSizeVal").textContent = $("petSize").value + "px";
});
on("petSize", "change", () => send({ petSize: Number($("petSize").value) }));

$("openData").onclick = () => window.ptb.openDataFolder();
$("reset").onclick = () => window.ptb.resetProgress();
$("close").onclick = () => window.ptb.closeSettings();
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") window.ptb.closeSettings();
});

window.ptb.requestSettings();
