"use strict";
/**
 * 📢 새 소식 — 버전마다 무엇이 생기고 바뀌었나. 위 탭 줄 ⚙ 왼쪽의 📢 를 누르면 본다.
 *
 * docs/RELEASE-*.md 보다 짧게 — 버전마다 추가 · 변경 · 삭제를 한 줄씩. 설치 · 해시 · 알려진 한계는 거기에.
 * 새 버전을 낼 때 맨 위에 한 덩이를 더한다. 업데이트한 뒤 아직 안 열어 봤으면 📢 에 빨간 점이 붙는다.
 *
 *   { v: "0.14.5", add: ["…"], change: ["…"], remove: ["…"] }   — 없는 칸은 빼도 된다
 */
(function () {
  const NEWS = [
    {
      v: "0.15.2",
      add: ["🍬 사과 보상 — 로그가 지워져 사탕(💠 비트)이 0에 묶였던 세이브는 모자란 만큼 채우고 10개를 더 드림(한 번)"],
      change: ["0.15.1 로도 0개에서 안 움직이던 사탕 · 비트 고침"],
    },
    {
      v: "0.15.1",
      change: [
        "사탕 · 💠 비트가 안 쌓이던 것 고침 — Claude Code 가 30일 지난 로그를 지울 때마다 그만큼 깎이고 있었음",
        "누적 토큰(트레이 · 도구별 탭)이 로그가 지워져도 줄지 않음",
        "다른 세계에 가 있던 동안 옛 로그가 지워져도, 돌아오면 그 사이 쓴 만큼 다 따라잡음",
      ],
    },
    {
      v: "0.15.0",
      add: [
        "🦖 디지털 월드 — 위 탭 줄의 🌏 버튼으로 포켓몬 세계와 오가기, 같은 토큰으로 두 세계가 함께 자람",
        "디지몬 153종 — 움직이는 도트, Claude · Codex · 밤 버릇에 따라 백신 · 데이터 · 바이러스로 갈리는 진화",
        "디지코드 디지타마 · 💠 비트 · 💊 진화 캡슐 — 디지털 월드의 상점",
        "🧬 합체 — 두 디지몬을 합쳐야만 되는 조그레스 진화 23종",
        "⚔️ 필드 배틀 — 초원에서 실시간으로 싸우고, 테이머 게이지로 필살기 · 막기 · 힘내 · 그 자리 진화",
        "🌿 디지털 초원 — 디지털 월드의 기본 맵, 디지몬 가구 10종 · 디지바이스 도감",
      ],
      change: ["포켓몬 세계는 그대로 — 세이브 · 탭 · 상점 모두 전과 같음"],
    },
    {
      v: "0.14.8",
      add: [
        "⌨️ 단축키 — 어디서든 Ctrl + Alt + P 로 팝오버 열고 닫기, 설정 › 일반에서 바꾸기 · 끄기",
        "🔄 새 버전 확인 — 📢 새 소식 · 트레이 메뉴에서 지금 바로",
      ],
      change: [
        "절전에서 깨면 새 버전을 다시 확인 — 6시간 간격도 절전으로 밀리지 않게",
        "배율이 다른 화면(노트북 125% · 모니터 100%)을 오가면 팝오버가 점점 커지던 것 고침",
        "설정 › 한도에 300M · 1.5B 처럼 넣으면 못 읽던 것 고침",
      ],
    },
    {
      v: "0.14.7",
      add: [
        "🏆 챔피언 로드 — 배지 8개 뒤, 매주 관장 재대결 셋과 챔피언",
        "🏟️ 배지 진열장 — 방 벽에 딴 배지, 챔피언이면 금테",
        "길드원 배지 수 — 목록에 배지 · 🏆 횟수",
      ],
      change: ["배틀 탭을 열 때마다 체육관 정보를 새로"],
    },
    {
      v: "0.14.6",
      add: [
        "📊 주간 리포트 — 홈의 이번 주 줄 버튼, 요일 · 시간대 · 많이 자란 아이",
        "🌑 빛가림돌 — 졸업해도 이로치로 안 바뀜, 상점 🍬3",
        "🗓 출석 — 홈에서 바로",
      ],
    },
    {
      v: "0.14.5",
      add: ["📢 새 소식 — 버전마다 바뀐 점을 앱 안에서 보기"],
      change: ["박스 즐겨찾기 빈 하트(♡)가 잘 보이게"],
    },
    {
      v: "0.14.4",
      add: ["새 버전 알림 — 팝오버 띠, Windows 알림, 트레이 메뉴", "레이드 — 길드원 포켓몬도 쓰러지면 다음 아이가 자동 출전"],
      change: ["2단 진화(가디 → 윈디 등)는 9억에 바로 졸업"],
      remove: ["2단 진화의 3차 진화 단계"],
    },
    {
      v: "0.14.3",
      change: ["체육관 관장 강화 — 3~5마리, 레벨과 개체값 상승"],
    },
    {
      v: "0.14.2",
      add: ["길드 마크 12종", "홀 장식 5종, 홀 배경 2종(서울대 캠퍼스, 벚꽃 정원)"],
      change: ["모금함 — 다 모인 장식은 한 줄로 접기"],
    },
    {
      v: "0.14.1",
      change: ["레이드 — 내 포켓몬이 쓰러지면 다음 아이 자동 출전"],
    },
    {
      v: "0.14.0",
      add: ["체육관과 배지 8개 — 다 모으면 전설의 알", "사탕 타임 — 10~16시, 18~24시 사탕 ×1.5"],
      change: ["반동 기술 데미지 계산"],
    },
    {
      v: "0.13.5",
      add: ["박스 정렬", "♥ 즐겨찾기 — 위로 모으고 놓아주기, 팔기 막기"],
    },
  ];

  const KINDS = [["add", "추가"], ["change", "변경"], ["remove", "삭제"]];
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  let current = "";
  let unread = false;

  function render() {
    const at = NEWS.findIndex((n) => n.v === current);
    const openIdx = at >= 0 ? at : 0;
    $("newsList").innerHTML = NEWS.map((n, i) => {
      // "제목 — 설명" 은 제목 : 설명(흐리게)으로 보인다
      const line = (t) => {
        const [a, b] = String(t).split(" — ");
        return `<span class="tx">${esc(a)}${b ? `<span class="d"> : ${esc(b)}</span>` : ""}</span>`;
      };
      const rows = KINDS.flatMap(([k, label]) => (n[k] || []).map((t) => `<li><i class="k ${k}">${label}</i>${line(t)}</li>`));
      const sum = KINDS.filter(([k]) => (n[k] || []).length).map(([k, label]) => `${label} ${n[k].length}`).join('<i class="sep"></i>');
      return `
      <details class="news-v${n.v === current ? " cur" : ""}" ${i === openIdx ? "open" : ""}>
        <summary><b>v${esc(n.v)}</b>${n.v === current ? '<i class="tag">지금 버전</i>' : ""}<span class="cnt">${sum}</span></summary>
        <ul>${rows.join("")}</ul>
      </details>`;
    }).join("");
    $("newsCur").textContent = current ? `지금 v${current}` : "";
  }

  /** 갱신마다 — { version, unread } */
  function update(n) {
    if (!n) return;
    const changed = n.version !== current;
    current = n.version;
    unread = Boolean(n.unread);
    $("newsDot").hidden = !unread;
    if (changed || !$("newsList").innerHTML) render();
  }

  /** 📢 를 열었다 — 읽은 것으로 */
  function open() {
    render();
    if (unread) {
      unread = false;
      $("newsDot").hidden = true;
      window.ptb.newsSeen();
    }
  }

  /** 🔄 새 버전 확인 — 새 버전이면 위 띠가 저절로 뜬다(main 이 띠를 다시 보낸다) */
  async function check() {
    const btn = $("newsCheck"), out = $("newsChk");
    btn.disabled = true;
    out.hidden = false;
    out.className = "newschk";
    out.textContent = "GitHub 에 물어보는 중…";
    let r = null;
    try {
      r = await window.ptb.updateCheck();
    } catch {}
    btn.disabled = false;
    if (!r || !r.ok) {
      out.className = "newschk bad";
      out.textContent = "확인하지 못했습니다 — 인터넷 연결을 보고 잠시 뒤 다시 눌러 주세요";
    } else if (r.version) {
      out.className = "newschk new";
      out.textContent = `🆕 v${r.version}이 나왔습니다 — 위 띠의 [받기]`;
    } else {
      out.className = "newschk ok";
      out.textContent = `✅ v${r.current}이 가장 새 버전입니다`;
    }
  }
  $("newsCheck").onclick = check;

  window.ptbNews = { update, open };
})();
