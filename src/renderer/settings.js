"use strict";
const $ = (id) => document.getElementById(id);

// 설정을 바꾸는 즉시 저장한다. "저장" 버튼을 따로 두면
// 안 누르고 닫았을 때 바뀐 줄 알았던 게 안 바뀌어 있다.
const send = (patch) => window.ptb.setSettings(patch);

let ready = false; // 초기 값을 채우는 동안 change 이벤트가 되돌아 저장되지 않게
// 리셋 요일을 실제로 정한 적이 있는가. 화면의 기본 선택(수 15시)은
// 보기 좋으라고 넣은 것이지 사용자가 확인해 준 값이 아니다.
let anchorSet = false;

window.ptb.onSettings((s) => {
  ready = false;
  $("appVer").textContent = s.version ? "v" + s.version : "";
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
  // 리셋 요일을 안 정했으면 수요일 15시를 기본으로 보여준다 (흔한 값).
  // 실제 저장은 사용자가 고를 때만 일어난다 — 기본값을 사실처럼 저장하지 않는다.
  $("resetDay").value = String((L.claude || {}).resetDay ?? 3);
  $("resetHour").value = String((L.claude || {}).resetHour ?? 15);
  if ((L.claude || {}).resetDay != null) anchorSet = true;
  $("trayIcon").value = s.trayIcon || "logo";
  $("wanderLevel").value = s.wanderLevel;
  $("moveLevel").value = s.moveLevel || "rare";
  $("wildLevel").value = s.wildLevel || "rare";
  const q = s.wildQuiet || { enabled: false, from: 22, to: 8 };
  $("quietOn").checked = !!q.enabled;
  $("quietFrom").value = String(q.from);
  $("quietTo").value = String(q.to);
  showQuiet();
  const B = s.burning || {};
  $("burnOn").checked = !!B.enabled;
  $("burnMult").value = String(B.mult || 4);
  $("burnWeekdays").checked = !!B.weekdays;
  (B.spans || []).forEach((sp, i) => {
    $("burnS" + i).checked = !!sp.on;
    $("burnF" + i).value = String(sp.from);
    $("burnT" + i).value = String(sp.to);
  });
  showBurn();
  $("pollMinutes").value = String(s.pollMinutes);
  $("autoLaunch").checked = s.autoLaunch;
  $("onlineOn").checked = !!(s.online && s.online.enabled);
  $("onlineRelay").value = (s.online && s.online.custom) || "";
  $("onlineRelay").placeholder = s.onlineDefault || "";
  $("dataPath").textContent = s.dataPath || "";
  /*
   * 공식 값이 들어오고 있으면 여기에 아무것도 넣을 필요가 없다.
   * 그 말을 안 해 두면 "자동으로 가져온다더니 왜 입력란이 있냐"가 된다.
   */
  const auto = (s.autoSources || []).join(" · ");
  $("calibNeed").innerHTML = auto
    ? `✅ <b>${auto}</b> 는 공식 사용률을 읽고 있습니다 — 여기에 넣지 않아도 막대가 나옵니다.`
    : "⚠️ 지금은 어느 도구에서도 공식 사용률을 못 읽고 있습니다. 아래에 넣으면 막대가 나옵니다.";
  $("pickData").disabled = !!s.dataByEnv;
  $("resetData").disabled = !!s.dataByEnv || !s.dataOverride;
  if (s.dataByEnv) {
    $("dataDirNote").textContent = "POKETOKENBAR_DATA 환경변수로 지정되어 있습니다. 여기서는 못 바꿉니다.";
  } else if (s.dataOverride) {
    $("dataDirNote").textContent = "기본 폴더 대신 위 경로를 쓰는 중입니다. 기본값: " + (s.dataDefault || "");
  }
  ready = true;
});

/**
 * 난이도가 실제로 뭘 바꾸는지 숫자로 보여준다.
 * "150%"만 적어두면 그게 얼마나 느려지는 건지 감이 안 온다.
 */
const STAGES = [
  ["1차 진화", 5e6],
  ["2차 진화", 8e7],
  ["3차 진화", 4e8],
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
  // 리셋 요일·시각은 0이 유효한 값이라 위의 falsy 정리에 태우면 안 된다.
  // 한 번이라도 고른 적이 있을 때만 싣는다.
  if (anchorSet) {
    v.claude = { ...(v.claude || {}), resetDay: Number($("resetDay").value), resetHour: Number($("resetHour").value) };
  }
  send({ limits: v });
}

