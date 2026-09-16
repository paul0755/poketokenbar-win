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
  $("growthNote").textContent =
    STAGES.map(([n, v]) => n + " " + fmt(v * k)).join(" · ") +
    (pct === 100 ? "" : pct > 100 ? "  (기본보다 느리게)" : "  (기본보다 빠르게)");
}

const on = (id, ev, fn) => $(id).addEventListener(ev, (e) => ready && fn(e));

on("notifyEnabled", "change", () => send({ notifyEnabled: $("notifyEnabled").checked }));
on("autoLaunch", "change", () => send({ autoLaunch: $("autoLaunch").checked }));
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
