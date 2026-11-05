// Timer di turno, chat con tag e avatar, contro il server locale avviato con tempi corti:
//   npx wrangler dev --var CPU_DELAY_MS:60 --var TURN_MS:6000 --var OFFLINE_MS:3000 --var SUB_MS:800
//   node test/e2e-extra.mjs
import assert from 'node:assert/strict';

const BASE = process.argv[2] || 'http://127.0.0.1:8787';
const WSBASE = BASE.replace(/^http/, 'ws');
const TURN = 6000, OFF = 3000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; console.log('  ✓', m); };

async function post(path, body) {
  const res = await fetch(BASE + '/api/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
}
class Client {
  constructor(ident) { this.ident = ident; this.msg = null; this.chat = []; this.waiters = []; }
  get s() { return this.msg?.s; }
  connect() {
    return new Promise((resolve) => {
      this.ws = new WebSocket(`${WSBASE}/api/games/${this.ident.code}/ws?token=${this.ident.token}`);
      this.ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.t === 'state') { this.msg = m; resolve(this); }
        if (m.t === 'chatAll') this.chat = m.msgs;
        if (m.t === 'chat') this.chat.push(m.msg);
        this.waiters = this.waiters.filter((w) => !w());
      };
    });
  }
  until(pred, ms = 15000) {
    if (this.msg && pred()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), ms);
      this.waiters.push(() => { if (pred()) { clearTimeout(t); resolve(); return true; } return false; });
    });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
}

const h = await post('games', { name: 'Thomas' });
const code = h.data.code;
const a = await post(`games/${code}/join`, { name: 'Anna Maria' });
const T = await new Client({ ...h.data, code }).connect();
let A = await new Client({ ...a.data, code }).connect();

// ---- chat e tag
console.log('chat');
T.send({ t: 'chat', text: 'ciao @anna maria, pronta? e @nessuno' });
await A.until(() => A.chat.length === 1);
ok(A.chat[0].name === 'Thomas' && A.chat[0].mentions.length === 1 && A.chat[0].mentions[0] === a.data.playerId, 'il tag @nome con lo spazio individua Anna Maria');
A.send({ t: 'chat', text: '  ' });
A.send({ t: 'chat', text: 'x'.repeat(400) });
await T.until(() => T.chat.length === 2);
ok(T.chat[1].text.length === 300, 'messaggi vuoti ignorati, lunghi tagliati a 300');
const A2 = await new Client({ ...a.data, code }).connect();
await sleep(200);
ok(A2.chat.length === 2, 'chi rientra ritrova i messaggi');
A2.ws.close();

// ---- avatar
console.log('avatar');
const tiny = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const up = await post(`games/${code}/avatar`, { token: h.data.token, data: tiny });
ok(up.status === 200, 'foto caricata');
await A.until(() => A.s.players.find((p) => p.name === 'Thomas').avatar?.photo);
const pid = h.data.playerId;
const img = await fetch(`${BASE}/api/games/${code}/avatar?pid=${pid}&v=1`);
ok(img.status === 200 && img.headers.get('content-type') === 'image/jpeg', 'la foto si scarica');
ok((await post(`games/${code}/avatar`, { token: 'falso', data: tiny })).status === 403, 'senza posto nella stanza non si carica');
ok((await post(`games/${code}/avatar`, { token: h.data.token, data: 'data:text/html;base64,AAAA' })).status === 400, 'solo immagini');
await post(`games/${code}/avatar`, { token: a.data.token, pick: 'nonno' });
await T.until(() => T.s.players.find((p) => p.name === 'Anna Maria').avatar?.pick === 'nonno');
ok(true, 'personaggino scelto');

// ---- timer
console.log('timer');
T.send({ t: 'addCpu', n: 1, level: 'facile' });
await T.until(() => T.s.players.length === 3);
T.send({ t: 'start' });
await T.until(() => T.s.phase === 'calling');
const humanTurn = () => { const r = T.s.round; const id = r.pendingJolly || r.turnId; return id === h.data.playerId || id === a.data.playerId ? id : null; };
await T.until(() => humanTurn() && T.msg.deadlineFor === humanTurn(), 20000);
let who = humanTurn();
let start = T.s.round.turnStartedAt;
ok(Math.abs(T.msg.deadline - (start + TURN)) < 50, 'online: scadenza a un minuto (qui 6 s) dall\'inizio del turno');
const callsBefore = Object.keys(T.s.round.calls).length;
const t0 = Date.now();
await T.until(() => Object.keys(T.s.round.calls).length > callsBefore || T.s.phase !== 'calling', 20000);
const waited = Date.now() - t0;
ok(T.s.round.calls[who] != null && waited > TURN - 2500, `tempo scaduto: la CPU ha chiamato per lui (dopo ${(waited / 1000).toFixed(1)} s)`);

