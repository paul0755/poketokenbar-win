/**
 * PokeTokenBar 실시간 배틀 중계 서버 — Cloudflare Workers + Durable Objects.
 *
 * ── 하는 일은 딱 둘이다 ──
 *   1) 같은 방 코드로 들어온 두 사람에게 서로의 팀 코드(PTB1-…)를 전해 준다
 *   2) 둘 다 "준비"를 누르면 "언제 시작할지"를 정해 둘에게 같은 시각을 알린다
 *
 * 결투 계산은 하지 않는다. 두 앱이 같은 두 코드로 같은 결투를 계산한다(친선 배틀과 같다).
 * 아무것도 저장하지 않는다 — 방은 연결이 살아 있는 동안만 있다. 토큰 기록은 오지도 않는다.
 *
 * ── 주소 ──
 *   GET /                     살아 있는지 확인
 *   GET /room/123456?role=host|guest   (웹소켓)  방 만들기 / 참가
 */
const PROTOCOL = 1;
const MAX_MSG = 2048; // 팀 코드가 150자 남짓이다. 넉넉히 잡아도 2KB 를 넘을 일이 없다
const START_DELAY_MS = 3500; // 카운트다운 — 둘 다 화면을 볼 시간

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = /^\/room\/(\d{6})$/.exec(url.pathname);
    if (!m) return new Response(`PokeTokenBar relay (protocol ${PROTOCOL})`, { headers: { "content-type": "text/plain; charset=utf-8" } });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("websocket only", { status: 426 });
    // 방 코드마다 Durable Object 하나. 같은 코드면 전 세계 어디서 붙어도 같은 방이다
    return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(request);
  },
};

export class Room {
  constructor(state) {
    this.state = state;
  }

  /** 이 방에 붙어 있는 사람. role 은 host / guest */
  sockets() {
    return this.state.getWebSockets().map((ws) => ({ ws, a: ws.deserializeAttachment() || {} }));
  }
  find(role) {
    return this.sockets().find((x) => x.a.role === role) || null;
  }

  send(ws, msg) {
    try {
      ws.send(JSON.stringify({ ...msg, now: Date.now() })); // now — 앱이 서버 시계와의 차이를 잰다
    } catch {}
  }

  async fetch(request) {
    const role = new URL(request.url).searchParams.get("role");
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    // 받은 뒤에 거절해야 앱이 이유를 읽을 수 있다
    this.state.acceptWebSocket(server);

    const refuse = (reason) => {
      this.send(server, { t: "error", reason });
      server.close(4000, "refused");
    };
    if (role !== "host" && role !== "guest") refuse("잘못된 접속입니다");
    else if (role === "host" && this.find("host")) refuse("이미 있는 방 코드입니다. 다시 만들어 주세요");
    else if (role === "guest" && !this.find("host")) refuse("없는 방입니다. 코드를 확인해 주세요");
    else if (role === "guest" && this.find("guest")) refuse("이미 두 명이 들어와 있는 방입니다");
    else {
      server.serializeAttachment({ role, ready: false });
      this.send(server, { t: "joined", role, protocol: PROTOCOL });
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== "string" || raw.length > MAX_MSG) return this.send(ws, { t: "error", reason: "메시지가 너무 깁니다" });
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const me = ws.deserializeAttachment() || {};
    if (!me.role) return;
    const peer = this.find(me.role === "host" ? "guest" : "host");

    if (msg.t === "hello") {
      // 서버는 코드 내용을 믿지도 해석하지도 않는다 — 꼴만 보고 넘긴다. 검사는 앱이 한다
      const team = String(msg.team || "");
      if (!/^PTB1-[A-Za-z0-9_-]+-[0-9a-z]{5}$/.test(team) || team.length > 600) return this.send(ws, { t: "error", reason: "팀 코드가 올바르지 않습니다" });
      const changed = Boolean(me.team) && me.team !== team; // 방 안에서 포켓몬을 바꿨다
      me.team = team;
      me.name = String(msg.name || "").slice(0, 16);
      me.ready = false;
      ws.serializeAttachment(me);
      if (peer && peer.a.team) {
        // 한쪽이 바꾸면 양쪽 준비를 다 내린다 — 상대가 모르는 사이 바뀐 포켓몬과 싸우지 않게
        if (peer.a.ready) {
          peer.a.ready = false;
          peer.ws.serializeAttachment(peer.a);
        }
        this.send(ws, { t: "peer", name: peer.a.name, team: peer.a.team });
        this.send(peer.ws, { t: "peer", name: me.name, team: me.team, changed });
      }
      return;
    }

    if (msg.t === "ready") {
      if (!me.team || !peer || !peer.a.team) return;
      me.ready = true;
      ws.serializeAttachment(me);
      this.send(peer.ws, { t: "peerReady" });
      if (peer.a.ready) {
        // 둘 다 준비 — 같은 시각에 시작한다. 다음 판을 위해 준비는 다시 내린다
        const at = Date.now() + START_DELAY_MS;
        for (const x of [ws, peer.ws]) {
          const a = x.deserializeAttachment() || {};
          a.ready = false;
          x.serializeAttachment(a);
          this.send(x, { t: "start", at });
        }
      }
      return;
    }

    if (msg.t === "ping") this.send(ws, { t: "pong" });
  }

  async webSocketClose(ws) {
    const me = ws.deserializeAttachment() || {};
    const peer = this.find(me.role === "host" ? "guest" : "host");
    if (peer && peer.ws !== ws) this.send(peer.ws, { t: "left" });
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }
}