const on = (id, ev, fn) => $(id).addEventListener(ev, (e) => ready && fn(e));

on("notifyEnabled", "change", () => send({ notifyEnabled: $("notifyEnabled").checked }));
on("autoLaunch", "change", () => send({ autoLaunch: $("autoLaunch").checked }));
// 서버 주소는 ws:// 나 wss:// 로 시작해야 한다. 아니면 저장하지 않는다
const sendOnline = () => {
  const relay = $("onlineRelay").value.trim();
  if (relay && !/^wss?:\/\/[^\s]+$/.test(relay)) return void ($("onlineRelay").style.borderColor = "#ff5a5a");
  $("onlineRelay").style.borderColor = "";
  send({ online: { enabled: $("onlineOn").checked, relay } });
};
on("onlineOn", "change", sendOnline);
on("onlineRelay", "change", sendOnline);
for (const id of ["limClaudeBlock", "limClaudeWeek", "limCodexBlock"]) {
  on(id, "change", () => {
    sendLimits();
    // 입력한 값을 정리된 표기로 되돌려 보여준다 (1500000 → 1.5M)
    const el = $(id);
    const n = parseTokens(el.value);
    el.value = n ? toUnit(n) : "";
  });
}
/**
 * 퍼센트로 한도 맞추기.
 *
 * 토큰 단위 한도는 공개돼 있지 않지만 쓴 양은 우리가 안다.
 * "지금 12%"만 받으면 분모를 되돌릴 수 있다.
 * 결과를 반드시 글로 보여준다 — 눌렀는데 아무 말도 없으면 됐는지 알 수 없다.
 */
async function calibrate(src, w, inputId) {
  const el = $(inputId);
  const note = $("calNote");
  note.textContent = "맞추는 중…";
  try {
    const r = await window.ptb.calibrateLimit({ src, win: w, percent: Number(el.value) });
    if (!r || !r.ok) {
      note.textContent = "⚠️ " + ((r && r.error) || "맞추지 못했습니다");
      return;
    }
    const label = w === "block" ? "5시간" : "주간";
    note.textContent = `${label} 한도를 ${toUnit(r.limit)}로 맞췄습니다 (쓴 양 ${toUnit(r.used)} 기준).`;
    el.value = "";
  } catch (e) {
    note.textContent = "⚠️ 맞추지 못했습니다: " + e.message;
  }
}
for (const id of ["resetDay", "resetHour"]) {
  on(id, "change", () => {
    anchorSet = true; // 고른 순간부터 사용자가 정한 값이 된다
    sendLimits();
  });
}
$("calClaudeBlockGo").onclick = () => calibrate("claude", "block", "calClaudeBlock");
$("calClaudeWeekGo").onclick = () => calibrate("claude", "week", "calClaudeWeek");

on("trayIcon", "change", () => send({ trayIcon: $("trayIcon").value }));
on("wanderLevel", "change", () => send({ wanderLevel: $("wanderLevel").value }));
on("moveLevel", "change", () => send({ moveLevel: $("moveLevel").value }));
on("wildLevel", "change", () => send({ wildLevel: $("wildLevel").value }));