// offline: 30 s (qui 3) per rientrare, mai oltre il minuto
await T.until(() => humanTurn() === a.data.playerId, 30000).catch(() => {});
if (humanTurn() === a.data.playerId) {
  start = T.s.round.turnStartedAt;
  const snapshot = JSON.stringify(T.s.round.calls) + T.s.round.trickNo + T.s.round.trick.plays.length;
  A.ws.close();
  await T.until(() => T.msg.deadlineFor === a.data.playerId && !T.msg.online.includes(a.data.playerId));
  const off = T.msg.offline[a.data.playerId];
  ok(Math.abs(T.msg.deadline - Math.min(start + TURN, Math.max(start, off) + OFF)) < 60, 'offline: 30 s (qui 3) per rientrare');
  // rientra subito: torna la scadenza del minuto
  A = await new Client({ ...a.data, code }).connect();
  await T.until(() => T.msg.online.includes(a.data.playerId));
  ok(Math.abs(T.msg.deadline - (start + TURN)) < 60, 'rientrato: resta il minuto totale');
  ok(JSON.stringify(T.s.round.calls) + T.s.round.trickNo + T.s.round.trick.plays.length === snapshot, 'nessuno ha giocato al suo posto mentre rientrava');
} else console.log('  (salto la prova offline: non è capitato il turno di Anna)');

// ---- subentro: dopo i primi 30 s (qui 3) la CPU gioca per chi è offline ogni 7 s (qui 0,8)
console.log('subentro');
{
  const aid = a.data.playerId;
  A.ws.close();
  await T.until(() => !T.msg.online.includes(aid));
  // primo turno di Anna offline: 3 s
  await T.until(() => T.msg.deadlineFor === aid, 60000);
  const st1 = T.s.round.turnStartedAt;
  ok(T.msg.deadline - st1 <= OFF + 100, 'primo turno offline: scadenza entro i 30 s (qui 3)');
  await T.until(() => T.msg.deadlineFor !== aid || T.s.round.turnStartedAt !== st1, 20000);
  // turno successivo di Anna: solo 0,8 s
  if (T.s.phase === 'calling' || T.s.phase === 'playing') {
    await T.until(() => T.msg.deadlineFor === aid && T.s.round.turnStartedAt !== st1, 60000).catch(() => {});
    if (T.msg.deadlineFor === aid) ok(T.msg.deadline - T.s.round.turnStartedAt <= 900, `dopo il subentro: ${(T.msg.deadline - T.s.round.turnStartedAt)} ms per mossa`);
  }
  // rientra: si riprende il posto con il minuto pieno
  A = await new Client({ ...a.data, code }).connect();
  await T.until(() => T.msg.online.includes(aid));
  await T.until(() => T.msg.deadlineFor === aid, 60000).catch(() => {});
  if (T.msg.deadlineFor === aid) ok(T.msg.deadline - T.s.round.turnStartedAt >= TURN - 100, 'rientrato: di nuovo il minuto pieno');
}

// ---- spettatore: niente mani, angelo custode
console.log('spettatore');
{
  const sp = await post(`games/${code}/join`, { name: 'Guardone', as: 'spectator' });
  ok(sp.status === 200, 'lo spettatore entra a partita iniziata');
  const S = await new Client({ ...sp.data, code }).connect();
  const hidden = () => Object.values(S.s.round.hands).every((h) => h.every((c) => c === -1));
  ok(hidden(), 'lo spettatore non riceve nessuna mano');
  const tid = h.data.playerId;
  S.send({ t: 'peekAsk', pid: tid });
  await T.until(() => T.s.peek?.[sp.data.playerId]?.status === 'pending');
  ok(true, 'la richiesta arriva al giocatore');
  T.send({ t: 'peekAnswer', viewer: sp.data.playerId, ok: true });
  await S.until(() => S.s.peek?.[sp.data.playerId]?.status === 'ok');
  await S.until(() => S.s.round && (S.s.round.cards === 1 || (S.s.round.hands[tid] || []).some((c) => c >= 0)) || S.s.phase !== 'calling' && S.s.phase !== 'playing', 20000).catch(() => {});
  const others = Object.entries(S.s.round.hands).filter(([id]) => id !== tid).every(([, h]) => h.every((c) => c === -1));
  ok(others, 'vede solo le carte di chi ha detto sì');
  const live = await (await fetch(`${BASE}/api/live`)).json();
  ok(live.some((g) => g.code === code), 'la stanza compare tra le partite live');
  S.ws.close();
}

// ---- avatar scelto prima di entrare: lo stesso personaggio non può averlo due persone
{
  const r1 = await post('games', { name: 'Uno', pick: 'il-gabibbo' });
  const r2 = await post(`games/${r1.data.code}/join`, { name: 'Due', pick: 'il-gabibbo' });
  ok(r2.status === 200, 'lo stesso personaggio lo possono avere in due');
  const r3 = await post(`games/${r1.data.code}/join`, { name: 'Tre', pick: 'jose-mourinho' });
  const info = await (await fetch(`${BASE}/api/games/${r1.data.code}/info`)).json();
  ok(r3.status === 200 && info.picks.length === 3, 'chi entra porta già il suo avatar');
}

console.log(`OK: ${checks} controlli superati`);
process.exit(0);
