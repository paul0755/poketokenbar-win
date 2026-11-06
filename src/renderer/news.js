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

  window.ptbNews = { update, open };
})();
