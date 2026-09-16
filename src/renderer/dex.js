"use strict";
const $ = (id) => document.getElementById(id);

let entries = [];
let onlyGot = false;

function stars(n) {
  return "★".repeat(n) + `<span class="off">${"★".repeat(5 - n)}</span>`;
}

function render() {
  const list = onlyGot ? entries.filter((e) => e.seen) : entries;
  if (!list.length) {
    $("grid").innerHTML = '<div class="empty">아직 모은 포켓몬이 없습니다</div>';
    return;
  }
  $("grid").innerHTML = list
    .map((e) => {
      if (!e.seen) {
        // 안 만난 종은 이름도 그림도 안 보여준다. 번호만 남긴다.
        return `<div class="cell locked" title="아직 만나지 않음">
            <div class="q">?</div><div class="nm">No.${e.index + 1}</div>
          </div>`;
      }
      const pic = e.url
        ? `<img src="${e.url}" alt="">`
        : '<div class="q">?</div>';
      const grad = e.graduated
        ? `<div class="badge">졸업 ${e.graduated}</div>`
        : e.complete
          ? ""
          : `<div class="wip">${e.stage}</div>`; // 아직 최종 진화를 못 본 라인
      const cls = ["cell", e.graduated ? "grad" : "", e.isPet ? "pet" : ""].join(" ");
      return `<div class="${cls}" data-line="${e.index}" title="${e.name} · ${e.label}
클릭하면 바탕화면 펫으로 지정합니다">
          ${e.isPet ? '<div class="pin">바탕화면</div>' : ""}
          ${pic}<div class="nm">${e.name}</div>
          <div class="st">${stars(e.stars)}</div>${grad}
        </div>`;
    })
    .join("");
}

window.ptb.onDex((d) => {
  entries = d.entries;
  $("count").innerHTML =
    `<b>${d.seen}</b> / ${d.total}` + (d.graduated ? `  ·  졸업 ${d.graduated}마리` : "");
  render();
});

// 만난 칸을 클릭하면 바탕화면 펫으로 세운다.
$("grid").addEventListener("click", (e) => {
  const cell = e.target.closest(".cell[data-line]");
  if (!cell) return;
  window.ptb.setPetLine(Number(cell.dataset.line));
});

$("fAll").onclick = () => {
  onlyGot = false;
  $("fAll").classList.add("on");
  $("fGot").classList.remove("on");
  render();
};
$("fGot").onclick = () => {
  onlyGot = true;
  $("fGot").classList.add("on");
  $("fAll").classList.remove("on");
  render();
};
$("close").onclick = () => window.ptb.closeDex();
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") window.ptb.closeDex();
});

window.ptb.requestDex();