/* 방해 금지 시간 — 시(0~23)만 고른다. 분까지 고르게 하면 고를 게 많아지기만 한다 */
const hourLabel = (h) => (h < 12 ? "오전 " : "오후 ") + (h % 12 === 0 ? 12 : h % 12) + "시";
for (const id of ["quietFrom", "quietTo"]) {
  $(id).innerHTML = Array.from({ length: 24 }, (_, h) => `<option value="${h}">${hourLabel(h)}</option>`).join("");
}
function showQuiet() {
  const on = $("quietOn").checked;
  $("quietFrom").disabled = $("quietTo").disabled = !on;
  const f = Number($("quietFrom").value), t = Number($("quietTo").value);
  // 같은 시각을 고르면 비어 있는 구간이다 — 켰는데 아무 일도 없으면 고장처럼 보이니 말해 준다
  $("quietNote").textContent = on && f === t
    ? "시작과 끝이 같으면 방해 금지가 적용되지 않습니다. 시간을 다르게 골라 주세요."
    : `회의·발표 중에 튀어나오면 곤란할 때. 자정을 넘겨도 됩니다(예: 오후 10시 ~ 오전 8시). "지금 불러오기"처럼 직접 부르는 건 막지 않습니다.`;
}
const sendQuiet = () => {
  showQuiet();
  send({ wildQuiet: { enabled: $("quietOn").checked, from: Number($("quietFrom").value), to: Number($("quietTo").value) } });
};
for (const id of ["quietOn", "quietFrom", "quietTo"]) on(id, "change", sendQuiet);
/* 버닝타임 — 두 구간(코어 · 야근)과 배수. 끝 시각의 0 은 자정이다 */
for (const i of [0, 1]) {
  $("burnF" + i).innerHTML = Array.from({ length: 24 }, (_, h) => `<option value="${h}">${hourLabel(h)}</option>`).join("");
  $("burnT" + i).innerHTML = Array.from({ length: 24 }, (_, h) => `<option value="${h}">${h === 0 ? "자정" : hourLabel(h)}</option>`).join("");
}
function burnValue() {
  return {
    enabled: $("burnOn").checked,
    mult: Number($("burnMult").value),
    weekdays: $("burnWeekdays").checked,
    spans: [0, 1].map((i) => ({ on: $("burnS" + i).checked, from: Number($("burnF" + i).value), to: Number($("burnT" + i).value) })),
  };
}
function showBurn() {
  const b = burnValue();
  for (const id of ["burnMult", "burnWeekdays", "burnS0", "burnS1"]) $(id).disabled = !b.enabled;
  for (const i of [0, 1]) $("burnF" + i).disabled = $("burnT" + i).disabled = !b.enabled || !b.spans[i].on;
  const empty = b.spans.some((s) => s.on && s.from === s.to);
  $("burnNote").textContent = !b.enabled
    ? "정해 둔 시간에 쓴 토큰은 성장을 몇 배로 쳐 줍니다. 꺼져 있습니다."
    : empty
      ? "시작과 끝이 같은 구간은 적용되지 않습니다. 시간을 다르게 골라 주세요."
      : `이 시간에 쓴 토큰은 키우는 아이가 ${b.mult}배로 자랍니다. 기록마다 쓴 시각을 보고 나눠서, 앱을 꺼 둔 동안 쓴 것도 제 시간대대로 칩니다. 자정을 넘겨도 됩니다. 나무열매(2배)와 겹치면 더해집니다(${b.mult + 1}배). 사탕은 그대로입니다.`;
}
const sendBurn = () => {
  showBurn();
  send({ burning: burnValue() });
};
for (const id of ["burnOn", "burnMult", "burnWeekdays", "burnS0", "burnF0", "burnT0", "burnS1", "burnF1", "burnT1"]) on(id, "change", sendBurn);

$("wildNow").onclick = async () => {
  const r = await window.ptb.wildSpawn();
  $("wildNote").textContent = r && r.ok ? "나타났습니다! 설정 창을 닫고 바탕화면을 보세요." : (r && r.reason) || "부르지 못했습니다";
};
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

/* ---------------- 읽는 곳 ---------------- */

const short = (p) => (p.length > 64 ? p.slice(0, 28) + " … " + p.slice(-32) : p);

/**
 * 경로마다 실제로 읽히는지까지 보여준다.
 *
 * 경로만 나열하면 오타를 알아챌 방법이 없다. 몇 개가 잡혔는지,
 * 값이 언제 것인지가 같이 보여야 맞게 넣었는지 알 수 있다.
 */
function renderPaths(r) {
  if (!r) return;
  const userRoots = r.roots || { claude: [], codex: [] };

  $("pathLogs").innerHTML = (r.logs || [])
    .map((d) => {
      const mine = (userRoots[d.id] || []).includes(d.path);
      const st = !d.exists ? "·" : d.dup ? "·" : d.files ? "✅" : "⚠️";
      const msg = !d.exists
        ? "폴더 없음"
        : d.dup
          ? "위와 같은 폴더 (건너뜀)"
          : d.files
            ? `${d.label} · 파일 ${d.files}개`
            : `${d.label} · 파일 0개`;
      return `
        <div class="pth">
          <span class="st">${st}</span>
          <div class="bd">
            <div class="p">${short(d.path)}</div>
            <div class="m ${d.files ? "on" : ""}">${msg}${mine ? " · 직접 추가함" : ""}</div>
          </div>
          ${mine ? `<button data-del="${d.id}" data-path="${d.path}">빼기</button>` : ""}
        </div>`;
    })
    .join("");

  $("pathQuota").innerHTML = (r.quota || [])
    .map((q) => {
      const ago =
        q.ageMs == null
          ? ""
          : q.ageMs < 3600000
            ? Math.round(q.ageMs / 60000) + "분 전 값"
            : Math.floor(q.ageMs / 3600000) + "시간 전 값";
      // 세션 로그에 섞여 오는 값은 파일이 아니라서 고를 대상이 없다
      const pickable = q.path !== "세션 로그 안에 포함";
      const custom = Boolean((r.files || {})[q.id]);
      return `
        <div class="pth">
          <span class="st">${q.ok ? "✅" : "·"}</span>
          <div class="bd">
            <div class="p">${short(q.path)}</div>
            <div class="m ${q.ok ? "on" : ""}">${q.label} · ${q.ok ? q.detail + " · " + ago : "읽지 못함"}${custom ? " · 직접 고름" : ""}</div>
          </div>
          ${pickable ? `<button data-qf="${q.id}">파일 고르기</button>` : ""}
          ${custom ? `<button data-qr="${q.id}">기본값</button>` : ""}
        </div>`;
    })
    .join("");
}

