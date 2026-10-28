"use strict";
/**
 * 상점 탭의 "🛒 길드 몰"과 "포켓몬을 상점에 팔기" — 코인(🪙) 쪽 화면.
 *
 * 코인은 서버가 들고 있다. 여기서는 메인(index.js 코인·몰 칸)에 묻고 받은 걸 그린다.
 * 몰은 길드원끼리 포켓몬을 사고판다 — 올리면 내 박스에서 빠져 서버가 맡고, 팔리면 산 사람에게 간다.
 * 상점에 팔기는 사람 대신 상점이 바로 사 준다(박스 정리). 값은 서버가 다시 센다.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  let view = "shop";
  let last = null; // 마지막 갱신
  let wallet = null; // 마지막으로 받은 지갑
  let market = null; // 마지막으로 받은 몰
  let busy = false;

  const done = (r) => {
    if (!r || !r.ok) { if (r && r.reason) toast(r.reason, "bad"); return false; }
    if (r.message) toast(r.message);
    return true;
  };
  /** 한 번 더 눌러야 실행 — 되돌릴 수 없는 버튼 */
  function sure(btn, label) {
    if (btn.dataset.sure === "1") return true;
    btn.dataset.sure = "1";
    const was = btn.innerHTML;
    btn.textContent = label;
    setTimeout(() => { if (btn.isConnected) { btn.dataset.sure = ""; btn.innerHTML = was; } }, 3000);
    return false;
  }

  /* ---------------- 바꾸기 ---------------- */

  $("shSwitch").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-view]");
    if (!b) return;
    view = b.dataset.view;
    for (const x of $("shSwitch").querySelectorAll("button")) x.classList.toggle("on", x === b);
    $("shShop").hidden = view !== "shop";
    $("shMall").hidden = view !== "mall";
    open();
  });

  /** 상점 탭을 열거나 바꿀 때 — 지갑(과 몰)을 새로 받는다 */
  async function open() {
    await loadWallet();
    if (view === "mall") await loadMarket();
  }

  /* ---------------- 지갑 ---------------- */

  async function loadWallet() {
    const r = await window.ptb.walletInfo();
    wallet = r && r.ok ? r : null;
    if (r && r.ok && r.created) toast("코인 지갑을 만들었습니다 — 출석 · 환전 · 상점에 팔기로 코인을 모으세요", "shiny");
    renderWallet(r);
    renderSell();
  }

  /** 새 지갑이면 몰에서 사기까지 남은 시간(시) — 부계정으로 코인을 몰아주지 못하게 서버가 막는다 */
  const waitH = () => (wallet && wallet.canBuyAt > Date.now() ? Math.ceil((wallet.canBuyAt - Date.now()) / 3_600_000) : 0);

  function renderWallet(r) {
    $("shCoin").textContent = wallet ? `🪙 ${wallet.balance}` : "";
    if (!r || !r.ok) {
      $("mlWallet").innerHTML = `<div class="ml-off">🪙 코인 — ${esc((r && r.reason) || "지갑을 불러오지 못했습니다")}${r && r.offline ? ' <button class="mini2" id="mlSettings">설정 열기</button>' : ""}</div>`;
      return;
    }
    const w = wallet;
    $("mlWallet").innerHTML = `
      <div class="bal"><span class="lab">코인</span><b>🪙 ${w.balance}</b></div>
      <div class="acts">
        <button class="mini2" id="mlCheckin" ${w.checkedIn ? "disabled" : ""}>${w.checkedIn ? "오늘 출석 ✓" : "출석 +🪙10"}</button>
        <span class="ex">🍬
          <select id="mlExN">${[1, 2, 3, 4, 5].filter((n) => n <= Math.max(1, w.exLeft)).map((n) => `<option value="${n}">${n}</option>`).join("")}</select>
          → 🪙<span id="mlExGet">5</span>
          <button class="mini2" id="mlEx" ${w.exLeft <= 0 || w.candy < 1 ? "disabled" : ""}>환전</button>
        </span>
        <span class="ex">🪙<span id="mlCbCost">${w.candyCoins}</span> →
          🍬<select id="mlCbN">${[1, 2, 3, 4, 5].filter((n) => n <= Math.max(1, w.cbLeft)).map((n) => `<option value="${n}">${n}</option>`).join("")}</select>
          <button class="mini2" id="mlCb" ${w.cbLeft <= 0 || w.balance < w.candyCoins ? "disabled" : ""}>사탕 사기</button>
        </span>
      </div>
      <div class="sub">사탕 → 코인은 하루 사탕 ${5}개까지(오늘 ${w.exLeft}개 남음 · 가진 사탕 🍬${w.candy}).
        코인 → 사탕은 🍬1에 🪙${w.candyCoins}, 하루 5개까지(오늘 ${w.cbLeft}개 남음). 코인은 서버에 있어 PC 를 바꿔도 세이브만 있으면 그대로입니다.${
        waitH() ? `<br>새 지갑이라 <b>${waitH()}시간 뒤</b>부터 몰에서 살 수 있습니다. 파는 건 바로 됩니다.` : ""}</div>`;
  }

  $("mlWallet").addEventListener("change", (e) => {
    if (e.target.id === "mlExN") $("mlExGet").textContent = Number(e.target.value) * 5;
    if (e.target.id === "mlCbN" && wallet) $("mlCbCost").textContent = Number(e.target.value) * wallet.candyCoins;
  });
  $("mlWallet").addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled || busy) return;
    busy = true;
    try {
      if (b.id === "mlSettings") return void window.ptb.openSettings();
      if (b.id === "mlCheckin") done(await window.ptb.walletCheckin());
      if (b.id === "mlEx") done(await window.ptb.walletExchange(Number($("mlExN").value)));
      if (b.id === "mlCb") done(await window.ptb.walletBuyCandy(Number($("mlCbN").value)));
      await loadWallet();
    } finally {
      busy = false;
    }
  });

  /* ---------------- 상점에 팔기 ---------------- */

  function renderSell() {
    const s = last;
    if (!s) return;
    const online = Boolean(s.online && s.online.enabled);
    $("ssLeft").textContent = wallet ? `오늘 ${wallet.sellLeft}마리 · 🪙${wallet.sellCoinsLeft}까지` : "";
    if (!online) {
      $("ssList").innerHTML = '<div class="note">설정 › 온라인 기능을 켜야 팔 수 있습니다. 코인은 서버가 들고 있습니다.</div>';
      return;
    }
    const list = (s.box || []).filter((m) => m.stageKey !== "egg").sort((a, b) => (a.sellPrice || 0) - (b.sellPrice || 0));
    const last1 = (s.box || []).length <= 1;
    $("ssList").innerHTML = list.length
      ? list.map((m) => `<div class="ss-row">
          <div class="pic">${m.url ? `<img src="${esc(m.url)}" alt="">` : ""}</div>
          <div class="t"><b>${esc(m.name)}${m.shiny ? " ★" : ""}</b>${m.active ? '<span class="tag">키우는 중</span>' : ""}${m.isPet ? '<span class="tag pet">바탕화면</span>' : ""}
            <span>${m.profile ? "Lv." + m.profile.level + " · " : ""}${"★".repeat(m.stars)} ${esc(m.stage)}</span></div>
          <button class="mini2" data-sell="${esc(m.id)}" ${last1 || !wallet || wallet.sellLeft <= 0 ? "disabled" : ""}>🪙${m.sellPrice || 0} 팔기</button>
        </div>`).join("")
      : '<div class="note">팔 수 있는 아이가 없습니다(알은 팔 수 없습니다).</div>';
  }

  $("ssList").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-sell]");
    if (!b || b.disabled || busy) return;
    if (!sure(b, "정말 팔기?")) return;
    busy = true;
    try {
      done(await window.ptb.shopSell(b.dataset.sell));
      await loadWallet();
    } finally {
      busy = false;
    }
  });

  /* ---------------- 길드 몰 ---------------- */

  async function loadMarket() {
    $("mlRefresh").disabled = true;
    const r = await window.ptb.marketView();
    $("mlRefresh").disabled = false;
    if (!r || !r.ok) {
      market = null;
      $("mlBody").hidden = true;
      $("mlGate").hidden = false;
      $("mlGate").innerHTML = `<b>${esc((r && r.reason) || "몰을 불러오지 못했습니다")}</b>${
        r && r.noGuild ? '<p>길드 몰은 같은 길드원끼리 포켓몬을 코인으로 사고파는 곳입니다. 방 탭 › 🏰 길드에서 만들거나 들어가 주세요.</p>' : ""}`;
      return;
    }
    market = r;
    $("mlGate").hidden = true;
    $("mlBody").hidden = false;
    renderMarket();
  }

  function renderMarket() {
    const r = market;
    if (!r) return;
    const open = r.listings.filter((l) => l.state === "open" && !l.expired);
    $("mlCount").textContent = `${open.length}마리`;
    $("mlList").innerHTML = open.length
      ? open.map((l) => {
        const canBuy = !l.mine && l.valid && wallet && wallet.balance >= l.price && !waitH();
        // 못 살 때는 왜 못 사는지 단추 옆에 — 말없이 흐린 단추만 있으면 고장 난 줄 안다
        const why = l.mine || !l.valid || canBuy ? "" : !wallet ? "지갑 불러오는 중" : waitH() ? `새 지갑 — ${waitH()}시간 뒤부터` : `코인 부족 (🪙${wallet.balance})`;
        const left = Math.max(0, Math.ceil((l.expires - Date.now()) / 86_400_000));
        return `<div class="ml-card${l.mine ? " mine" : ""}${l.legendary ? " legend" : ""}">
          <div class="pic">${l.animUrl || l.url ? `<img src="${esc(l.animUrl || l.url)}" alt="">` : ""}</div>
          <div class="nm">${esc(l.name)}${l.shiny ? " ★" : ""} <span class="lv">Lv.${l.level ?? "?"}</span></div>
          <div class="ty">${(l.typeKeys || []).map((k, i) => `<span class="t t-${k}">${esc(l.types[i])}</span>`).join("")}<span class="st">${"★".repeat(l.stars)} ${esc(l.stage)}</span></div>
          <div class="meta">개체값 ${l.ivTotal}/186 · ${esc(l.nature)} · ${esc(l.ability || "")}</div>
          ${l.passives.length ? `<div class="meta">패시브 ${l.passives.map(esc).join(", ")}</div>` : ""}
          ${l.evolvesTo ? `<div class="evo">데려오면 ${esc(l.evolvesTo)}(으)로 진화!</div>` : ""}
          ${l.hold ? '<div class="meta">🪨 변하지않는돌을 지니고 온다</div>' : ""}
          ${!l.valid ? `<div class="bad">읽을 수 없는 매물 — ${esc(l.invalidWhy || "")}</div>` : ""}
          <div class="ft"><span>${esc(l.seller)} · ${left}일 남음</span>
            ${l.mine ? `<button class="mini2" data-cancel="${esc(l.id)}">돌려받기</button>`
              : `${why ? `<span class="why">${esc(why)}</span>` : ""}<button class="mini2 buy" data-buy="${esc(l.id)}" ${canBuy ? "" : "disabled"}>🪙${l.price} 사기</button>`}
          </div>
        </div>`;
      }).join("")
      : '<div class="note">아직 올라온 포켓몬이 없습니다. 아래에서 첫 매물을 올려 보세요.</div>';

    $("mlSales").innerHTML = r.sales.length
      ? r.sales.map((s) => `<div class="sale"><span>${esc(s.name)}${s.shiny ? " ★" : ""}</span><span>${esc(s.seller)} → ${esc(s.buyer)}</span><b>🪙${s.price}</b></div>`).join("")
      : '<div class="note">아직 거래가 없습니다.</div>';
    renderPick();
  }

  /** 올리기 — 고를 아이와 참고 가격(상점 판매가 · 같은 종의 최근 거래가) */
  function renderPick() {
    const s = last;
    if (!s) return;
    const keep = $("mlPick").value;
    const list = (s.box || []).filter((m) => m.stageKey !== "egg");
    $("mlPick").innerHTML = list.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}${m.shiny ? " ★" : ""} · ${m.profile ? "Lv." + m.profile.level : ""} · ${"★".repeat(m.stars)}</option>`).join("");
    if (list.some((m) => m.id === keep)) $("mlPick").value = keep;
    hint();
  }

  function hint() {
    const m = last && (last.box || []).find((x) => x.id === $("mlPick").value);
    if (!m) return void ($("mlHint").textContent = "올릴 수 있는 아이가 없습니다.");
    const same = market ? market.sales.filter((x) => x.name === m.name) : [];
    const avg = same.length ? Math.round(same.reduce((a, x) => a + x.price, 0) / same.length) : null;
    const suggest = avg || Math.max(5, (m.sellPrice || 1) * 4);
    if (!$("mlPrice").value || $("mlPrice").dataset.auto === "1") { $("mlPrice").value = suggest; $("mlPrice").dataset.auto = "1"; }
    $("mlHint").innerHTML = `참고 — 상점 판매가 🪙${m.sellPrice || 0}${avg ? ` · 최근 거래 평균 🪙${avg} (${same.length}건)` : " · 이 종은 아직 거래가 없습니다"}. 올리면 박스에서 빠지고, 팔리면 🪙${Math.max(0, ($("mlPrice").value | 0) - Math.floor(($("mlPrice").value | 0) * 0.05))}을 받습니다.`;
  }

  $("mlPick").addEventListener("change", () => { $("mlPrice").dataset.auto = "1"; hint(); });
  $("mlPrice").addEventListener("input", () => { $("mlPrice").dataset.auto = "0"; hint(); });
  $("mlRefresh").onclick = () => loadMarket();

  $("mlPut").onclick = async () => {
    if (busy) return;
    if (!sure($("mlPut"), "정말 올리기?")) return;
    busy = true;
    $("mlPut").disabled = true;
    try {
      if (done(await window.ptb.marketList({ id: $("mlPick").value, price: Number($("mlPrice").value) }))) $("mlPrice").dataset.auto = "1";
      await loadMarket();
    } finally {
      busy = false;
      $("mlPut").disabled = false;
    }
  };

  $("mlList").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-buy],button[data-cancel]");
    if (!b || b.disabled || busy) return;
    if (!sure(b, b.dataset.buy ? "정말 사기?" : "정말 돌려받기?")) return;
    busy = true;
    try {
      done(b.dataset.buy ? await window.ptb.marketBuy(b.dataset.buy) : await window.ptb.marketCancel(b.dataset.cancel));
      await loadWallet();
      await loadMarket();
    } finally {
      busy = false;
    }
  });

  window.ptb.onStats((s) => {
    last = s;
    renderSell();
    if (market) renderPick();
  });

  window.ptbMall = { open };
})();
