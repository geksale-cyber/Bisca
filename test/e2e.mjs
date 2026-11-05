// Test end-to-end del multiplayer contro il server locale:
//   npx wrangler dev --var CPU_DELAY_MS:60 --var PROXY_DELAY_MS:1500
//   node test/e2e.mjs [http://127.0.0.1:8787]
import assert from 'node:assert/strict';

const BASE = process.argv[2] || 'http://127.0.0.1:8787';
const WSBASE = BASE.replace(/^http/, 'ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

async function post(path, body) {
  const res = await fetch(BASE + '/api/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
}

class Client {
  constructor(name, ident) { this.name = name; this.ident = ident; this.msg = null; this.errors = []; this.waiters = []; }
  get s() { return this.msg?.s; }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${WSBASE}/api/games/${this.ident.code}/ws?token=${this.ident.token}`);
      this.ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.t === 'state') { this.msg = m; this.waiters = this.waiters.filter((w) => !w()); resolve(this); }
        if (m.t === 'error') this.errors.push(m.msg);
        if (m.t === 'kicked') this.kicked = true;
      };
      this.ws.onerror = reject;
    });
  }
  until(pred, ms = 8000) {
    if (this.msg && pred(this.s, this.msg)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${this.name}: timeout`)), ms);
      this.waiters.push(() => { if (pred(this.s, this.msg)) { clearTimeout(t); resolve(); return true; } return false; });
    });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  close() { this.ws.close(); }
}

ok((await (await fetch(BASE + '/api/ping')).json()).ok, 'ping');

// ---- stanza: crea, entra, nome già usato
const h = await post('games', { name: 'Thomas' });
const code = h.data.code;
ok(/^[A-Z0-9]{5}$/.test(code), 'codice stanza');
const a = await post(`games/${code}/join`, { name: 'Anna' });
ok(a.status === 200, 'Anna entra');
const dup = await post(`games/${code}/join`, { name: 'anna' });
ok(dup.status === 400 && /già usato/.test(dup.data.error), 'nome già usato rifiutato');

const T = await new Client('Thomas', { ...h.data, code }).connect();
const A = await new Client('Anna', { ...a.data, code }).connect();
ok(T.s.hostId === T.msg.me && A.s.hostId !== A.msg.me, 'host giusto');

// ---- CPU e cambio nome
A.send({ t: 'addCpu', n: 1, level: 'medio' });
await sleep(150);
ok(A.errors.some((e) => /Solo chi ha creato/.test(e)), 'solo l\'host aggiunge CPU');
T.send({ t: 'addCpu', n: 2, level: 'facile' });
await T.until((s) => s.players.filter((p) => p.cpu).length === 2);
const cpus = T.s.players.filter((p) => p.cpu);
ok(cpus.map((p) => p.name).join(',') === 'CPU1,CPU2', 'nomi CPU1, CPU2');
ok(cpus.every((p) => p.cpu.level === 'facile' && !p.cpu.persona), 'livello visibile, carattere nascosto');
T.send({ t: 'cpuLevel', pid: cpus[1].id, level: 'difficile' });
await T.until((s) => s.players.find((p) => p.id === cpus[1].id).cpu.level === 'difficile');
ok(true, 'cambio livello CPU');
T.send({ t: 'remove', pid: cpus[0].id });
await T.until((s) => s.players.length === 3);
T.send({ t: 'addCpu', n: 1, level: 'medio' });
await T.until((s) => s.players.length === 4);
ok(T.s.players.some((p) => p.name === 'CPU3'), 'la numerazione continua (CPU3)');
A.send({ t: 'rename', name: 'thomas' });
await sleep(150);
ok(A.errors.some((e) => /già usato/.test(e)), 'rinomina con nome usato rifiutata');
A.send({ t: 'rename', name: 'Annina' });
await T.until((s) => s.players.some((p) => p.name === 'Annina'));
ok(true, 'rinomina in sala');

// ---- partita: le CPU giocano da sole, gli umani a mano
T.send({ t: 'start' });
await T.until((s) => s.phase === 'calling');
ok(T.s.round.seats.length === 4, '4 al tavolo');
const late = await post(`games/${code}/join`, { name: 'Tardi' });
ok(late.status === 400 && late.data.started, 'partita iniziata: si entra solo a guardare');
const humans = { [T.msg.me]: T, [A.msg.me]: A };
let guard = 0, rounds = 0;
while (T.s.phase !== 'finished') {
  if (++guard > 4000) throw new Error('troppe mosse');
  const s = T.s, r = s.round;
  if (s.phase === 'roundEnd') {
    rounds++;
    for (const c of [T, A]) if (!s.players.find((p) => p.id === c.msg.me).eliminated) c.send({ t: 'ready' });
    await T.until((x) => x.phase !== 'roundEnd' || x.round.n !== r.n, 10000);
    continue;
  }
  const actor = r.pendingJolly || r.turnId;
  const c = humans[actor];
  if (!c) { await T.until((x) => x !== s, 10000); continue; }
  await c.until((x) => (x.round.pendingJolly || x.round.turnId) === actor && x.round.trickNo === r.trickNo && x.round.trick.plays.length === r.trick.plays.length && x.phase === s.phase);
  const v = c.s.round;
  // privacy: le carte degli altri non si vedono (salvo turno da 1)
  for (const id of v.seats) if (id !== actor && v.cards > 1) ok(v.hands[id].every((x) => x === -1), 'mani altrui nascoste');
  if (s.phase === 'calling') {
    let n = 0; const forb = (() => { if (actor !== v.dealerId) return null; const sum = Object.values(v.calls).reduce((p, q) => p + q, 0); return v.cards - sum; })();
    if (n === forb) n = 1;
    c.send({ t: 'call', n });
  } else if (v.pendingJolly) c.send({ t: 'jolly', v: 'low' });
  else if (v.cards === 1) c.send({ t: 'play' });
  else { const card = v.hands[actor][0]; c.send({ t: 'play', card, jolly: card === 30 ? 'low' : undefined }); }
  await T.until((x) => x !== s);
}
ok(T.s.winners.length >= 1, 'partita finita con un vincitore');
console.log(`partita finita dopo ${rounds} turni, vincitori: ${T.s.winners.map((id) => T.s.players.find((p) => p.id === id).name).join(', ')}`);

// ---- archivio: le decisioni umane sono state registrate
const prof = await (await fetch(BASE + '/api/profiles')).json();
ok(prof.byName && prof.byName.thomas && prof.byName.annina, 'profili Thomas e Annina nell\'archivio');

// ---- torna in lobby
A.send({ t: 'toLobby' });
await T.until((s) => s.phase === 'lobby');
ok(T.s.players.length === 4 && T.s.players.every((p) => p.lives === 3), 'di nuovo in sala con gli stessi giocatori');
ok(T.s.lastWinners?.length >= 1, 'ricorda chi ha vinto');

// ---- esce dal menu principale
A.send({ t: 'leave' });
await T.until((s) => s.players.length === 3);
ok(A.kicked, 'chi esce viene scollegato');
T.send({ t: 'leave' });
await sleep(200);
ok((await fetch(`${BASE}/api/games/${code}/ws?token=${h.data.token}`)).status === 403, 'l\'host è uscito');

console.log(`OK: ${checks} controlli superati`);
for (const c of [T, A]) try { c.close(); } catch {}
process.exit(0);