async function loadPaths() {
  renderPaths(await window.ptb.pathReport());
}

document.addEventListener("click", async (e) => {
  const add = e.target.closest("button[data-add]");
  if (add) {
    const p = await window.ptb.pickPath({ kind: "dir", title: add.dataset.add + " 로그 폴더" });
    if (p) renderPaths(await window.ptb.setLogRoot({ src: add.dataset.add, path: p }));
    return;
  }
  const del = e.target.closest("button[data-del]");
  if (del) {
    renderPaths(await window.ptb.setLogRoot({ src: del.dataset.del, path: del.dataset.path, remove: true }));
    return;
  }
  const qf = e.target.closest("button[data-qf]");
  if (qf) {
    const p = await window.ptb.pickPath({ kind: "file", title: "사용률 파일" });
    if (p) renderPaths(await window.ptb.setQuotaFile({ src: qf.dataset.qf, path: p }));
    return;
  }
  // 직접 고른 파일을 물릴 길이 있어야 한다. 잘못 고르면 되돌릴 방법이 없어진다.
  const qr = e.target.closest("button[data-qr]");
  if (qr) renderPaths(await window.ptb.setQuotaFile({ src: qr.dataset.qr, path: null }));
});

loadPaths();

$("openData").onclick = () => window.ptb.openDataFolder();

async function changeData(reset) {
  const r = await window.ptb.setDataDir({ reset });
  if (!r || !r.ok) {
    if (r && r.reason) $("dataDirNote").textContent = r.reason;
    return;
  }
  $("dataDirNote").textContent = r.dir + " — 앱을 다시 켜면 적용됩니다.";
}
$("pickData").onclick = () => changeData(false);
$("resetData").onclick = () => changeData(true);
$("reset").onclick = () => {
  window.ptb.resetProgress();
  // 방금 남긴 "초기화 직전"이 바로 목록에 보여야 되돌릴 수 있다는 걸 안다
  setTimeout(loadBackups, 300);
};

/* ---------------- 백업 ---------------- */

const KIND = { daily: "매일", "before-reset": "초기화 직전", "before-restore": "되돌리기 직전" };
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const when = (ms) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]}) ` +
    `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

async function loadBackups() {
  const list = (await window.ptb.listBackups()) || [];
  $("backupList").innerHTML = list.length
    ? list.map((b) => `
        <div class="pth">
          <div class="bd">
            <div class="p">${when(b.at)}</div>
            <div class="m">${KIND[b.kind] || b.kind} · ${b.ok ? b.mons + "마리" : "읽을 수 없음"}</div>
          </div>
          <button data-restore="${b.file}" ${b.ok ? "" : "disabled"}>되돌리기</button>
        </div>`).join("")
    : '<div class="note">아직 없습니다. 저장할 때 하루 한 개씩 쌓입니다.</div>';
}

$("backupList").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-restore]");
  if (!btn) return;
  btn.disabled = true;
  const r = await window.ptb.restoreBackup(btn.dataset.restore);
  btn.disabled = false;
  // 성공하면 앱이 다시 켜지므로 여기까지 오는 건 취소나 실패뿐이다
  if (r && r.reason) $("backupNote").textContent = r.reason;
});

loadBackups();
$("close").onclick = () => window.ptb.closeSettings();
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") window.ptb.closeSettings();
});

window.ptb.requestSettings();
