// Bisca — app web: home, single player contro la CPU e multiplayer con le stanze.
// Le regole sono in lib/engine.js, la CPU in lib/ai.js: le stesse usate dal server.
// Il tavolo si disegna allo stesso modo nelle due modalità: cambia solo chi tiene lo
// stato (il telefono in single player, il server in multiplayer).

import * as E from './lib/engine.js';
import * as AI from './lib/ai.js';
import * as Q from './lib/quick.js';
import * as T from './lib/tutorial.js';

const JOLLY = 30;
const SUITS = ['bastoni', 'spade', 'coppe', 'denari'];
const RANKS = ['Asso', 'Due', 'Tre', 'Quattro', 'Cinque', 'Sei', 'Sette', 'Fante', 'Cavallo', 'Re'];
const CPU_NAMES = ['Anna', 'Bepi', 'Carla', 'Dario', 'Elena', 'Franco', 'Gina', 'Hugo', 'Ivo', 'Lia', 'Mara', 'Nico'];
const LEVELS = ['facile', 'medio', 'difficile'];
const LEVEL_HINT = {
  facile: 'Chiama a occhio e ogni tanto sbaglia.',
  medio: 'Gioca come un giocatore attento.',
  difficile: 'Simula centinaia di mani e usa quello che ha imparato da voi.',
};
const COLORS = ['#F5A524', '#22D3EE', '#F472B6', '#FB923C', '#60A5FA', '#C084FC', '#2DD4BF', '#FDE047', '#E879F9', '#D6A26C', '#94A3B8', '#A3E635', '#FFD6A5'];
const LOCAL_ME = 'me';

const $app = document.getElementById('app');
const $sheet = document.getElementById('sheet');
const $toast = document.getElementById('toast');

// ---------------------------------------------------------------- utilità

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const cardName = (c) => `${RANKS[c % 10]} di ${SUITS[Math.floor(c / 10)]}`;
const cardSrc = (c) => `carte/${SUITS[Math.floor(c / 10)]}-${(c % 10) + 1}.webp`;
const img = (c, cls = '') => (c < 0
  ? `<img class="card cback ${cls}" src="icons/back.webp" alt="Carta coperta" draggable="false">`
  : `<img class="card ${cls}" src="${cardSrc(c)}" alt="${cardName(c)}" draggable="false">`);
const strength = (c, j) => (c === JOLLY ? (j === 'low' ? 0 : j === 'high' ? 41 : -1) : c + 1);
const carte = (n) => `${n} ${n === 1 ? 'carta' : 'carte'}`;
const fmtNum = (x) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(1).replace('.', ',');
const cap = (w) => w[0].toUpperCase() + w.slice(1);

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

let toastT;
function toast(msg) {
  $toast.textContent = msg;
  $toast.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => ($toast.hidden = true), 2800);
}

// ---------------------------------------------------------------- stato generale

let settings = Object.assign({ name: '', cpus: 4, level: 'medio', speed: 'normale' }, store.get('bisca-sp:settings') || {});
const saveSettings = () => store.set('bisca-sp:settings', settings);
const ui = { screen: 'home', sel: null, showLast: false, timer: null, sheet: null, sheetData: null, confirmQuit: false, lastTurn: null, saved: null, reveal: false, popErr: '', popStarted: false };
let ONLINE = null; // c'è il server (versione su Cloudflare)?
let G = null; // partita single player
let R = null; // stanza multiplayer
let profiles = { group: AI.GENERIC, byName: {} };

const remote = () => ui.screen === 'room';
const S = () => (remote() ? R?.s : G?.s);
const ME = () => (remote() ? R?.me : LOCAL_ME);
const player = (id) => S()?.players.find((p) => p.id === id);
const nameOf = (id) => (id === ME() ? 'Tu' : player(id)?.name || S()?.spectators.find((p) => p.id === id)?.name || '?');
const meOut = () => { const p = player(ME()); return !p || p.eliminated; };

function tableOrder() {
  const s = S();
  const first = s.firstDealer || G?.firstDealer || s.history[0]?.dealerId || s.round?.dealerId;
  const o = s.order.length ? s.order : s.players.map((p) => p.id);
  const i = Math.max(0, o.indexOf(first));
  return o.slice(i).concat(o.slice(0, i));
}
const colorOf = (id) => (S() ? COLORS[Math.max(0, tableOrder().indexOf(id)) % COLORS.length] : COLORS[0]);
const dot = (id) => `<span class="pdot" style="--pc:${colorOf(id)}"></span>`;
const who = (id) => `${dot(id)}${esc(nameOf(id))}`;

// ---------------------------------------------------------------- archivio (apprendimento)

// Versione online: le partite vanno al server. Pagina su Claude: archivio della pagina.
const archive = {
  mode: undefined, // undefined = in caricamento, null = nessun archivio
  db: null,
  async init() {
    if (ONLINE) this.mode = 'server';
    else {
      try {
        for (let i = 0; i < 30 && !window.claude?.use; i++) await new Promise((r) => setTimeout(r, 100));
        this.db = window.claude?.use ? await window.claude.use('db') : null;
      } catch { this.db = null; }
      this.mode = this.db ? 'db' : null;
    }
    await this.loadProfiles();
  },
  async loadProfiles() {
    try {
      if (this.mode === 'server') profiles = await (await fetch('api/profiles', { cache: 'no-store' })).json();
      else if (this.mode === 'db') {
        const snap = await this.db.collection('partite').limit(1000).get();
        profiles = AI.learnProfiles(snap.docs.map((d) => d.data()));
      }
    } catch { /* resta il buon senso */ }
    if (ui.screen === 'sp') render();
  },
  async save(id, record) {
    if (this.mode === 'server') {
      const res = await fetch('api/records', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, record }) });
      if (!res.ok) throw new Error('salvataggio');
    } else if (this.mode === 'db') await this.db.collection('partite').doc(id).set(record);
    else throw Object.assign(new Error('off'), { off: true });
  },
};

// ================================================================ SINGLE PLAYER

const saveLocal = () => {
  if (!G || G.tut) return;
  if (G.s.phase === 'finished' && !G.statEnd) { G.statEnd = true; track({ type: 'sp_end', name: settings.name, players: G.s.players.length, rounds: G.s.roundNo, game: G.id }); }
  store.set('bisca-sp:game', G);
};

// ---- statistiche d'uso (solo nella versione online): un codice a caso per telefono, nessun dato personale
const DEVICE = store.get('bisca:device') || (() => { const d = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('bisca:device', d); return d; })();
const STANDALONE = (() => { try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch { return false; } })();
function track(ev) {
  if (!ONLINE) return;
  try { fetch('api/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...ev, device: DEVICE }), keepalive: true }).catch(() => {}); } catch {}
}
const gameModels = () => ({ [LOCAL_ME]: AI.profileFor(profiles, { device: DEVICE, name: player(LOCAL_ME)?.name || settings.name }) });

async function saveRecord() {
  if (!G || G.tut || (!G.rec.calls.length && !G.rec.plays.length)) return;
  if (!archive.mode) { ui.saved = 'off'; render(); return; }
  ui.saved = 'saving';
  const s = G.s;
  try {
    await archive.save(G.id, {
      v: 1, at: G.at, updated: Date.now(), level: G.level,
      player: player(LOCAL_ME)?.name || settings.name,
      device: DEVICE,
      players: s.players.length, rounds: s.roundNo, finished: s.phase === 'finished',
      humanWon: s.phase === 'finished' && (s.winners || []).includes(LOCAL_ME),
      calls: G.rec.calls, plays: G.rec.plays,
      table: s.players.map((p) => ({ id: p.id, name: p.name })), log: G.log || [],
    });
    ui.saved = 'ok';
    archive.loadProfiles();
  } catch (e) {
    ui.saved = e?.off ? 'off' : 'fail';
    if (e?.code === 'quota_exceeded') toast("L'archivio è pieno: le nuove partite non vengono salvate.");
  }
  if (G && ui.screen === 'game' && (G.s.phase === 'roundEnd' || G.s.phase === 'finished')) render();
}

function logRound(r) {
  G.log ||= [];
  if (G.log.some((x) => x.n === r.n)) return;
  G.log.push({
    n: r.n, cards: r.cards, dealer: r.dealerId, seats: r.seats,
    hands: Object.fromEntries(r.seats.map((id) => [id, (r.playedBy[id] || []).slice()])),
    calls: { ...r.calls },
    tricks: (r.tricks || []).map((t) => ({ plays: t.plays, winner: t.winner })),
    lives: Object.fromEntries(r.seats.map((id) => [id, r.results[id].after])),
  });
}

function recordCall(n) {
  if (G.tut) return;
  const r = G.s.round;
  const e = { cards: r.cards, n: r.seats.length, call: n, dealer: r.dealerId === LOCAL_ME, pos: r.seats.indexOf(LOCAL_ME) };
  if (r.cards === 1) { e.visible = r.seats.filter((id) => id !== LOCAL_ME).map((id) => r.hands[id][0]); e.pool = 40 - e.visible.length; }
  else e.hand = r.hands[LOCAL_ME].slice();
  G.rec.calls.push(e);
}

function recordPlay(card, jolly) {
  if (G.tut) return;
  const r = G.s.round;
  if (r.cards === 1) return;
  const h = r.hands[LOCAL_ME];
  const low = Math.min(...h.map((c) => (c === JOLLY ? 0 : c + 1)));
  G.rec.plays.push({ trick: r.trickNo, options: h.length, lowest: strength(card, jolly || 'low') === low, need: (r.calls[LOCAL_ME] ?? 0) - r.won[LOCAL_ME], card, jolly: jolly || null });
}

function newLocalGame() {
  const nick = (document.getElementById('nick')?.value || settings.name || '').trim();
  if (!nick) { toast('Scegli un nickname'); document.getElementById('nick')?.focus(); return; }
  settings.name = nick.slice(0, 22);
  saveSettings();
  const s = E.createGame({ code: 'SP', hostId: LOCAL_ME, hostName: settings.name });
  const names = CPU_NAMES.filter((n) => n.toLowerCase() !== settings.name.toLowerCase()).sort(() => Math.random() - 0.5).slice(0, settings.cpus);
  const cfg = {};
  names.forEach((n, i) => {
    const id = 'cpu' + i;
    E.addPlayer(s, { id, name: n, cpu: { level: settings.level } });
    cfg[id] = { level: settings.level, persona: AI.makePersona(Math.random) };
  });
  E.startGame(s);
  G = { s, cfg, level: settings.level, at: Date.now(), id: 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), rec: { calls: [], plays: [] }, firstDealer: s.round.dealerId };
  Object.assign(ui, { screen: 'game', sel: null, showLast: false, confirmQuit: false, lastTurn: null, saved: null });
  track({ type: 'sp_start', name: settings.name, players: s.players.length, game: G.id });
  saveLocal();
  requestWake();
  step();
}

function step() {
  clearTimeout(ui.timer);
  if (!G || ui.screen !== 'game') return;
  const s = G.s;
  render();
  if (ui.showLast) return;
  if (isL0() && tutCheck()) return; // il maestro sta parlando
  if (s.phase !== 'calling' && s.phase !== 'playing') return;
  const r = s.round;
  const actor = r.pendingJolly || r.turnId;
  if (actor === LOCAL_ME) return;
  if (G.tut && G.tut.kind !== 'maestro') { ui.timer = setTimeout(() => cpuAct(actor), FAST_TEST ? 120 : 1400); return; }
  // ogni azione della CPU: 4 secondi (3 a difficile); la scelta dell'asso fa parte della stessa giocata
  const base = r.pendingJolly ? 700 : cpuDelay();
  ui.timer = setTimeout(() => cpuAct(actor), base * speedFactor());
}

// Ritmo della CPU in single player: dipende dalla difficoltà. Se sei fuori dal gioco va al doppio.
const FAST_TEST = (() => { try { return new URLSearchParams(location.search).has('provaveloce'); } catch { return false; } })(); // solo per i collaudi automatici
const cpuDelay = () => (FAST_TEST ? 120 : G?.level === 'difficile' ? 3000 : 4000);
function speedFactor() { return meOut() ? 0.4 : 1; }

function cpuAct(pid) {
  const s = G.s;
  const r = s.round;
  if (G.tut?.kind === 'sc') {
    const sc = G.tut.sc, pc = { level: 'medio', persona: AI.makePersona(() => 0.5), rng: Math.random };
    return perform(() => {
      if (s.phase === 'calling') {
        let c = sc.calls[pid];
        if (c == null || (pid === r.dealerId && c === E.forbiddenCall(s))) c = AI.decideCall(s, pid, pc);
        E.makeCall(s, pid, c);
      } else if (r.pendingJolly === pid) E.chooseJolly(s, pid, AI.decideJolly(s, pid));
      else { const d = AI.decidePlay(s, pid, pc); E.playCard(s, pid, d.card, d.jolly); }
    });
  }
  if (isL0()) {
    const m = T.cpuMove(s, pid);
    return perform(() => (m.call != null ? E.makeCall(s, pid, m.call) : E.playCard(s, pid, m.card, m.card === JOLLY ? 'low' : undefined)));
  }
  const cfg = { ...G.cfg[pid], models: gameModels(), rng: Math.random };
  perform(() => {
    if (s.phase === 'calling') E.makeCall(s, pid, AI.decideCall(s, pid, cfg));
    else if (r.pendingJolly === pid) E.chooseJolly(s, pid, AI.decideJolly(s, pid));
    else { const d = AI.decidePlay(s, pid, cfg); E.playCard(s, pid, d.card, d.jolly); }
  });
}

function perform(fn) {
  const s = G.s;
  const before = { t: s.round.trickNo, phase: s.phase, actor: s.round.pendingJolly || s.round.turnId };
  try {
    fn();
    // turno da 1 carta: finite le chiamate si scoprono tutte
    if (s.phase === 'playing' && s.round.cards === 1) E.revealOneCard(s, (pid) => (player(pid)?.cpu ? AI.decideJolly(s, pid) : undefined));
  } catch (e) { toast(e.message || 'Mossa non valida'); render(); return; }
  const r = s.round;
  ui.sel = null;
  ui.acted = { pid: before.actor, at: Date.now() };
  const oneCard = r.cards === 1 && before.phase === 'calling';
  const trickDone = (before.phase === 'playing' || oneCard) && (s.phase !== 'playing' || r.trickNo !== before.t) && s.phase !== 'calling';
  if ((s.phase === 'roundEnd' || s.phase === 'finished') && r.results) logRound(r);
  saveLocal();
  if (s.phase === 'roundEnd' || s.phase === 'finished') saveRecord();
  if (trickDone && r.lastTrick) {
    ui.showLast = true;
    render();
    ui.timer = setTimeout(() => { ui.showLast = false; step(); }, r.cards === 1 ? 5800 : 2000 * speedFactor());
    return;
  }
  step();
}

function localNextRound() {
  ui.showLast = false;
  try { E.nextRound(G.s); } catch (e) { toast(e.message); return; }
  ui.lastTurn = null;
  saveLocal();
  if (G.s.phase === 'finished') saveRecord();
  step();
}

function fastForward() {
  clearTimeout(ui.timer);
  ui.showLast = false;
  const s = G.s;
  let guard = 0;
  while (s.phase !== 'finished' && guard++ < 20000) {
    const r = s.round;
    if (s.phase === 'roundEnd') { if (r.results) logRound(r); E.nextRound(s); continue; }
    const pid = r.pendingJolly || r.turnId;
    const cfg = { ...G.cfg[pid], models: gameModels(), rng: Math.random };
    if (s.phase === 'calling') E.makeCall(s, pid, AI.decideCall(s, pid, cfg));
    else if (r.pendingJolly) E.chooseJolly(s, pid, AI.decideJolly(s, pid));
    else { const d = AI.decidePlay(s, pid, cfg); E.playCard(s, pid, d.card, d.jolly); }
  }
  saveLocal();
  saveRecord();
  step();
}

let wake = null;
async function requestWake() {
  try { if ('wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => (wake = null)); } } catch {}
}

// ================================================================ MULTIPLAYER

const rooms = {
  all() { return store.get('bisca:rooms') || {}; },
  get(code) { return this.all()[code]; },
  put(code, v) { const a = this.all(); a[code] = { ...v, at: Date.now() }; store.set('bisca:rooms', a); },
  del(code) { const a = this.all(); delete a[code]; store.set('bisca:rooms', a); },
};

async function api(path, body) {
  const res = await fetch('api/' + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Errore di rete'), { data });
  return data;
}

function setUrl(code) {
  try {
    const u = new URL(location.href);
    if (code) u.searchParams.set('p', code); else u.searchParams.delete('p');
    history.replaceState(null, '', u);
  } catch {}
}
const inviteLink = (code) => `${location.origin}${location.pathname}?p=${code}`;

async function shareInvite(code) {
  const url = inviteLink(code);
  try { if (navigator.share) { await navigator.share({ title: 'Bisca', text: `Entra nella mia stanza di Bisca: codice ${code}`, url }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(url); toast('Link copiato'); } catch { toast(`Codice: ${code}`); }
}

function openRoom(code) {
  const id = rooms.get(code);
  if (!id) return openSheet('join', { code });
  closeSheet();
  leaveRoomView();
  R = { code, token: id.token, me: id.playerId, s: null, chat: [], lastRead: store.get('bisca:read:' + code) || 0, online: new Set(), offline: {}, ws: null, retry: 0, offset: 0, proxyDelay: 15000, hostTakeoverAfter: 60000 };
  Object.assign(ui, { screen: 'room', sel: null, showLast: false, lastTurn: null, reveal: false });
  setUrl(code);
  render();
  connect();
}

function leaveRoomView() {
  closeChat();
  if (R?.ws) { R.ws.onclose = null; R.ws.onmessage = null; try { R.ws.close(); } catch {} }
  if (R) { clearTimeout(R.reconnect); clearInterval(R.ping); }
  R = null;
  setConnBanner(false);
}

function connect() {
  if (!R) return;
  clearTimeout(R.reconnect);
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const base = location.pathname.replace(/[^/]*$/, '');
  const sock = new WebSocket(`${proto}://${location.host}${base}api/games/${R.code}/ws?token=${encodeURIComponent(R.token)}`);
  R.ws = sock;
  sock.onopen = () => {
    if (!R) return;
    R.retry = 0;
    setConnBanner(false);
    clearInterval(R.ping);
    R.ping = setInterval(() => { if (sock.readyState === 1) sock.send('{"t":"ping"}'); }, 25000);
  };
  sock.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.t === 'state') onRemoteState(m);
    else if (m.t === 'chatAll') { R.chat = m.msgs || []; drawChat(); }
    else if (m.t === 'chat') onChat(m.msg);
    else if (m.t === 'error') toast(m.msg);
    else if (m.t === 'kicked') { const c = R.code; rooms.del(c); leaveRoomView(); toast('Sei uscito dalla stanza'); goMp(); }
  };
  sock.onclose = async () => {
    if (!R || R.ws !== sock) return;
    clearInterval(R.ping);
    try {
      const res = await fetch(`api/games/${R.code}/ws?token=${encodeURIComponent(R.token)}`);
      if (res.status === 404 || res.status === 403) {
        rooms.del(R.code); leaveRoomView();
        toast(res.status === 404 ? 'Questa stanza è stata chiusa' : 'Non fai più parte di questa stanza');
        return goMp();
      }
    } catch {}
    setConnBanner(true);
    const delay = Math.min(1000 * 2 ** R.retry, 8000);
    R.retry++;
    R.reconnect = setTimeout(connect, delay);
  };
}

function setConnBanner(on) {
  let el = document.querySelector('.conn');
  if (on && !el) { el = document.createElement('div'); el.className = 'conn'; el.textContent = 'Riconnessione…'; document.body.appendChild(el); }
  if (!on && el) el.remove();
}

function onRemoteState(m) {
  if (!R) return;
  const prev = R.s;
  R.s = m.s; R.me = m.me; R.online = new Set(m.online); R.offline = m.offline || {};
  R.offset = m.now - Date.now(); R.proxyDelay = m.proxyDelay; R.hostTakeoverAfter = m.hostTakeoverAfter;
  R.deadline = m.deadline; R.deadlineFor = m.deadlineFor;
  syncAvatar();
  checkMyPick();
  if (!R.viewAsked) {
    R.viewAsked = true;
    if (!settings.viewAlways && !rooms.get(R.code)?.view && !ui.sheet) setTimeout(() => { if (R && !ui.sheet) openSheet('viewpick'); }, 300);
  }
  const s = m.s, r = s.round, pr = prev?.round;
  // la mano appena finita resta visibile un attimo
  const oneCardDone = r?.cards === 1 && prev?.phase !== 'roundEnd' && (s.phase === 'roundEnd' || s.phase === 'finished');
  if (pr && r && pr.n === r.n && (prev.phase === 'playing' || oneCardDone) && (s.phase !== 'playing' || r.trickNo !== pr.trickNo) && s.phase !== 'calling' && r.lastTrick) {
    ui.showLast = true;
    clearTimeout(ui.timer);
    ui.timer = setTimeout(() => { ui.showLast = false; render(); }, r.cards === 1 ? 5800 : 1500);
  }
  if (pr && r && pr.n === r.n) {
    const actor = pr.pendingJolly || pr.turnId;
    if (actor && actor !== R.me && (r.pendingJolly || r.turnId) !== actor) ui.acted = { pid: actor, at: Date.now() };
  }
  if (!prev || prev.round?.n !== r?.n || prev.round?.turnId !== r?.turnId) ui.sel = null;
  ui.lockUntil = 0;
  if (s.phase !== 'lobby' && s.phase !== 'finished') requestWake();
  render();
  if (ui.sheet) drawSheet();
}

function send(msg) {
  if (!R?.ws || R.ws.readyState !== 1) { toast('Non sei collegato, riprovo…'); return; }
  R.ws.send(JSON.stringify(msg));
}

// Si entra nella stanza con nome e avatar già scelti.
const hasAvatar = () => !!settings.avatarPhoto || !!(settings.avatarPick && avById(settings.avatarPick));
const needAvatar = () => !hasAvatar() && (AVATARS.length > 0 || ONLINE === false);
const myPick = () => (settings.avatarPhoto ? null : settings.avatarPick);

// Un telefono sta in una stanza sola: entrando in una nuova esce dalle altre.
function leaveOtherRooms(keep) {
  for (const [c, v] of Object.entries(rooms.all())) {
    if (c === keep) continue;
    try { fetch(`api/games/${c}/leave`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: v.token }), keepalive: true }).catch(() => {}); } catch {}
    rooms.del(c);
  }
}

async function createRoom() {
  const name = (document.getElementById('pname')?.value || '').trim();
  if (!name) { ui.popErr = 'Scegli un nome'; return drawSheet(); }
  settings.name = name.slice(0, 22); saveSettings();
  if (needAvatar()) { ui.popErr = 'Scegli il tuo avatar: tocca il cerchio'; return drawSheet(); }
  try {
    const r = await api('games', { name: settings.name, device: DEVICE, pick: myPick() });
    rooms.put(r.code, { playerId: r.playerId, token: r.token, as: 'player' });
    leaveOtherRooms(r.code);
    openRoom(r.code);
  } catch (e) { ui.popErr = e.message; drawSheet(); }
}

async function joinRoom(as = 'player') {
  const name = (document.getElementById('pname')?.value || '').trim();
  const code = (document.getElementById('pcode')?.value || '').trim().toUpperCase();
  if (!name) { ui.popErr = 'Scegli un nome'; return drawSheet(); }
  if (!code) { ui.popErr = 'Inserisci il codice della stanza'; return drawSheet(); }
  settings.name = name.slice(0, 22); saveSettings();
  if (rooms.get(code)) return openRoom(code);
  if (as === 'player' && needAvatar()) { ui.popErr = 'Scegli il tuo avatar: tocca il cerchio'; ui.sheetData = { code, name }; return drawSheet(); }
  try {
    const r = await api(`games/${code}/join`, { name: settings.name, as, device: DEVICE, pick: myPick() });
    rooms.put(r.code, { playerId: r.playerId, token: r.token, as });
    leaveOtherRooms(r.code);
    openRoom(r.code);
  } catch (e) {
    ui.popErr = e.message;
    ui.popStarted = !!e.data?.started;
    ui.sheetData = { code, name };
    drawSheet();
  }
}

function leaveRoom() {
  if (!R) return goHome();
  const s = R.s;
  if (s && (s.phase === 'lobby' || s.phase === 'finished')) send({ t: 'leave' });
  rooms.del(R.code);
  leaveRoomView();
  setUrl(null);
  goHome();
}


// ================================================================ AVATAR

const ROBOT = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16.5h5"/></svg>';
// Personaggi disponibili: nella versione online arrivano dal server (gestiti dal pannello admin),
// nella pagina su Claude da avatar/index.json.
let AVATARS = [];
const avById = (id) => AVATARS.find((a) => a.id === id);
function avImg(id, kind = 'circle') {
  const a = avById(id);
  if (ONLINE) return `api/avatars/img/${encodeURIComponent(id)}/${kind}?v=${a?.v || 0}`;
  return `avatar/${kind === 'full' ? 'full/' : ''}${id}.webp`;
}
async function loadAvatars() {
  try {
    const res = await fetch(ONLINE ? 'api/avatars' : 'avatar/index.json', { cache: 'no-store' });
    const a = res.ok ? await res.json() : [];
    AVATARS = Array.isArray(a) ? a.filter((x) => !x.hidden) : [];
  } catch { AVATARS = []; }
  // un personaggio tolto dal pannello admin non si può più usare: va scelto un altro
  if (settings.avatarPick && !avById(settings.avatarPick)) { settings.avatarPick = null; saveSettings(); }
  ui.avLoaded = true;
  ui.scene = null;
  render();
  if (ui.sheet) drawSheet();
  checkMyPick();
}

// Se il mio personaggio è stato tolto dal pannello admin, ne scelgo un altro.
function checkMyPick() {
  if (!R?.s || !ui.avLoaded || !AVATARS.length || R.avPrompted) return;
  const me = R.s.players.find((p) => p.id === R.me) || R.s.spectators.find((p) => p.id === R.me);
  const pick = me?.avatar?.pick;
  if (!pick || avById(pick)) return;
  R.avPrompted = true;
  toast('Il tuo avatar non è più disponibile: scegline un altro');
  if (!ui.sheet) openSheet('avatar');
}

function avatarSrc(p) {
  if (!p || p.cpu) return null;
  if (remote() && p.avatar?.photo) return `api/games/${R.code}/avatar?pid=${encodeURIComponent(p.id)}&v=${p.avatar.photo}`;
  if (p.avatar?.pick) return avById(p.avatar.pick) ? avImg(p.avatar.pick) : null;
  if (!remote() && p.id === LOCAL_ME) {
    if (settings.avatarPhoto) return settings.avatarPhoto;
    if (settings.avatarPick && avById(settings.avatarPick)) return avImg(settings.avatarPick);
  }
  return null;
}

function avatarHTML(p, cls = '') {
  if (!p) return '';
  if (p.cpu) return `<span class="av cpu ${cls}" style="--pc:${colorOf(p.id)}" title="CPU ${esc(p.cpu.level || '')}">${ROBOT}</span>`;
  const src = avatarSrc(p);
  if (src) return `<img class="av ${cls}" src="${esc(src)}" alt="" loading="lazy">`;
  return `<span class="av ini ${cls}" style="--pc:${colorOf(p.id)}">${esc((p.name || '?').trim().slice(0, 1).toUpperCase())}</span>`;
}

// Foto dal telefono: ritaglio quadrato al centro, 160×160, JPEG leggero.
async function photoToDataUrl(file) {
  const url = URL.createObjectURL(file);
  try {
    const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const side = Math.min(im.naturalWidth, im.naturalHeight);
    const c = document.createElement('canvas');
    c.width = c.height = 160;
    c.getContext('2d').drawImage(im, (im.naturalWidth - side) / 2, (im.naturalHeight - side) / 2, side, side, 0, 0, 160, 160);
    return c.toDataURL('image/jpeg', 0.8);
  } finally { URL.revokeObjectURL(url); }
}

async function setAvatar(body) {
  // body: {data} foto, {pick} personaggino, {clear}
  if (body.data) { settings.avatarPhoto = body.data; settings.avatarPick = null; }
  else if (body.pick) { settings.avatarPick = body.pick; settings.avatarPhoto = null; }
  else if (body.clear) { settings.avatarPhoto = null; settings.avatarPick = null; }
  saveSettings();
  if (remote() && R) {
    try {
      const res = await fetch(`api/games/${R.code}/avatar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: R.token, ...body }) });
      if (!res.ok) toast((await res.json().catch(() => ({}))).error || 'Avatar non salvato');
    } catch { toast('Avatar non salvato: controlla la connessione'); }
  }
  render();
}

// Entrando in una stanza porta con sé l'avatar scelto su questo telefono.
function syncAvatar() {
  if (!R || R.avatarSynced) return;
  const me = R.s.players.find((p) => p.id === R.me) || R.s.spectators.find((p) => p.id === R.me);
  if (!me) return;
  R.avatarSynced = true;
  if (me.avatar) return;
  if (settings.avatarPhoto) setAvatar({ data: settings.avatarPhoto });
  else if (settings.avatarPick) setAvatar({ pick: settings.avatarPick });
}

function myAvatarPlayer() {
  return remote() ? (player(R.me) || R.s?.spectators.find((p) => p.id === R.me)) : { id: LOCAL_ME, name: settings.name || 'Tu' };
}

// Chi altro nella stanza ha già quel personaggio.
function avatarTakenBy(id) {
  return null; // lo stesso personaggio lo possono avere in tanti
  if (!remote() || !R?.s) return ui.preTaken?.find((p) => p.pick === id) || null; // stanza in cui sto per entrare
  return [...R.s.players, ...R.s.spectators].find((p) => p.id !== R.me && p.avatar?.pick === id) || null;
}

function avatarSheetHTML() {
  const meP = myAvatarPlayer();
  const cur = remote() ? meP?.avatar?.pick : settings.avatarPick;
  return `<h2>Il tuo avatar</h2>
    <div class="avnow">${avatarHTML(meP, 'lg')}<span class="muted">Lo vedono tutti al tavolo e in chat.</span></div>
    <label class="btn" for="avfile">Scatta o scegli una foto</label>
    <input id="avfile" type="file" accept="image/*" hidden>
    <div class="label">Personaggi</div>
    ${AVATARS.length
      ? `<div class="avlist">${AVATARS.map((a) => {
        const by = avatarTakenBy(a.id);
        return `<button class="avrow ${cur === a.id ? 'on' : ''}" data-act="av-pick" data-id="${esc(a.id)}" ${by ? 'disabled' : ''}><img src="${avImg(a.id)}" alt="" loading="lazy"><span><b>${esc(a.name || a.id)}</b>${by ? `<small>scelto da ${esc(by.name)}</small>` : ''}</span></button>`;
      }).join('')}</div>`
      : '<p class="hint">I personaggi arrivano presto: intanto puoi usare una foto.</p>'}
    ${ui.avReturn ? '' : '<button class="btn ghost" data-act="av-clear">Togli l\'avatar</button>'}`;
}

// Secondo passo: con quale nome giochi.
function avatarNameHTML(err) {
  const d = ui.sheetData || {};
  const a = d.pick && AVATARS.find((x) => x.id === d.pick);
  const curName = (remote() ? myAvatarPlayer()?.name : settings.name) || '';
  const pic = a ? `<img class="avfull" src="${avImg(a.id, 'full')}" alt="">` : `<img class="av lg" src="${esc(d.data)}" alt="">`;
  return `<h2>Con che nome giochi?</h2>
    <div class="avchosen">${pic}${a ? `<b>${esc(a.name)}</b>` : ''}</div>
    ${a ? `<button class="btn" data-act="av-name" data-v="default">Usa il nome ${esc(a.name)}</button><div class="label">Oppure un nome tuo</div>` : '<label class="label" for="pname">Il tuo nome</label>'}
    <input id="pname" class="field" maxlength="22" autocomplete="nickname" value="${esc(curName)}" placeholder="Es. Thomas">
    ${err}<button class="btn ${a ? 'ghost' : ''}" data-act="av-name" data-v="custom">Usa questo nome</button>`;
}

// Applica avatar e nome insieme.
function applyAvatarName(name) {
  name = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 22);
  if (!name) { ui.popErr = 'Scegli un nome'; return drawSheet(); }
  if (remote() && R?.s) {
    const meP = myAvatarPlayer();
    const clash = [...R.s.players, ...R.s.spectators].find((p) => p.id !== R.me && p.name.toLowerCase() === name.toLowerCase());
    if (clash) { ui.popErr = `${name} è già usato nella stanza: scegline un altro`; return drawSheet(); }
    if (meP && meP.name !== name) {
      if (R.s.phase !== 'lobby') { ui.popErr = 'Il nome si cambia solo in sala d\'attesa'; return drawSheet(); }
      send({ t: 'rename', name });
    }
  }
  if (!remote() && ui.preNames?.some((n) => n.toLowerCase() === name.toLowerCase())) { ui.popErr = `${name} è già usato nella stanza: scegline un altro`; return drawSheet(); }
  settings.name = name; saveSettings();
  const d = ui.sheetData || {};
  const back = ui.avReturn;
  ui.avReturn = null;
  closeSheet();
  setAvatar(d.pick ? { pick: d.pick } : { data: d.data });
  if (back) openSheet(back.kind, { ...back.data, name });
}

// Dalla finestra "Crea" o "Accedi" si apre la scelta dell'avatar e poi si torna lì.
async function avatarFromEntry() {
  const kind = ui.sheet;
  const name = document.getElementById('pname')?.value ?? settings.name;
  const code = (document.getElementById('pcode')?.value || ui.sheetData?.code || '').trim().toUpperCase();
  if (name) { settings.name = name.trim().slice(0, 22); saveSettings(); }
  ui.avReturn = { kind, data: { ...(ui.sheetData || {}), code, name } };
  ui.preTaken = null; ui.preNames = null;
  openSheet('avatar');
  if (kind === 'join' && code) {
    try { const info = await api(`games/${code}/info`); ui.preTaken = info.picks || []; ui.preNames = info.names || []; if (ui.sheet === 'avatar') drawSheet(); } catch {}
  }
}

// ================================================================ CHAT (solo multiplayer)

let chatDom = null;
function ensureChatDom() {
  if (chatDom) return chatDom;
  const btn = document.createElement('button');
  btn.className = 'chatbtn'; btn.hidden = true; btn.dataset.act = 'chat-open'; btn.setAttribute('aria-label', 'Apri la chat');
  btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg><span class="badge" hidden></span>';
  const panel = document.createElement('div');
  panel.className = 'chatpanel'; panel.hidden = true; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Chat della stanza');
  panel.innerHTML = `<div class="chathead"><b>Chat</b><span class="muted" id="chatRoom"></span><button class="iconbtn" data-act="chat-close" aria-label="Chiudi la chat"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    <div class="chatlist" id="chatList"></div>
    <div class="suggest" id="chatSuggest" hidden></div>
    <form class="chatform" id="chatForm"><label class="sr" for="chatInput">Messaggio</label><input id="chatInput" class="field" maxlength="300" autocomplete="off" placeholder="Scrivi… usa @ per taggare"><button class="btn small" type="submit">Invia</button></form>`;
  document.body.append(btn, panel);
  chatDom = { btn, panel, list: panel.querySelector('#chatList'), input: panel.querySelector('#chatInput'), suggest: panel.querySelector('#chatSuggest'), room: panel.querySelector('#chatRoom') };
  panel.querySelector('#chatForm').addEventListener('submit', (e) => { e.preventDefault(); sendChat(); });
  chatDom.input.addEventListener('input', suggestMentions);
  return chatDom;
}

const chatPeople = () => (R?.s ? [...R.s.players.filter((p) => !p.cpu), ...R.s.spectators] : []);
const unreadMsgs = () => (R ? R.chat.filter((m) => m.at > R.lastRead && m.pid !== R.me) : []);

function updateChatBtn() {
  const d = ensureChatDom();
  const show = ui.screen === 'room' && !!R?.s;
  d.btn.hidden = !show || ui.chatOpen;
  document.body.classList.toggle('withchat', show);
  if (!show) { d.panel.hidden = true; return; }
  const un = unreadMsgs();
  const tagged = un.some((m) => m.mentions?.includes(R.me));
  const badge = d.btn.querySelector('.badge');
  badge.hidden = !un.length;
  badge.textContent = tagged ? '@' : un.length > 9 ? '9+' : String(un.length);
  badge.classList.toggle('tag', tagged);
}

function mentionHTML(text) {
  let out = esc(text);
  const names = chatPeople().map((p) => p.name).sort((a, b) => b.length - a.length);
  for (const n of names) {
    const re = new RegExp('@' + esc(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}_])', 'giu');
    out = out.replace(re, (m) => `<span class="mention">${m}</span>`);
  }
  return out;
}

function drawChat() {
  if (!R) return;
  const d = ensureChatDom();
  d.room.textContent = `stanza ${R.code}`;
  if (ui.chatOpen) {
    const atBottom = d.list.scrollHeight - d.list.scrollTop - d.list.clientHeight < 40;
    d.list.innerHTML = R.chat.length ? R.chat.map((m) => {
      const mine = m.pid === R.me;
      const p = player(m.pid) || R.s?.spectators.find((x) => x.id === m.pid) || { id: m.pid, name: m.name };
      const tagged = m.mentions?.includes(R.me);
      const time = new Date(m.at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
      return `<div class="msg ${mine ? 'mine' : ''} ${tagged ? 'tagged' : ''}">${mine ? '' : avatarHTML(p, 'sm')}<div class="bub"><div class="mh"><b style="color:${colorOf(m.pid)}">${esc(mine ? 'Tu' : m.name)}</b><span>${time}</span></div><div class="mt">${mentionHTML(m.text)}</div></div></div>`;
    }).join('') : '<p class="hint">Nessun messaggio. Scrivi qualcosa al tavolo!</p>';
    if (atBottom || !d.list.dataset.init) { d.list.scrollTop = d.list.scrollHeight; d.list.dataset.init = '1'; }
    markRead();
  }
  updateChatBtn();
}

function markRead() {
  if (!R || !R.chat.length) return;
  R.lastRead = Math.max(R.lastRead, R.chat[R.chat.length - 1].at);
  store.set('bisca:read:' + R.code, R.lastRead);
}

function onChat(m) {
  if (!R) return;
  R.chat.push(m);
  if (R.chat.length > 200) R.chat = R.chat.slice(-200);
  if (m.mentions?.includes(R.me) && m.pid !== R.me) { try { navigator.vibrate?.([90, 50, 90]); } catch {} if (!ui.chatOpen) toast(`${m.name} ti ha taggato in chat`); }
  drawChat();
}

function openChat() { const d = ensureChatDom(); ui.chatOpen = true; d.panel.hidden = false; document.body.classList.add('chatopen'); d.list.dataset.init = ''; drawChat(); setTimeout(() => d.input.focus(), 50); }
function closeChat() { document.body.classList.remove('chatopen'); if (!chatDom) return; ui.chatOpen = false; chatDom.panel.hidden = true; chatDom.suggest.hidden = true; updateChatBtn(); }

function sendChat() {
  const d = ensureChatDom();
  const t = d.input.value.trim();
  if (!t) return;
  send({ t: 'chat', text: t });
  d.input.value = '';
  d.suggest.hidden = true;
}

// @ seguito da lettere: propone i nomi di chi è nella stanza
function suggestMentions() {
  const d = ensureChatDom();
  const v = d.input.value.slice(0, d.input.selectionStart ?? d.input.value.length);
  const m = v.match(/(^|\s)@([^\s@]*)$/);
  if (!m) { d.suggest.hidden = true; return; }
  const q = m[2].toLowerCase();
  const list = chatPeople().filter((p) => p.id !== R.me && p.name.toLowerCase().startsWith(q));
  if (!list.length) { d.suggest.hidden = true; return; }
  d.suggest.innerHTML = list.map((p) => `<button type="button" class="qi" data-act="mention" data-name="${esc(p.name)}">${avatarHTML(p, 'xs')}${esc(p.name)}</button>`).join('');
  d.suggest.hidden = false;
}

function pickMention(name) {
  const d = ensureChatDom();
  const pos = d.input.selectionStart ?? d.input.value.length;
  const before = d.input.value.slice(0, pos).replace(/@([^\s@]*)$/, `@${name} `);
  d.input.value = before + d.input.value.slice(pos);
  d.suggest.hidden = true;
  d.input.focus();
  d.input.setSelectionRange(before.length, before.length);
}

// ================================================================ AZIONI DI GIOCO (comuni)

const doCall = (n) => {
  if (!remote()) return (recordCall(n), perform(() => E.makeCall(G.s, LOCAL_ME, n)));
  if (locked()) return;
  ui.lockUntil = Date.now() + 4000;
  send({ t: 'call', n });
};
// In multiplayer, dopo una giocata la mano resta bloccata finché il server non risponde (niente doppi invii).
const locked = () => remote() && ui.lockUntil && Date.now() < ui.lockUntil;
const doPlay = (card, jolly) => {
  if (!remote()) return (recordPlay(card, jolly), perform(() => E.playCard(G.s, LOCAL_ME, card, jolly)));
  ui.lockUntil = Date.now() + 4000;
  send({ t: 'play', card, jolly });
  render();
};
const doJolly = (v) => (remote() ? send({ t: 'jolly', v }) : perform(() => E.chooseJolly(G.s, LOCAL_ME, v)));
const doNext = () => (remote() ? send({ t: 'ready' }) : localNextRound());

// ================================================================ SCHERMATE

function render() {
  $app.classList.remove('v-classic', 'v-table', 'in-tut');
  clearTimeout(ui.redraw); ui.redraw = null;
  renderScreen();
  updateChatBtn();
}

function renderScreen() {
  switch (ui.screen) {
    case 'home': return renderHome();
    case 'sp': return renderSpSetup();
    case 'mp': return renderMp();
    case 'learn': return renderLearn();
    case 'live': return renderLive();
    case 'game':
      if (!G) return renderHome();
      if (G.s.phase === 'finished' && !ui.showLast) return renderFinished();
      return renderGame();
    case 'room': {
      const s = R?.s;
      if (!s) { $app.innerHTML = `<div class="hero"><p class="eyebrow">Stanza ${esc(R?.code)}</p><h1>Bisca</h1><p class="muted">Collegamento…</p></div>`; return; }
      if (s.phase === 'lobby') return renderLobby();
      if (s.phase === 'finished' && !ui.showLast) return renderFinished();
      return renderGame();
    }
  }
}

const goHome = () => { closeSheet(); clearTimeout(ui.timer); leaveRoomView(); setUrl(null); ui.screen = 'home'; render(); };
const goMp = () => { closeSheet(); ui.screen = 'mp'; setUrl(null); render(); };
const goSp = () => { closeSheet(); clearTimeout(ui.timer); G = null; ui.screen = 'sp'; render(); };

function fanHTML() {
  return `<div class="fan" aria-hidden="true">${[30, 19, 38, 37].map((c) => `<img src="${cardSrc(c)}" alt="">`).join('')}</div>`;
}

const ICONS = {
  people: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3 19c.6-3.3 3-5 6-5s5.4 1.7 6 5"/><circle cx="17" cy="9" r="2.4"/><path d="M16 14.2c2.6.2 4.4 1.8 5 4.8"/></svg>',
  robot: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16.5h5"/></svg>',
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 18h2"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  key: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/></svg>',
  cap: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2.5 9 2.5 12 0v-5"/><path d="M22 9v6"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  share: '<svg class="inl" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4"/><path d="M6 11v8h12v-8"/></svg>',
  dots: '<svg class="inl" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>',
};

function renderHome() {
  const mpOff = ONLINE === false;
  $app.innerHTML = `
    <div class="homebg" aria-hidden="true"></div>
    ${sceneHTML()}
    <p class="tagline" data-act="tag-tap">Chiama, gioca, non perdere vite.</p>
    <div class="modes">
      <button class="mode" data-act="go-mp" ${mpOff ? 'aria-disabled="true"' : ''}>
        <span class="mi">${ICONS.people}</span>
        <span class="mt"><b>Gioca con i tuoi amici</b><span>${mpOff ? 'Disponibile nella versione online di Bisca' : 'Crea una stanza o entra con un codice'}</span></span>${ICONS.chev}
      </button>
      <button class="mode alt" data-act="go-sp">
        <span class="mi">${ICONS.robot}</span>
        <span class="mt"><b>Single player</b><span>Contro la CPU, da 2 a 12 avversari</span></span>${ICONS.chev}
      </button>
    </div>
    <div class="modes2">
      <button class="mini" data-act="go-live" ${mpOff ? 'aria-disabled="true"' : ''}><span class="mi">${EYE}</span><b>Spettatore</b><span>${mpOff ? 'Nella versione online' : 'Guarda le partite live'}</span></button>
      <button class="mini" data-act="go-learn"><span class="mi">${ICONS.cap}</span><b>Allenati e impara la Bisca</b><span>${learnDone().includes(0) ? 'Nuove lezioni in arrivo' : 'Inizia dalla prima mano'}</span></button>
    </div>
    ${STANDALONE ? '' : `<button class="installcard" data-act="install">
      <span class="mi">${ICONS.phone}</span>
      <span class="mt"><b>Come scaricare l'app</b><span>Aggiungila alla schermata Home: non occupa spazio</span></span>${ICONS.chev}
    </button>`}
    <div class="linkrow center2"><button class="link" data-act="rules">Regole del gioco</button>${ONLINE && hasAdminKey() ? '<a class="link adminlink" href="admin.html">Pannello admin</a>' : ''}</div>`;
}

// ================================================================ SCENA DELLA HOME
// Titolo fatto di carte, assi sparsi e una tavolata di personaggi presi a caso.
// Tocchi: personaggio → saltello e nuvoletta; quello nascosto → si rinasconde;
// asso di denari → gira e cambia tavolata. Ogni 12 secondi un personaggio cambia.

const SAY = ['Io chiamo 3', 'Questa la prendo io', 'Parcheggio!', 'Chi è il mazziere?', 'Asso di denari alto!', 'Sto a posto così', 'Ne devo prendere ancora due',
  'Zero, e non se ne parla più', 'Chi ha mischiato?', 'Mi resta una vita…', 'Tocca a me?', 'Vita bonus, grazie', 'Non guardarmi le carte!', 'Questa è mia', 'Chiamo 1 e basta'];
// le cinque carte dentro l'immagine del titolo: inizio e fine in larghezza, bordo alto (in %)
const TCARD = [{ a: 1, b: 19.5, t: 8 }, { a: 20.5, b: 36.5, t: 8 }, { a: 38, b: 56, t: 4 }, { a: 56, b: 74, t: 8 }, { a: 75, b: 98, t: 7 }];
// ================================================================ LEZIONI (tutorial)

const learnDone = () => store.get('bisca:learn') || [];
const goLearn = () => { closeSheet(); clearTimeout(ui.timer); G = null; ui.screen = 'learn'; ui.tutIntro = null; render(); };
const isL0 = () => G?.tut?.kind === 'l0';
const levelOpen = (k) => T.LEVELS.slice(0, k).every((lv) => lv.lessons.every((n) => learnDone().includes(n)));
function markLesson(n) { const d = learnDone(); if (!d.includes(n)) store.set('bisca:learn', [...d, n]); }

function renderLearn() {
  const done = learnDone();
  if (ui.learnLevel == null) { const k = T.LEVELS.findIndex((lv, i) => levelOpen(i) && lv.lessons.some((n) => !done.includes(n))); ui.learnLevel = k < 0 ? 0 : k; }
  const k = ui.learnLevel, lv = T.LEVELS[k], open = levelOpen(k);
  $app.innerHTML = `
    ${backBar('Allenati e impara')}
    <p class="muted">${esc(T.MASTER.name)} non ti dice cosa fare: ti fa vedere come si ragiona. Puoi ripetere ogni lezione quando vuoi.</p>
    <div class="seg lvtabs" >${T.LEVELS.map((l, i) => `<button aria-pressed="${i === k}" data-act="learn-level" data-k="${i}">${levelOpen(i) ? '' : '🔒 '}${esc(l.name)}</button>`).join('')}</div>
    ${open ? '' : `<p class="hint">Si apre quando completi il livello ${esc(T.LEVELS[k - 1].name)}.</p>`}
    <div class="lessons">${lv.lessons.map((n) => T.LESSONS[n]).map((l) => `<button class="lesson ${open ? '' : 'soon'}" ${open ? `data-act="lesson" data-n="${l.n}"` : 'disabled'}>
      <span class="ln">${l.maestro ? '★' : l.n}</span><span class="mt"><b>${esc(l.title)}</b><span>${esc(l.desc)}</span></span>
      <span class="ls">${done.includes(l.n) ? '<em class="ok">✓ fatta</em>' : '<em>Inizia</em>'}</span></button>`).join('')}</div>`;
}

function startLesson(n) {
  if (n === 0) return startLesson0();
  if (T.LESSONS[n]?.maestro) return startMaestro();
  startScenario(n, 0, false, true);
}

function startScenario(n, i, variant, intro) {
  clearTimeout(ui.timer);
  const sc = T.scenarioOf(n, i, variant);
  const s = T.buildScenario(sc, settings.name || 'Tu');
  G = { s, cfg: {}, level: 'medio', tut: { kind: 'sc', lesson: n, i, variant, sc, phase: 'ask' }, at: Date.now(), id: 'tut', rec: { calls: [], plays: [] }, firstDealer: s.round.dealerId };
  Object.assign(ui, { screen: 'game', sel: null, showLast: false, confirmQuit: false, lastTurn: null, saved: null, coach: null, coachWrong: null, tutIntro: intro ? 0 : null, tutHint: null });
  requestWake();
  render();
}

function startMaestro() {
  clearTimeout(ui.timer);
  const s = E.createGame({ code: 'SP', hostId: LOCAL_ME, hostName: settings.name || 'Tu' });
  const cfg = {};
  CPU_NAMES.filter((x) => x.toLowerCase() !== (settings.name || '').toLowerCase()).sort(() => Math.random() - 0.5).slice(0, 3).forEach((nm, i) => {
    const id = 'cpu' + i;
    E.addPlayer(s, { id, name: nm, cpu: { level: 'medio' } });
    cfg[id] = { level: 'medio', persona: AI.makePersona(Math.random) };
  });
  E.startGame(s);
  G = { s, cfg, level: 'medio', tut: { kind: 'maestro', lesson: 11 }, at: Date.now(), id: 'tut', rec: { calls: [], plays: [] }, firstDealer: s.round.dealerId };
  Object.assign(ui, { screen: 'game', sel: null, showLast: false, confirmQuit: false, lastTurn: null, saved: null, coach: null, coachWrong: null, tutIntro: 0, tutHint: null });
  requestWake();
  render();
}

const tutIntroList = () => (isL0() ? T.INTRO0 : T.INTROS[G?.tut?.lesson] || []);

// Le possibili mosse per me in questo momento (chiamate valide o carte in mano)
function tutOptions(s) {
  const r = s.round;
  if (s.phase === 'calling') {
    const f = r.dealerId === LOCAL_ME ? E.forbiddenCall(s) : null;
    return [...Array(r.cards + 1).keys()].filter((k) => k !== f).map((k) => ({ call: k }));
  }
  return r.hands[LOCAL_ME].flatMap((c) => (c === JOLLY ? [{ card: c, jolly: 'high' }, { card: c, jolly: 'low' }] : [{ card: c }]));
}
const optLabel = (o) => (o.call != null ? `Chiamare ${o.call}` : `${cardName(o.card)}${o.jolly ? (o.jolly === 'high' ? ' alto' : ' basso') : ''}`);
const sameOpt = (a, b) => (a.call != null ? a.call === b.call : a.card === b.card && (a.jolly || null) === (b.jolly || null));
const wordCls = (w) => ({ 'molto probabile': 'w5', probabile: 'w4', incerta: 'w3', rischiosa: 'w2', 'molto rischiosa': 'w1' }[w]);

// Nello scenario la tua scelta non parte subito: prima si guarda insieme quanto è probabile che vada bene.
function tutDecide(kind, v, jolly) {
  const s = G.s;
  const choice = kind === 'call' ? { call: v } : kind === 'jolly' ? { card: JOLLY, jolly: v } : { card: v, jolly: jolly || undefined };
  if (choice.card === JOLLY && !choice.jolly) { ui.sel = JOLLY; return render(); }
  const opts = tutOptions(s);
  const ev = AI.evaluateOptions(s, LOCAL_ME, opts, 300);
  Object.assign(G.tut, { phase: 'eval', choice, opts, ev });
  ui.sel = null;
  render();
  setTimeout(() => document.querySelector('.coach')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 30);
}

function tutWatch() {
  const s = G.s, c = G.tut.choice;
  G.tut.phase = 'watch';
  perform(() => (c.call != null ? E.makeCall(s, LOCAL_ME, c.call) : E.playCard(s, LOCAL_ME, c.card, c.jolly)));
}

function tutNextScenario() {
  const { lesson: n, i } = G.tut;
  if (i + 1 < T.SCENARIOS[n].length) return startScenario(n, i + 1, false, false);
  markLesson(n);
  toast('Lezione completata');
  goLearn();
}

// Contatori: solo nelle lezioni
function countersHTML(s) {
  const r = s.round;
  if (!r || (s.phase !== 'calling' && s.phase !== 'playing')) return '';
  const calls = Object.values(r.calls);
  const sum = calls.reduce((a, b) => a + b, 0);
  const parts = [];
  if (s.phase === 'calling') {
    const d = r.cards - sum;
    parts.push(`Prese in palio <b>${r.cards}</b>`, `Chiamate <b>${sum}</b>`, `Differenza <b>${d > 0 ? `ne avanzano ${d}` : d < 0 ? `${-d} di troppo` : 'pari'}</b>`);
  } else {
    const left = r.cards - r.trickNo + 1;
    const want = r.seats.reduce((a, id) => a + Math.max(0, (r.calls[id] ?? 0) - r.won[id]), 0);
    const need = (r.calls[LOCAL_ME] ?? 0) - r.won[LOCAL_ME];
    parts.push(`Mani da giocare <b>${left}</b>`, `Prese ancora cercate <b>${want}</b>`);
    if (r.hands[LOCAL_ME]) parts.push(`Ti ${need === 1 ? 'manca' : 'mancano'} <b>${Math.max(0, need)}</b>${need < 0 ? ` <b>(${-need} di troppo)</b>` : ''}`);
    if (ui.sel != null && r.hands[LOCAL_ME]?.includes(ui.sel)) {
      if (ui.sel === JOLLY) parts.push('Asso di denari: <b>decidi tu</b> se è sopra o sotto tutte');
      else {
        const seen = new Set([...r.hands[LOCAL_ME], ...(r.played || []), ...r.trick.plays.map((p) => p.card)]);
        let above = 0;
        for (let c = 0; c < 40; c++) if (!seen.has(c) && strength(c, 'high') > strength(ui.sel)) above++;
        parts.push(`Carte più forti della tua ancora in giro <b>${above}</b>`);
      }
    }
  }
  return `<div class="tcount">${parts.map((p) => `<span>${p}</span>`).join('')}</div>`;
}

function masterImg(kind = 'circle') {
  return avById(T.MASTER.id) ? avImg(T.MASTER.id, kind) : null;
}

function startLesson0() {
  const s = T.lesson0(settings.name || 'Tu');
  G = { s, cfg: {}, level: 'medio', tut: { kind: 'l0', lesson: 0, done: [] }, at: Date.now(), id: 'tut', rec: { calls: [], plays: [] }, firstDealer: s.round.dealerId };
  Object.assign(ui, { screen: 'game', sel: null, showLast: false, confirmQuit: false, lastTurn: null, saved: null, coach: null, coachWrong: null, tutIntro: 0 });
  requestWake();
  render();
}

// Il prossimo momento della lezione: se c'è, il maestro parla e la partita aspetta.
function tutCheck() {
  const s = G.s;
  const m = T.MOMENTS0.find((x) => !G.tut.done.includes(x.id) && x.when(s));
  if (ui.coach?.id !== m?.id) ui.coachWrong = null;
  ui.coach = m || null;
  render();
  return !!m && (m.tap || m.gate);
}

function tutNext() {
  const m = ui.coach;
  if (!m) return;
  G.tut.done.push(m.id);
  ui.coach = null; ui.coachWrong = null;
  if (m.last) {
    markLesson(G.tut.lesson);
    toast('Lezione completata');
    return goLearn();
  }
  step();
}

// Nelle lezioni si può fare solo la mossa giusta: le altre le spiega il maestro.
function tutAllow(kind, v, jolly) {
  if (!G?.tut || remote()) return true;
  if (G.tut.kind === 'sc') {
    if (G.tut.phase === 'ask') { tutDecide(kind, v, jolly); return false; }
    return G.tut.phase === 'watch';
  }
  if (!isL0()) return true;
  const m = ui.coach;
  if (!m?.gate) return false;
  const g = m.gate;
  const ok = kind === 'call' ? v === g.call : kind === 'card' ? v === g.card : kind === 'jolly' ? v === g.jolly : false;
  if (ok) { G.tut.done.push(m.id); ui.coach = null; ui.coachWrong = null; return true; }
  ui.coachWrong = m.wrong || 'Non ancora: segui il consiglio.';
  render();
  return false;
}

function coachFace() {
  const im = masterImg();
  return im ? `<img class="av coachav" src="${im}" alt="">` : `<span class="av coachav ini" style="--pc:var(--accent)">FC</span>`;
}
function coachBox(inner, cls = '') {
  return `<div class="coach ${cls}">${coachFace()}<div class="ct"><b>${esc(T.MASTER.name)}</b>${inner}</div></div>`;
}

function coachHTML(status) {
  if (!G?.tut) return '';
  if (ui.tutIntro != null) return ''; // l'introduzione ha la sua finestra
  if (G.tut.kind === 'sc') return scCoachHTML();
  if (G.tut.kind === 'maestro') return maestroCoachHTML(status);
  const face = coachFace();
  const m = ui.coach;
  if (!m) return `<div class="coach quiet">${face}<p>…</p></div>`;
  return `<div class="coach ${ui.coachWrong ? 'wrong' : ''}">${face}<div class="ct"><b>${esc(T.MASTER.name)}</b><p>${m.say}</p>${ui.coachWrong ? `<p class="cw">${ui.coachWrong}</p>` : ''}</div>${m.tap ? '<button class="btn small" data-act="tut-next">Avanti</button>' : ''}</div>`;
}

function scButtons(withWatch) {
  const { sc, variant } = G.tut;
  const base = T.SCENARIOS[G.tut.lesson][G.tut.i];
  const last = G.tut.i + 1 >= T.SCENARIOS[G.tut.lesson].length;
  return `<div class="tbtns">
    <button class="btn small light" data-act="tut-retry">Riprova</button>
    ${base.alt ? `<button class="btn small light" data-act="tut-alt">${variant ? 'Torna alla prima' : esc(base.alt.label)}</button>` : ''}
    ${withWatch ? '<button class="btn small light" data-act="tut-watch">Guarda come va</button>' : ''}
    <button class="btn small" data-act="tut-sc-next">${last ? 'Fine lezione' : 'Avanti'}</button></div>`;
}

function scCoachHTML() {
  const s = G.s, r = s.round, tu = G.tut, sc = tu.sc;
  const head = `<p class="tstep">Lezione ${tu.lesson} · situazione ${tu.i + 1} di ${T.SCENARIOS[tu.lesson].length}${tu.variant ? ' · variante' : ''}</p>`;
  if (tu.phase === 'ask') {
    const tip = s.phase === 'calling' ? 'Scegli la tua chiamata.' : 'Tocca una carta per guardarla, poi giocala.';
    return coachBox(`${head}<p>${sc.say}</p>${countersHTML(s)}<p class="tsub">${tip}</p>`);
  }
  if (tu.phase === 'eval') {
    const k = tu.opts.findIndex((o) => sameOpt(o, tu.choice));
    const w = T.chanceWord(tu.ev[k] ?? 0);
    const what = tu.choice.call != null ? `centrare la chiamata è <b class="${wordCls(w)}">${w}</b>` : `chiudere il turno con la chiamata giusta è <b class="${wordCls(w)}">${w}</b>`;
    const rows = tu.opts.map((o, i) => ({ o, i, w: T.chanceWord(tu.ev[i]) }));
    return coachBox(`${head}<p>Hai scelto <b>${esc(optLabel(tu.choice))}</b>: ${what}.</p>
      <ul class="tchances">${rows.map((x) => `<li class="${x.i === k ? 'mine' : ''}"><span>${esc(optLabel(x.o))}</span><em class="${wordCls(x.w)}">${x.w}</em></li>`).join('')}</ul>
      <p>${sc.why}</p>${scButtons(true)}`, 'big');
  }
  if (s.phase === 'roundEnd' || s.phase === 'finished') {
    const x = r.results?.[LOCAL_ME];
    const res = x ? `Hai chiamato <b>${x.call}</b> e preso <b>${x.won}</b>: ${x.lost ? `perdi <b>${x.lost === 1 ? 'una vita' : x.lost + ' vite'}</b>` : '<b>nessuna vita persa</b>'}${x.bonus3 ? ' e guadagni una vita con il tre su tre' : ''}.` : '';
    return coachBox(`${head}<p>${res} Le carte degli altri erano preparate, ma le loro mosse le ha decise la CPU: rigiocando può andare diversamente.</p>${scButtons(false)}`, 'big');
  }
  const mine = (r.pendingJolly || r.turnId) === LOCAL_ME;
  return coachBox(`<p>${mine ? 'Continua tu: gioca come preferisci.' : 'Vediamo come va…'}</p>${countersHTML(s)}`);
}

function maestroCoachHTML(status) {
  const s = G.s, r = s.round;
  if (s.phase === 'finished') { markLesson(11); return coachBox('<p>Partita finita. Le domande che ti ho fatto sono quelle che un buon giocatore si fa da solo, ogni volta. Da qui in poi tocca a te.</p>'); }
  const mine = (s.phase === 'calling' || s.phase === 'playing') && !ui.showLast && (r.pendingJolly || r.turnId) === LOCAL_ME && !meOut();
  if (!mine) return `<div class="status small" aria-live="polite">${status || ''}</div>`;
  const key = `${r.n}-${s.phase}-${r.trickNo}-${r.trick.plays.length}`;
  const h = ui.tutHint?.key === key ? ui.tutHint : null;
  const list = h ? `<ul class="tchances">${h.rows.map((x) => `<li><span>${esc(optLabel(x.o))}</span><em class="${wordCls(x.w)}">${x.w}</em></li>`).join('')}</ul>` : '';
  return coachBox(`<p>${T.maestroQuestion(s, LOCAL_ME)}</p>${countersHTML(s)}${list}${h || r.pendingJolly ? '' : '<div class="tbtns"><button class="btn small light" data-act="tut-hint">Un consiglio</button></div>'}`);
}

function maestroHint() {
  const s = G.s, r = s.round;
  const opts = tutOptions(s);
  const ev = AI.evaluateOptions(s, LOCAL_ME, opts, 300);
  const rows = opts.map((o, i) => ({ o, p: ev[i], w: T.chanceWord(ev[i]) })).sort((a, b) => b.p - a.p).slice(0, 4);
  ui.tutHint = { key: `${r.n}-${s.phase}-${r.trickNo}-${r.trick.plays.length}`, rows };
  render();
}

function introHTML() {
  if (!G?.tut || ui.tutIntro == null) return '';
  const i = ui.tutIntro, L = tutIntroList();
  if (!L.length) return '';
  const full = masterImg('full');
  return `<div class="tutintro" role="dialog" aria-modal="true"><div class="tib">
    ${full ? `<img class="tifig" src="${full}" alt="">` : ''}
    <div class="tibub"><b>${esc(T.MASTER.name)}</b><p>${L[i]}</p></div>
    <div class="tidots">${L.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
    <button class="btn" data-act="tut-intro">${i < L.length - 1 ? 'Avanti' : 'Iniziamo'}</button>
  </div></div>`;
}

function animateOneWin() {
  const el = document.querySelector('.tview .tcard.onewin');
  if (!el) return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.style.transition = 'left .8s ease, top .8s ease, scale .8s ease';
    el.style.left = '50%'; el.style.top = '50%'; el.style.scale = '1.7'; el.style.zIndex = 45;
  }));
}

function focusCoach() {
  animateOneWin();
  // scelta dell'asso di denari: i due tasti devono vedersi senza scorrere
  if (ui.sel === JOLLY) setTimeout(() => document.querySelector('.actions')?.scrollIntoView({ block: 'end', behavior: 'smooth' }), 30);
  document.querySelectorAll('.tut-focus').forEach((e) => e.classList.remove('tut-focus'));
  const f = isL0() && ui.tutIntro == null && ui.coach?.focus;
  if (f) document.querySelectorAll(f).forEach((e) => e.classList.add('tut-focus'));
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffled = (arr) => arr.map((v) => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);

function makeScene() {
  const used = new Set();
  const take = (poses) => {
    const pool = AVATARS.filter((a) => !used.has(a.id) && (!poses || poses.includes(a.pose)));
    const a = pick(pool.length ? pool : AVATARS.filter((x) => !used.has(x.id)));
    if (a) used.add(a.id);
    return a?.id;
  };
  const r = Math.random();
  const kind = r < 0.15 ? 'retata' : r < 0.3 ? 'foto' : 'tavolo';
  const chars = [], peeks = [];
  if (kind === 'tavolo') {
    // chi indica sta a sinistra e punta verso il centro, chi guarda in su sta sotto il titolo,
    // a braccia conserte davanti, a destra quello che bara (mezzo coperto da un asso)
    chars.push({ id: take(['point']), x: -2, h: 50, z: 3, role: 'point' });
    chars.push({ id: take(['up']), x: 18, h: 47, z: 2 });
    chars.push({ id: take(['cross']), x: 37, h: 52, z: 4 });
    chars.push({ id: take(['up', 'stand']), x: 57, h: 47, z: 2 });
    chars.push({ id: take(['stand', 'cross']), x: 76, h: 50, z: 3, baro: true });
    peeks.push({ id: take(null), card: Math.floor(Math.random() * 5) });
  } else if (kind === 'foto') {
    for (let i = 0; i < 6; i++) chars.push({ id: take(null), x: -3 + i * 16.5, h: 46, z: 2 + (i % 2) });
  } else {
    // la retata: tutti dietro le carte, uno solo fa finta di niente
    for (let c = 0; c < 5; c++) peeks.push({ id: take(null), card: c });
    chars.push({ id: take(['cross', 'stand']), x: 37, h: 52, z: 4 });
  }
  for (const c of chars) {
    const a = AVATARS.find((x) => x.id === c.id);
    // chi indica a destra del centro si gira verso il centro
    c.mirror = a?.pose === 'point' && ((a.dir === 'left') === (c.x < 40));
  }
  return { kind, chars: chars.filter((c) => c.id), peeks: peeks.filter((p) => p.id), hidden: {} };
}

function sceneHTML() {
  if (!AVATARS.length) return '<div class="scene"></div>';
  const sc = ui.scene || (ui.scene = makeScene());
  const nameOfAv = (id) => AVATARS.find((a) => a.id === id)?.name || '';
  const peeks = TCARD.map((c, i) => {
    const pk = sc.peeks.filter((p) => p.card === i).map((p) => `<button class="sc-peek ${sc.hidden[p.id] ? 'down' : ''}" data-act="sc-peek" data-id="${p.id}" aria-label="${esc(nameOfAv(p.id))}"><img src="${avImg(p.id, 'full')}" alt=""></button>`).join('');
    return pk ? `<div class="sc-pw" style="left:${c.a}%;width:${c.b - c.a}%;top:${c.t}%">${pk}</div>` : '';
  }).join('');
  const cards = `<div class="sc-tbox">${peeks}<img class="sc-title" src="icons/title.webp" alt="Bisca"></div>`;
  const chars = sc.chars.map((c, i) => `<button class="sc-ch" data-act="sc-ch" data-i="${i}" style="left:${c.x}%;height:${c.h}%;z-index:${c.z}" aria-label="${esc(nameOfAv(c.id))}"><img src="${avImg(c.id, 'full')}" alt="" class="${c.mirror ? 'mir' : ''}"></button>`).join('');
  const baro = sc.chars.find((c) => c.baro);
  return `<div class="scene" id="scene" aria-label="La tavolata di Bisca">
    ${cards}
    <img class="sc-ace" src="${cardSrc(20)}" alt="" style="left:-3%;top:46%;--r:-20deg;z-index:1">
    <img class="sc-ace" src="${cardSrc(0)}" alt="" style="left:89%;top:46%;--r:18deg;z-index:1">
    ${baro ? `<img class="sc-ace" src="${cardSrc(10)}" alt="" style="left:${baro.x + 9}%;bottom:12%;--r:-32deg;z-index:5;width:9%">` : `<img class="sc-ace" src="${cardSrc(10)}" alt="" style="left:30%;bottom:2%;--r:72deg;z-index:5;width:9%">`}
    <button class="sc-ace jolly" data-act="sc-ace" aria-label="Asso di denari: cambia la tavolata" style="left:87%;top:6%;--r:14deg"><img src="${cardSrc(30)}" alt=""></button>
    ${chars}
  </div>`;
}

function sceneBubble(el, name, say) {
  const scene = document.getElementById('scene');
  if (!scene) return;
  scene.querySelector('.sc-bub')?.remove();
  const sb = scene.getBoundingClientRect(), eb = el.getBoundingClientRect();
  const b = document.createElement('div');
  b.className = 'sc-bub';
  // la frase scelta nel pannello admin per quel personaggio, altrimenti una a caso
  b.innerHTML = `<b>${esc(name)}</b>${esc(say && Math.random() < 0.7 ? say : pick(SAY))}`;
  scene.appendChild(b);
  const cx = eb.left - sb.left + eb.width / 2;
  b.style.left = Math.max(70, Math.min(sb.width - 70, cx)) + 'px';
  b.style.top = Math.max(0, eb.top - sb.top - 6) + 'px';
  clearTimeout(ui.bubT);
  ui.bubT = setTimeout(() => b.remove(), 2600);
}

function sceneTap(el) {
  const sc = ui.scene;
  if (!sc) return;
  const c = sc.chars[Number(el.dataset.i)];
  if (!c) return;
  el.classList.remove('hop'); void el.offsetWidth; el.classList.add('hop');
  const a = avById(c.id);
  sceneBubble(el, a?.name || '', a?.say);
}

function scenePeek(el) {
  const sc = ui.scene;
  const id = el.dataset.id;
  if (!sc || sc.hidden[id]) return;
  sc.hidden[id] = true;
  el.classList.add('down');
  // dopo un po' rispunta dietro un'altra carta libera
  setTimeout(() => {
    if (ui.scene !== sc) return;
    const p = sc.peeks.find((x) => x.id === id);
    const free = [0, 1, 2, 3, 4].filter((k) => !sc.peeks.some((x) => x.card === k));
    if (p && free.length) p.card = pick(free);
    delete sc.hidden[id];
    if (ui.screen === 'home') render();
  }, 2400);
}

function sceneShuffle(el) {
  el.classList.add('spin');
  setTimeout(() => { if (ui.screen !== 'home') return; ui.scene = makeScene(); render(); }, 650);
}

// ogni 12 secondi un personaggio esce e ne entra un altro
setInterval(() => {
  const sc = ui.scene;
  if (ui.screen !== 'home' || !sc || ui.sheet || document.visibilityState !== 'visible') return;
  const slots = [...sc.chars.map((c, i) => ['c', i]), ...sc.peeks.map((p, i) => ['p', i])];
  if (!slots.length) return;
  const [kind, i] = pick(slots);
  const cur = kind === 'c' ? sc.chars[i] : sc.peeks[i];
  const inScene = new Set([...sc.chars, ...sc.peeks].map((x) => x.id));
  const old = AVATARS.find((a) => a.id === cur.id);
  const pool = AVATARS.filter((a) => !inScene.has(a.id) && (kind === 'p' || a.pose === old?.pose));
  const next = pick(pool.length ? pool : AVATARS.filter((a) => !inScene.has(a.id)));
  if (!next) return;
  const el = kind === 'c' ? document.querySelector(`.sc-ch[data-i="${i}"]`) : document.querySelector(`.sc-peek[data-id="${cur.id}"]`);
  const swap = () => {
    cur.id = next.id;
    if (kind === 'c') cur.mirror = next.pose === 'point' && ((next.dir === 'left') === (cur.x < 40));
    if (ui.screen === 'home') render();
  };
  if (!el) return swap();
  new Image().src = avImg(next.id, 'full');
  el.classList.add('leave');
  setTimeout(swap, 450);
}, 12000);

// Il link al pannello admin compare solo sul telefono dove l'admin ha già messo la chiave
// (la chiave resta comunque necessaria). La prima volta: 7 tocchi sulla scritta sotto la scena.
const hasAdminKey = () => { try { return !!localStorage.getItem('bisca:statskey'); } catch { return false; } };

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; if (ui.sheet === 'install') drawSheet(); });

function installHTML() {
  const ua = navigator.userAgent || '';
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document);
  const iphone = `<div class="istep"><h3>iPhone</h3><ol>
      <li>Apri il link di Bisca con <b>Safari</b>.</li>
      <li>Tocca <b>Condividi</b> ${ICONS.share} nella barra in basso.</li>
      <li>Scorri e tocca <b>Aggiungi alla schermata Home</b>.</li>
      <li>Tocca <b>Aggiungi</b>: l'icona di Bisca compare tra le tue app.</li></ol></div>`;
  const android = `<div class="istep"><h3>Android</h3><ol>
      <li>Apri il link di Bisca con <b>Chrome</b>.</li>
      <li>Tocca il menu ${ICONS.dots} in alto a destra.</li>
      <li>Tocca <b>Installa app</b> (o <b>Aggiungi a schermata Home</b>).</li>
      <li>Conferma: l'icona di Bisca compare tra le tue app.</li></ol></div>`;
  return `<h2>Come scaricare l'app</h2>
    <div class="ifree"><b>Non occupa spazio</b><span>Non passa dallo store e non si scarica niente di pesante: è un collegamento che si apre a tutto schermo come un'app e si aggiorna da solo.</span></div>
    ${installPrompt ? '<button class="btn" data-act="install-now">Installa ora</button>' : ''}
    ${ONLINE === false ? '<p class="hint">Si installa dalla versione online di Bisca (il link che finisce con workers.dev).</p>' : ''}
    ${ios ? iphone + android : android + iphone}`;
}

function backBar(title) {
  return `<div class="topbar"><button class="iconbtn" data-act="home" aria-label="Indietro"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button><div class="t"><b>${title}</b></div></div>`;
}

function viewSegHTML() {
  return `<div class="seg two" role="group" aria-label="Vista del tavolo">${[['table', 'Tavolo'], ['classic', 'Classica']].map(([v, l]) => `<button data-act="view" data-v="${v}" aria-pressed="${viewMode() === v}">${l}</button>`).join('')}</div>`;
}

function renderSpSetup() {
  const saved = store.get('bisca-sp:game');
  const canResume = saved && saved.s && saved.s.phase !== 'finished';
  const n = settings.cpus;
  $app.innerHTML = `
    ${backBar('Single player')}
    <label class="label" for="nick">Il tuo nome</label>
    <div class="namerow"><button class="avbtn" data-act="pop-avatar" aria-label="Cambia il tuo avatar">${avatarHTML({ id: LOCAL_ME, name: settings.name || '?' }, 'lg')}</button><input id="nick" class="field" maxlength="22" autocomplete="nickname" placeholder="Es. Thomas" value="${esc(settings.name)}"></div>
    <div class="label">Avversari</div>
    <div class="stepper">
      <button data-act="cpus" data-d="-1" aria-label="Meno avversari" ${n <= 2 ? 'disabled' : ''}>−</button>
      <div class="val"><b>${n} CPU</b><span>si gioca in ${n + 1}</span></div>
      <button data-act="cpus" data-d="1" aria-label="Più avversari" ${n >= 12 ? 'disabled' : ''}>+</button>
    </div>
    <div class="label">Difficoltà</div>
    <div class="seg" role="group" aria-label="Difficoltà">
      ${LEVELS.map((l) => `<button data-act="level" data-l="${l}" aria-pressed="${settings.level === l}">${cap(l)}</button>`).join('')}
    </div>
    <p class="hint">${LEVEL_HINT[settings.level]}</p>
    <div class="label">Vista del tavolo</div>
    ${viewSegHTML()}
    <button class="btn" data-act="sp-start">Inizia la partita</button>
    ${canResume ? `<button class="btn ghost" data-act="sp-resume">Riprendi la partita · turno ${saved.s.roundNo}</button>` : ''}
`;
}

// ---------------------------------------------------------------- partite live (spettatori)

const goLive = () => {
  if (ONLINE === false) return toast('Le partite live si vedono nella versione online di Bisca.');
  closeSheet(); ui.screen = 'live'; ui.live = ui.live || null; render(); loadLive();
};
async function loadLive() {
  try { ui.live = await api('live'); } catch { ui.live = ui.live || []; }
  if (ui.screen === 'live') render();
}
setInterval(() => { if (ui.screen === 'live' && document.visibilityState === 'visible') loadLive(); }, 8000);

function renderLive() {
  const list = ui.live;
  const card = (g) => {
    const alive = g.players.filter((p) => !p.out);
    const what = g.phase === 'lobby' ? 'In sala d\'attesa' : `Turno ${g.roundNo}${g.cards ? ` · ${carte(g.cards)}` : ''}`;
    return `<div class="livecard">
      <div class="lh"><b class="code">${esc(g.code)}</b><span class="tag ${g.phase === 'lobby' ? 'gold' : ''}">${what}</span>${g.spectators ? `<span class="muted lsp">${EYE}${g.spectators}</span>` : ''}</div>
      <div class="lp">${alive.slice(0, 13).map((p) => `<span>${esc(p.name)}${g.phase === 'lobby' ? '' : ` <em>♥${p.lives}</em>`}</span>`).join('')}</div>
      <div class="la"><button class="btn small ${g.open ? 'ghost' : ''}" data-act="live-open" data-code="${esc(g.code)}">Guarda</button>${g.open ? `<button class="btn small" data-act="live-open" data-code="${esc(g.code)}">Entra a giocare</button>` : ''}</div>
    </div>`;
  };
  $app.innerHTML = `
    ${backBar('Partite live')}
    <p class="muted">Le partite in corso e le stanze che aspettano giocatori. Chi guarda vede le carte giocate, non le mani.</p>
    <button class="btn ghost" data-act="pop-join">Hai un codice? Inseriscilo</button>
    ${list === null || list === undefined ? '<p class="hint">Carico le partite…</p>' : list.length ? `<div class="livelist">${list.map(card).join('')}</div>` : '<div class="panel"><p class="muted" style="text-align:center">Nessuna partita in corso in questo momento.</p></div>'}`;
}

function renderMp() {
  const list = Object.entries(rooms.all()).sort((a, b) => b[1].at - a[1].at).slice(0, 5);
  $app.innerHTML = `
    ${backBar('Gioca con i tuoi amici')}
    <div class="modes">
      <button class="mode" data-act="pop-create"><span class="mi">${ICONS.plus}</span><span class="mt"><b>Crea una stanza</b><span>Diventi tu l'host: inviti gli amici e avvii la partita</span></span>${ICONS.chev}</button>
      <button class="mode alt" data-act="pop-join"><span class="mi">${ICONS.key}</span><span class="mt"><b>Accedi a una stanza</b><span>Inserisci il codice che ti hanno mandato</span></span>${ICONS.chev}</button>
    </div>
    ${list.length ? `<div class="label">Le tue stanze</div><div class="recent">${list.map(([c, v]) => `<button data-act="rejoin" data-code="${esc(c)}"><span><b class="code">${esc(c)}</b> <span class="muted">· ${v.as === 'spectator' ? 'spettatore' : 'giocatore'}</span></span><span class="muted">Rientra ›</span></button>`).join('')}</div>` : ''}`;
}

// ---------------------------------------------------------------- sala d'attesa

function renderLobby() {
  const s = R.s;
  const host = s.hostId === R.me;
  const total = s.players.length;
  const hostName = s.players.find((p) => p.id === s.hostId)?.name || '';
  const rows = s.players.map((p) => {
    const mine = p.id === R.me;
    const online = p.cpu || R.online.has(p.id);
    let right = '';
    if (p.cpu) {
      right = host
        ? `<label class="sr" for="lv-${p.id}">Livello di ${esc(p.name)}</label><select id="lv-${p.id}" class="lvl" data-act="cpu-level" data-pid="${p.id}">${LEVELS.map((l) => `<option value="${l}" ${p.cpu.level === l ? 'selected' : ''}>${cap(l)}</option>`).join('')}</select>`
        : `<span class="tag">${cap(p.cpu.level)}</span>`;
    } else {
      if (p.id === s.hostId) right += '<span class="tag gold">host</span>';
      if (mine) right += `<button class="mini-btn" data-act="pop-rename" aria-label="Cambia il tuo nome"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg></button>`;
    }
    const minus = host && !mine ? `<button class="mini-btn" data-act="remove" data-pid="${p.id}" aria-label="Togli ${esc(p.name)}">−</button>` : '';
    const av = mine ? `<button class="avbtn" data-act="pop-avatar" aria-label="Cambia il tuo avatar">${avatarHTML(p, 'md')}</button>` : avatarHTML(p, 'md');
    return `<li>${av}<span class="dotc ${online ? '' : 'off'}" title="${online ? 'Online' : 'Offline'}"></span><span class="nm">${esc(p.name)}${mine ? ' <span class="muted">(tu)</span>' : ''}${p.cpu ? ' <span class="cpu">CPU</span>' : ''}</span><span class="rt">${right}${minus}</span></li>`;
  }).join('');
  const specs = s.spectators.length ? `<div class="label" style="margin-top:6px">Spettatori</div><ul class="plist">${s.spectators.map((p) => `<li><span class="dotc ${R.online.has(p.id) ? '' : 'off'}"></span><span class="nm">${esc(p.name)}${p.id === R.me ? ' <span class="muted">(tu)</span>' : ''}</span><span class="rt">${host ? `<button class="mini-btn" data-act="remove" data-pid="${p.id}" aria-label="Togli ${esc(p.name)}">−</button>` : ''}</span></li>`).join('')}</ul>` : '';
  $app.innerHTML = `
    <div class="topbar"><button class="iconbtn" data-act="leave-room" aria-label="Esci dalla stanza"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button><div class="t"><b>Sala d'attesa</b><span>${host ? 'Sei l\'host della stanza' : `Host: ${esc(hostName)}`}</span></div><button class="iconbtn" data-act="rules" aria-label="Regole">?</button></div>
    <div class="panel center">
      <div class="label">Codice di invito</div>
      <div class="bigcode">${esc(s.code)}</div>
      <div class="row2"><button class="btn small ghost" data-act="copy-code">Copia codice</button><button class="btn small" data-act="share">Invia invito</button></div>
    </div>
    ${s.lastWinners?.length ? `<p class="hint">Ultima partita: ha vinto <b>${s.lastWinners.map(esc).join(' e ')}</b></p>` : ''}
    <div class="panel">
      <div class="lhead"><b>Giocatori ${total}/13</b><span class="muted">minimo 3</span>${host ? `<button class="btn small" data-act="pop-addcpu" ${total >= 13 ? 'disabled' : ''} aria-label="Aggiungi CPU">+ CPU</button>` : ''}</div>
      <ul class="plist">${rows}</ul>
      ${specs}
    </div>
    <div class="col bottom">
      ${host
        ? `<button class="btn" data-act="start" ${total < 3 ? 'disabled' : ''}>${total < 3 ? 'Servono almeno 3 giocatori' : `Avvia la partita (${total})`}</button><p class="hint">Puoi completare il tavolo con le CPU. All'avvio si sorteggiano posti e mazziere.</p>`
        : `<p class="hint">In attesa che ${esc(hostName)} avvii la partita…</p>`}
      <button class="btn ghost" data-act="leave-room">Esci dalla stanza</button>
    </div>`;
}

// ---------------------------------------------------------------- tavolo

// Conto alla rovescia della mossa: online compare negli ultimi 15 secondi, offline sempre.
function timerInfo(pid) {
  if (!remote() || R.deadlineFor !== pid || R.deadline == null || ui.showLast) return null;
  const now = Date.now() + R.offset;
  const left = Math.max(0, Math.ceil((R.deadline - now) / 1000));
  if (!R.online.has(pid)) return { text: `offline · CPU tra ${left}s`, left };
  if (left <= 15) return { text: `${left} secondi`, left };
  return { later: R.deadline - 15000 - now };
}
function timerFor(pid) {
  const t = timerInfo(pid);
  if (!t) return null;
  if (t.later != null) {
    // diventa visibile più tardi: un solo ridisegno al momento giusto
    if (!ui.redraw) ui.redraw = setTimeout(() => { ui.redraw = null; render(); }, Math.max(200, t.later + 50));
    return null;
  }
  return { text: `<span data-timer="${pid}">${t.text}</span>`, hurry: true, left: t.left };
}
// aggiorna solo i numeri del conto alla rovescia, senza ridisegnare la pagina
setInterval(() => {
  for (const el of document.querySelectorAll('[data-timer]')) {
    const t = timerInfo(el.dataset.timer);
    if (t?.text) el.textContent = el.dataset.short ? `${t.left}s` : t.text;
  }
}, 500);

function chipHTML(p, s, r, live) {
  const me = ME();
  const inRound = r.seats.includes(p.id) && !p.eliminated;
  const turn = live && !ui.showLast && (r.pendingJolly || r.turnId) === p.id;
  const leader = s.phase === 'playing' && !ui.showLast && r.trick.leader === p.id;
  const tags = [];
  const isDealer = r.dealerId === p.id;
  if (p.eliminated) tags.push(p.kicked ? 'espulso' : 'fuori');
  else if (turn) tags.push(p.id === me ? (isDealer ? 'tu' : 'tocca a te') : 'pensa…');
  else if (leader) tags.push('ha aperto');
  else if (p.id === me) tags.push('tu');
  if (p.kickPending) tags.push('esce');
  let stats = '';
  if (inRound && (live || s.phase === 'roundEnd')) {
    const call = r.calls[p.id];
    const calling = s.phase === 'calling';
    const left = r.cards - (r.trickNo - 1);
    let cls = '';
    if (!calling && call != null) {
      if (r.won[p.id] > call || r.won[p.id] + left < call) cls = 'bad';
      else if (r.won[p.id] === call) cls = 'ok';
    }
    stats = `<div class="stats"><div class="stat"><b>${call ?? '…'}</b><span>chiama</span></div><div class="stat ${cls}"><b>${calling ? '–' : r.won[p.id]}</b><span>prese</span></div></div>`;
  }
  const hand = r.hands[p.id] || [];
  const visible = hand.length && hand.every((c) => c >= 0);
  let peek = '';
  if (live && inRound && p.id !== me && visible) {
    if (r.cards === 1 && !watching()) peek = `<div class="peek">${img(hand[0], 'xs')}</div>`;
    else if (watching() && ui.reveal) peek = `<div class="peek">${hand.map((c) => img(c, 'xs')).join('')}</div>`;
  }
  const net = remote() && !p.cpu ? `<span class="ondot ${R.online.has(p.id) ? 'on' : 'off'}" title="${R.online.has(p.id) ? 'Online' : 'Offline'}"></span>` : '';
  const dealer = isDealer ? '<span class="mzl">Mazziere</span>' : '';
  let tagHTML = esc(tags.join(' · '));
  if (turn) {
    const t = timerFor(p.id);
    if (t) tagHTML = `<span class="${t.hurry ? 'hurry' : ''}">${t.text}</span>`;
  }
  const acted = ui.acted && ui.acted.pid === p.id && Date.now() - ui.acted.at < 1200 && !turn;
  return `<div class="chip ${turn ? 'turn' : ''} ${acted ? 'acted' : ''} ${p.eliminated ? 'out' : ''}" data-act="chip" data-pid="${p.id}" style="--pc:${colorOf(p.id)}">
    <div class="top">${avatarHTML(p, 'chipav')}<div class="nl"><b>${esc(p.name)}</b><span class="lives">♥${p.lives}</span></div></div>
    <div class="tag">${dealer}${net}<span class="tt">${tagHTML}</span></div>${stats}${peek}</div>`;
}

const watching = () => meOut();

// Chi deve ancora tirare in questa mano e com'è messo: lo usano tutte e due le viste.
function queueData(s, r) {
  if (ui.showLast || s.phase !== 'playing') return null;
  const me = ME();
  const seats = r.seats;
  const meIn = seats.includes(me) && !meOut();
  const playedIds = new Set(r.trick.plays.map((p) => p.pid));
  const i = seats.indexOf(r.trick.leader);
  const order = [];
  for (let k = 0; k < seats.length; k++) order.push(seats[(i + k) % seats.length]);
  let todo = order.filter((id) => !playedIds.has(id));
  const myTurn = (r.pendingJolly || r.turnId) === me;
  if (myTurn) todo = todo.filter((id) => id !== me);
  if (!todo.length) return meIn && myTurn ? { label: "Sei l'ultimo di mano", short: "Sei l'ultimo di mano", items: [] } : null;
  const status = (id) => {
    const need = r.calls[id] - r.won[id];
    if (r.calls[id] === 0 && r.won[id] === 0) return '<em>ha chiamato 0</em>';
    if (need > 0) return `<em class="need">deve prenderne ${need}</em>`;
    if (need === 0) return '<em>è a posto</em>';
    return '<em>ha già sforato</em>';
  };
  const needN = todo.filter((id) => r.calls[id] - r.won[id] > 0).length;
  const zeroN = todo.filter((id) => r.calls[id] === 0).length;
  const head = myTurn ? 'Dopo di te' : 'Devono ancora tirare';
  return {
    label: `${head}: ${todo.length} · <b>${needN}</b> ${needN === 1 ? 'deve' : 'devono'} prendere · <b>${zeroN}</b> ${zeroN === 1 ? 'ha' : 'hanno'} chiamato 0`,
    parts: [`${head}: <b>${todo.length}</b>`, `<b>${needN}</b> ${needN === 1 ? 'deve' : 'devono'} prendere`, `<b>${zeroN}</b> ${zeroN === 1 ? 'ha' : 'hanno'} chiamato 0`],
    items: todo.map((id) => `<span class="qi">${who(id)}${status(id)}</span>`),
  };
}

function queueHTML(s, r) {
  const q = queueData(s, r);
  if (!q) return '';
  return `<div class="queue"><div class="ql">${q.label}</div>${q.items.length ? `<div class="qrow hscroll">${q.items.join('')}</div>` : ''}</div>`;
}

// Turno da 1 carta: prima di scoprirle le carte stanno già sul tavolo (la propria coperta).
function oneCardTable(s, r) {
  if (r.cards !== 1 || ui.showLast || (s.phase !== 'calling' && s.phase !== 'playing')) return null;
  const played = Object.fromEntries(r.trick.plays.map((p) => [p.pid, p]));
  const me = ME();
  // la tua carta resta coperta finché non si scoprono tutte
  return r.seats.map((pid) => played[pid] || { pid, card: pid === me ? -1 : r.hands[pid]?.[0] ?? -1 });
}

function tableHTML(s, r) {
  const me = ME();
  const one = oneCardTable(s, r);
  if (one) {
    const sum = Object.values(r.calls).reduce((a, b) => a + b, 0);
    const cardsRow = one.map((p) => `<div class="slot"><span class="cw" style="--pc:${colorOf(p.pid)}">${img(p.card, 'sm')}</span><span>${esc(nameOf(p.pid))}</span></div>`).join('');
    return `<div class="callinfo"><div>Chiamate finora: <b>${sum}</b> su 1</div><div>Le carte si scoprono quando finiscono le chiamate</div></div>
      <div class="table"><div class="played"><div class="lbl">Sul tavolo</div><div class="hscroll" style="overflow-x:auto"><div class="row">${cardsRow}</div></div></div></div>`;
  }
  if (s.phase === 'calling' && !ui.showLast) {
    const missing = r.seats.filter((id) => r.calls[id] == null).length;
    const sum = Object.values(r.calls).reduce((a, b) => a + b, 0);
    const myTurn = r.turnId === me;
    const after = myTurn ? missing - 1 : missing;
    const line2 = myTurn
      ? (after ? `Dopo di te devono chiamare ancora <b>${after}</b> ${after === 1 ? 'giocatore' : 'giocatori'}` : 'Sei l\'ultimo a chiamare')
      : `Ancora <b>${missing}</b> ${missing === 1 ? 'giocatore deve' : 'giocatori devono'} chiamare`;
    return `<div class="callinfo"><div>Chiamate finora: <b>${sum}</b> su ${r.cards}</div><div>${line2}</div></div>`;
  }
  const last = ui.showLast && r.lastTrick;
  const plays = last ? r.lastTrick.plays : r.trick.plays;
  let best = null;
  for (const p of plays) if (strength(p.card, p.jolly) >= 0 && (!best || strength(p.card, p.jolly) > strength(best.card, best.jolly))) best = p;
  const beat = best
    ? `<span class="cw" style="--pc:${colorOf(best.pid)}">${img(best.card, 'md')}</span><div class="nm">${who(best.pid)}</div>`
    : `<div class="none"></div><div class="nm muted">nessuna</div>`;
  const slots = plays.map((p) => `<div class="slot ${p === best ? 'best' : ''}"><span class="cw" style="--pc:${colorOf(p.pid)}">${img(p.card, 'sm')}</span>${p.card === JOLLY ? `<div class="jt">${p.jolly === 'high' ? 'alta' : p.jolly === 'low' ? 'bassa' : '…'}</div>` : ''}<span>${esc(nameOf(p.pid))}</span>${p === best ? '<span class="tk">prende</span>' : ''}</div>`).join('');
  const meWaiting = !last && s.phase === 'playing' && r.seats.includes(me) && !meOut() && !plays.some((p) => p.pid === me);
  const label = last
    ? `<div class="winline">Mano ${r.lastTrick.no} di ${r.cards} · prende <b>${esc(nameOf(r.lastTrick.winner))}</b></div>`
    : `<div class="lbl">Sul tavolo · ${plays.length} di ${r.seats.length}</div>`;
  return `<div class="table">
    <div class="beat"><div class="lbl">${last ? 'Ha preso' : 'Da battere'}</div>${beat}</div>
    <div class="played">${label}<div class="hscroll" style="overflow-x:auto" id="playedScroll"><div class="row">${slots}${meWaiting ? `<div class="slot"><div class="wait" style="--pc:${colorOf(me)}"></div><span>tu</span></div>` : ''}</div></div></div>
  </div>`;
}

// ---------------------------------------------------------------- vista tavolo

// Posizioni delle carte giocate decise sulla pagina "Posizioni delle carte sul tavolo"
// (in % del tavolo; il primo è il posto in basso, poi in ordine di gioco).
const TABLE_POS = {
  7: [[50, 77.5], [64.9, 68.8], [66, 47.5], [61.7, 25.5], [35.8, 25.4], [33.1, 48.2], [35.8, 68.6]],
  8: [[50, 77.5], [79.3, 64.1], [66, 50], [79.4, 36.1], [50, 22.5], [20.7, 35.9], [34, 50], [21.1, 64.9]],
  9: [[50, 77.5], [62.8, 74.2], [65.9, 56.9], [66.9, 38.1], [57.5, 23.2], [43, 23.2], [31.3, 37.9], [34.1, 56.4], [36.7, 73.8]],
  10: [[50, 80.7], [78.3, 74], [71, 62.2], [71, 38.2], [78.4, 26.1], [50, 19.3], [21.7, 26], [28.9, 41.4], [29, 61.8], [21.6, 73.9]],
  11: [[50, 80.7], [69.6, 77.6], [72.2, 61.4], [71.2, 44.8], [69.1, 29.1], [58.6, 18.7], [42.1, 18.4], [29.8, 28.8], [28.8, 44.1], [27.1, 62.2], [34.9, 77.9]],
  12: [[50, 80.7], [66.6, 78.6], [72.7, 63.7], [71.2, 50], [70.7, 34.4], [64.9, 22.5], [50, 19.3], [36, 22.2], [26.9, 34.1], [28.8, 50], [29.9, 70.2], [35.4, 78.6]],
  13: [[50.3, 80.6], [62.4, 79.8], [70.4, 68.5], [71.8, 54.9], [71.6, 38.9], [69.6, 25], [58.6, 19.8], [42.3, 19.3], [30.2, 23.5], [29.1, 37.7], [27.5, 53.6], [31.3, 68.3], [37.2, 80.4]],
};

// La vista si sceglie per ogni stanza (all'ingresso), a meno di "usa sempre questa".
function viewMode() {
  if (remote() && R?.code) { const v = rooms.get(R.code)?.view; if (v) return v; }
  return settings.view === 'classic' ? 'classic' : 'table';
}
function setView(v) {
  if (remote() && R?.code && rooms.get(R.code)) rooms.put(R.code, { ...rooms.get(R.code), view: v });
  if (!remote() || settings.viewAlways) settings.view = v;
  saveSettings();
}

function viewPickHTML() {
  const opt = (v, title, desc) => `<button class="vpick" data-act="viewpick" data-v="${v}"><img src="icons/vista-${v}.webp" alt=""><b>${title}</b><span>${desc}</span></button>`;
  return `<h2>Come vuoi vedere la partita?</h2>
    <p class="muted">Vale solo per te: ognuno al tavolo sceglie la sua.</p>
    <div class="vpicks">${opt('table', 'Tavolo', 'Giocatori attorno al tavolo, le carte davanti a chi le tira')}${opt('classic', 'Classica', 'Giocatori in fila in alto, carte giocate al centro')}</div>
    <label class="vcheck"><input type="checkbox" id="viewalways"> Usa sempre questa (la cambi dal menu)</label>`;
}

// Posizioni attorno al tavolo ovale: tu in basso, gli altri in senso antiorario
// nell'ordine reale di gioco (chi gioca dopo di te sta in basso a destra).
// Chi è ancora al tavolo, nell'ordine di gioco: gli eliminati spariscono e il giro resta lo stesso.
function aliveOrder(s) {
  const o = s.order.length ? s.order : s.players.map((p) => p.id);
  // chi è appena uscito resta visibile fino alla fine del turno in cui è uscito
  return o.filter((id) => { const p = s.players.find((x) => x.id === id); return p && (!p.eliminated || (s.round && p.outRound === s.round.n)); });
}

function seatLayout(s, size) {
  const o = aliveOrder(s);
  const me = ME();
  const start = o.includes(me) ? o.indexOf(me) : Math.max(0, o.indexOf(s.firstDealer));
  const ids = o.slice(start).concat(o.slice(0, start));
  const n = ids.length;
  // un ovale "squadrato" (superellisse): sopra e sotto c'è più spazio per i riquadri
  const rx = size === 's' ? 37 : size === 'm' ? 35 : 33, ry = 42, pw = n > 9 ? 3.2 : 2.6;
  const pt = (a) => { const c = Math.cos(a), sn = Math.sin(a); return [rx * Math.sign(c) * Math.abs(c) ** (2 / pw), ry * Math.sign(sn) * Math.abs(sn) ** (2 / pw)]; };
  const N = 720, pts = [], len = [0];
  for (let i = 0; i <= N; i++) pts.push(pt(Math.PI / 2 - (i * 2 * Math.PI) / N)); // dal basso, verso destra e su
  for (let i = 1; i <= N; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], (pts[i][1] - pts[i - 1][1]) * 1.25));
  const total = len[N];
  let j = 0;
  return ids.map((id, k) => {
    const target = (k * total) / n;
    while (j < N && len[j + 1] < target) j++;
    const [x, y] = pts[j];
    return { id, x: 50 + x, y: 50 + y };
  });
}

function seatHTML(p, pos, s, r, live, actor, extra = '') {
  const me = ME();
  const inRound = r.seats.includes(p.id) && !p.eliminated;
  const turn = live && !ui.showLast && actor === p.id;
  const call = r.calls[p.id];
  const left = r.cards - (r.trickNo - 1);
  let cls = '';
  if (s.phase !== 'calling' && call != null) {
    if (r.won[p.id] > call || r.won[p.id] + left < call) cls = 'bad';
    else if (r.won[p.id] === call) cls = 'ok';
  }
  const hand = r.hands[p.id] || [];
  const n = inRound ? hand.length : 0;
  // turno da 1 carta: la carta degli altri si vede (la tua no)
  const face = null; // nel turno da 1 carta le carte stanno già sul tavolo
  const back = !inRound ? '' : face != null
    ? `<span class="sback face">${img(face, 'xs')}</span>`
    : `<span class="sback"><img src="icons/back.webp" alt=""><i>${n}</i></span>`;
  const net = remote() && !p.cpu ? `<span class="ondot ${R.online.has(p.id) ? 'on' : 'off'}"></span>` : '';
  const t = turn ? timerFor(p.id) : null;
  const acted = ui.acted && ui.acted.pid === p.id && Date.now() - ui.acted.at < 1200 && !turn;
  return `<div class="seat ${turn ? 'turn' : ''} ${acted ? 'acted' : ''} ${p.eliminated ? 'out' : ''} ${p.id === me ? 'me' : ''}" data-act="chip" data-pid="${p.id}" style="left:${pos.x}%;top:${pos.y}%;--pc:${colorOf(p.id)}">
    <div class="sbox"><div class="sn">${avatarHTML(p, 'sav')}<b>${esc(p.id === me ? 'Tu' : p.name)}</b>${net}</div>
      <div class="sl"><span class="lv">♥${p.lives}</span>${p.eliminated ? '<span class="muted">fuori</span>' : `<span>Ch <b>${call ?? '·'}</b></span><span class="${cls}">Pr <b>${s.phase === 'calling' ? '–' : r.won[p.id]}</b></span>`}</div>
      ${back}
    </div>
    ${r.dealerId === p.id ? '<span class="smz">MAZZIERE</span>' : ''}
    ${t ? `<span class="stimer ${t.hurry ? 'hurry' : ''}">${t.text}</span>` : ''}
    ${extra}
  </div>`;
}

function tableViewHTML(s, r, { live, actor, me }) {
  const n = aliveOrder(s).length;
  const size = n <= 6 ? 'l' : n <= 9 ? 'm' : 's';
  const lay = seatLayout(s, size);
  const pos = Object.fromEntries(lay.map((q) => [q.id, q]));
  const last = ui.showLast && r.lastTrick;
  const one = oneCardTable(s, r);
  const plays = one || (last ? r.lastTrick.plays : s.phase === 'playing' ? r.trick.plays : []);
  let best = null;
  if (!one) for (const p of plays) if (strength(p.card, p.jolly) >= 0 && (!best || strength(p.card, p.jolly) > strength(best.card, best.jolly))) best = p;
  // La carta giocata sta accanto a chi l'ha tirata, dal lato verso il centro del tavolo,
  // e passa sotto i riquadri dei giocatori. Se due carte si toccano sta sopra la più forte.
  const side = (q) => {
    const dx = 50 - q.x, dy = (50 - q.y) * 1.25;
    if (Math.abs(dx) > Math.abs(dy) * 0.9) return dx > 0 ? 'r' : 'l';
    return dy > 0 ? 'd' : 'u';
  };
  const fixed = TABLE_POS[n];
  const place = (id) => {
    // posizioni decise a mano per i tavoli da 7 a 13 (posto 1 = in basso)
    if (fixed) { const k = lay.findIndex((q) => q.id === id); const p = fixed[k]; if (p) return `left:${p[0]}%;top:${p[1]}%`; }
    const q = pos[id], sd = side(q);
    const h = 'calc(var(--sw) / 2 + 7px + var(--cw) / 2)';
    const v = `calc(var(--sh) / 2 + 7px + var(--cw) * 1.05${sd === 'd' && r.dealerId === id ? ' + 16px' : ''})`;
    const dx = sd === 'r' ? h : sd === 'l' ? `calc(-1 * ${h})` : '0px';
    const dy = sd === 'd' ? v : sd === 'u' ? `calc(-1 * ${v})` : '0px';
    return `left:calc(${q.x}% + ${dx});top:calc(${q.y}% + ${dy})`;
  };
  const byStrength = plays.slice().sort((a, b) => (strength(a.card, a.jolly) ?? -1) - (strength(b.card, b.jolly) ?? -1));
  const cardsHTML = plays.map((p, i) => {
    const win = p === best;
    return `<div class="tcard ${win ? 'best' : ''} ${win && last && r.cards === 1 ? 'onewin' : ''}" style="${place(p.pid)};--pc:${colorOf(p.pid)};z-index:${8 + byStrength.indexOf(p)}">${img(p.card)}${p.card === JOLLY ? `<span class="tj">${p.jolly === 'high' ? 'alta' : p.jolly === 'low' ? 'bassa' : '…'}</span>` : ''}${win ? `<span class="tk">${last ? 'ha preso' : 'prende'}</span>` : one ? '' : `<span class="tn">${i + 1}°</span>`}</div>`;
  }).join('');
  // chi deve ancora tirare: segnaposto tratteggiato (con tanti giocatori solo per chi tocca)
  let slots = '';
  if (s.phase === 'playing' && !last) {
    const done = new Set(plays.map((p) => p.pid));
    slots = r.seats.filter((id) => !done.has(id) && (id === actor || n <= 9)).map((id) => `<div class="tslot ${id === actor ? 'now' : ''}" style="${place(id)};--pc:${colorOf(id)}"></div>`).join('');
  }
  const extra = {};
  let center;
  if (s.phase === 'calling' && !last) {
    const missing = r.seats.filter((id) => r.calls[id] == null).length;
    const sum = Object.values(r.calls).reduce((a, b) => a + b, 0);
    const myTurn = r.turnId === me;
    const after = myTurn ? missing - 1 : missing;
    const line2 = myTurn ? (after ? `Dopo di te chiamano ancora <b>${after}</b>` : 'Sei l\'ultimo a chiamare') : `Ancora <b>${missing}</b> ${missing === 1 ? 'deve' : 'devono'} chiamare`;
    center = `<div class="tcenter"><span class="tpill">Chiamate finora: <b>${sum}</b> su ${r.cards}</span><span class="tsub">${line2}</span></div>`;
  } else if (last) center = `<div class="tcenter"><span class="tpill">Prende <b>${esc(nameOf(r.lastTrick.winner))}</b></span></div>`;
  else center = `<div class="tcenter"><span class="tpill">Sul tavolo · <b>${plays.length}</b> di ${r.seats.length}</span><span class="tsub">Mano ${Math.min(r.trickNo, r.cards)} di ${r.cards}</span></div>`;
  const seats = lay.map((q) => { const p = player(q.id); return p ? seatHTML(p, q, s, r, live, actor, extra[q.id] || '') : ''; }).join('');
  // se qualcuno siede a metà altezza (4, 8, 12 giocatori) la scritta centrale sale un po'
  const midSeat = lay.some((q) => Math.abs(q.y - 50) < 8);
  return `<div class="tview size-${size} ${midSeat ? 'cup' : ''}"><div class="felt"></div>${center}${slots}${cardsHTML}${seats}</div>`;
}

// Barra compatta con le informazioni per decidere; si apre per vedere chi è chi.
function stratHTML(s, r) {
  const q = queueData(s, r);
  if (!q) return '';
  const open = ui.stratOpen && q.items.length;
  return `<div class="strat ${open ? 'open' : ''}">
    <button class="sh" data-act="strat" aria-expanded="${!!open}" ${q.items.length ? '' : 'disabled'}>${(q.parts || [q.short]).map((x) => `<span>${x}</span>`).join('<i></i>')}${q.items.length ? `<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>` : ''}</button>
    ${open ? `<div class="qrow hscroll">${q.items.join('')}</div>` : ''}
  </div>`;
}

function bonusText(s) {
  if (!s.bonusZeroUsed) return 'Vita bonus a 0: <b>ancora libera</b>';
  const ids = [];
  for (const h of s.history) for (const [id, x] of Object.entries(h.results)) if (x.zeroBonus) ids.push(id);
  return `Vita bonus a 0: <b>già presa</b>${ids.length ? ` da ${ids.map((id) => (id === ME() ? 'te' : esc(nameOf(id)))).join(' e ')}` : ''}`;
}

// ---- tasti rapidi PARCHEGGIO e PRESA (logica in lib/quick.js)
const quickPicks = (r) => Q.quickPicks(r, ME());

// Icone disegnate per i semi e le figure, nello stile dell'app (tratto pieno, un solo colore).
const SUIT_SVG = [
  // bastoni: bastone nodoso
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.2 19.2 17.4 6.2" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/><circle cx="9.1" cy="15.8" r="2.2"/><circle cx="12.5" cy="11.9" r="2.2"/><circle cx="18" cy="5.4" r="2.7"/></svg>',
  // spade: spada
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 4.5 9.6 14.4" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M19.5 4.5l-1.2 3.4-2.2-2.2z"/><path d="M6.6 11.4l6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M9.6 14.4 6.4 17.6" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/><circle cx="5.4" cy="18.6" r="1.7"/></svg>',
  // coppe: coppa
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 4h13v2.2a6.5 6.5 0 0 1-13 0z"/><rect x="10.8" y="12" width="2.4" height="5" rx="1"/><path d="M7.5 21h9l-1.6-3.6H9.1z"/></svg>',
  // denari: sole
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.4"/><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></g></svg>',
];
const FIG_SVG = {
  // fante: berretto con piuma
  8: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 16.5c3-1.6 15-1.6 18 0-3 1.8-15 1.8-18 0z"/><path d="M6 15.4c0-4.6 2.7-7.4 6-7.4s6 2.8 6 7.4z"/><path d="M15.2 8.6c1.8-2.8 4.2-4.6 6.3-5-.4 2.6-2.4 5-4.8 6.4z"/></svg>',
  // cavallo: testa di cavallo
  9: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 21c-.4-3.4.4-6 2.2-8.1-1.7.1-3.4 1.1-4.6 2.1L4 12.8c1-2.6 3.1-4.7 5.3-5.9L9 3.5l2.4 2.2c4.6-.5 8.5 2.9 8.6 8.2V21z"/><circle cx="12.2" cy="9.4" r="1" fill="var(--bg, #000)"/></svg>',
  // re: corona
  10: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 17.5 4.6 7.4l4.3 4.2L12 5l3.1 6.6 4.3-4.2 1.1 10.1z"/><rect x="3.5" y="18.6" width="17" height="2.6" rx="1"/></svg>',
};

// La carta in forma compatta: numero (o figura) + seme.
function miniCard(p) {
  const c = p.card, suit = Math.floor(c / 10), v = (c % 10) + 1;
  const rank = v >= 8 ? `<span class="qi-fig">${FIG_SVG[v]}</span>` : `<b>${v === 1 ? 'A' : v}</b>`;
  return `${rank}<span class="qi-suit">${SUIT_SVG[suit]}</span>${p.jolly === 'low' ? '<em>basso</em>' : ''}`;
}

const ARROW = {
  park: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v13M6.5 12.5 12 18l5.5-5.5"/></svg>',
  take: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V6M6.5 11.5 12 6l5.5 5.5"/></svg>',
};

// Due pulsanti rotondi accanto alla mano. Attivi solo quando tocca a te.
function quickHTML(r, myTurn) {
  const q = myTurn ? quickPicks(r) : null;
  const btn = (k, label) => {
    const p = q?.[k];
    if (!p || p.none) {
      const why = p?.none || (myTurn ? '' : label);
      return `<div class="qwrap"><button class="qbtn ${k} off ${p?.warn ? 'warn' : ''}" disabled aria-label="${label}: ${esc(why)}"><span class="qarrow">${ARROW[k]}</span><span class="qdash">–</span></button><span class="qlbl ${p?.warn ? 'warn' : ''}">${esc(why || label)}</span></div>`;
    }
    const name = p.card === JOLLY ? `Asso di denari ${p.jolly === 'low' ? 'basso' : 'alto'}` : cardName(p.card);
    return `<div class="qwrap"><button class="qbtn ${k} ${k === 'take' && p.sure === false ? 'maybe' : ''}" data-act="quick" data-k="${k}" aria-label="${label}: ${esc(name)}"><span class="qarrow">${ARROW[k]}</span><span class="qcard">${miniCard(p)}</span></button><span class="qlbl">${label}${k === 'take' && p.sure === false ? ' ?' : ''}</span></div>`;
  };
  return `<div class="quickcol">${btn('take', 'Presa')}${btn('park', 'Parcheggio')}</div>`;
}

// ---- chi guarda (spettatori ed eliminati): può chiedere a un giocatore di vedere le sue carte
const nowSrv = () => Date.now() + (R?.offset || 0);
const peekOf = (id) => R?.s?.peek?.[id] || null;
const isPending = (pk) => pk?.status === 'pending' && nowSrv() - pk.at < E.PEEK_TTL;
const watchers = () => (R?.s ? [...R.s.spectators, ...R.s.players.filter((p) => p.eliminated && !p.cpu)] : []);
const watcherKind = (id) => (R?.s?.spectators.some((x) => x.id === id) ? 'spettatore' : 'eliminato');

function watcherPanelHTML(s, r, live, isSpect) {
  const pk = peekOf(R.me);
  const t = pk?.target && player(pk.target);
  let body;
  if (pk?.status === 'ok' && t && !t.eliminated) {
    const h = r?.hands?.[t.id] || [];
    const visible = h.length && h.every((c) => c >= 0);
    body = `<div class="wpt">Le carte di ${who(t.id)}</div>${visible
      ? `<div class="peekhand">${h.map((c) => img(c, 'sm')).join('')}</div>`
      : `<p class="hint">${live && r?.cards === 1 ? 'Turno da 1 carta: chi guarda non vede le mani. Scopri tutto a fine turno.' : 'Nessuna carta in mano in questo momento.'}</p>`}`;
  } else if (isPending(pk) && t) {
    body = `<p class="hint">Hai chiesto a <b>${esc(t.name)}</b> di vedere le sue carte: aspetta la risposta…</p>`;
  } else {
    body = `<button class="btn small light" data-act="peek-choose">Chiedi di vedere le carte di un giocatore</button>
      <p class="hint">Vedi solo le carte giocate. Un giocatore può darti il permesso di vedere le sue, e le vedrai fino alla fine della partita.</p>`;
  }
  return `<div class="watchpanel"><div class="wph">${isSpect ? 'Stai guardando la partita' : 'Sei fuori dal gioco: ora guardi'}</div>${body}</div>`;
}

function peekChooseHTML() {
  const s = R?.s;
  if (!s) return '';
  const declined = peekOf(R.me)?.declined || [];
  const list = s.players.filter((p) => !p.cpu && !p.eliminated && p.id !== R.me);
  return `<h2>Di chi vuoi vedere le carte?</h2>
    <p class="muted">Gli arriva una richiesta: se dice sì, vedrai solo le sue carte fino alla fine della partita.</p>
    <div class="plist2">${list.map((p) => {
      const no = declined.includes(p.id);
      return `<button class="prow" data-act="peek-ask" data-pid="${p.id}" ${no ? 'disabled' : ''}>${avatarHTML(p, 'md')}<b>${esc(p.name)}</b><span class="muted">${no ? 'ha detto di no' : ''}</span></button>`;
    }).join('') || '<p class="hint">Nessun giocatore a cui chiedere.</p>'}</div>`;
}

function eyeHTML() {
  const w = watchers().filter((x) => !player(x.id)?.eliminated || true);
  return `<h2>Chi sta guardando</h2>${w.length ? `<div class="plist2">${w.map((x) => {
    const pk = peekOf(x.id);
    const t = pk?.status === 'ok' && player(pk.target);
    return `<div class="prow">${avatarHTML(x, 'md')}<b>${esc(x.name)}</b><span class="muted">${watcherKind(x.id)}${t ? ` · vede le carte di ${esc(t.id === R.me ? 'te' : t.name)}` : ''}</span></div>`;
  }).join('')}</div>` : '<p class="muted">Nessuno sta guardando.</p>'}`;
}

const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
function eyeBtnHTML() {
  if (!remote() || !R?.s) return '';
  const n = R.s.spectators.length;
  if (!n) return '';
  return `<button class="eyebtn" data-act="eye" aria-label="${n} ${n === 1 ? 'spettatore' : 'spettatori'}">${EYE}<b>${n}</b></button>`;
}

// le richieste scadute spariscono da sole
setInterval(() => {
  if (!remote() || !R?.s?.peek) return;
  if (Object.values(R.s.peek).some((pk) => pk.status === 'pending' && nowSrv() - pk.at >= E.PEEK_TTL && nowSrv() - pk.at < E.PEEK_TTL + 1500)) render();
}, 1000);

// avvisi per l'host quando qualcuno è offline
function bannersHTML(s, r, live) {
  if (!remote()) return '';
  const out = [];
  const now = Date.now() + R.offset;
  const host = s.hostId === R.me;
  const hp = player(s.hostId);
  if (!host && player(R.me) && !player(R.me).eliminated && hp && !R.online.has(hp.id)) {
    const due = (R.offline[hp.id] || 0) + R.hostTakeoverAfter;
    if (now >= due) out.push(`<div class="banner"><div class="grow">L'host <b>${esc(hp.name)}</b> è offline.</div><button class="btn small" data-act="claim">Diventa host</button></div>`);
  }
  for (const [viewer, pk] of Object.entries(s.peek || {})) {
    if (pk.target !== R.me || !isPending(pk)) continue;
    const v = R.s.spectators.find((x) => x.id === viewer) || player(viewer);
    out.push(`<div class="banner peekreq"><div class="grow"><b>${esc(v?.name || '?')}</b> (${watcherKind(viewer)}) chiede di vedere le tue carte fino alla fine della partita</div><button class="btn small" data-act="peek-ans" data-v="1" data-viewer="${viewer}">Sì</button><button class="btn small ghost" data-act="peek-ans" data-v="0" data-viewer="${viewer}">No</button></div>`);
  }
  if (player(R.me)?.kickPending) out.push(`<div class="banner"><div class="grow">L'host ti farà uscire dal prossimo turno.</div></div>`);
  return out.join('');
}

function renderGame() {
  const s = S();
  const r = s.round;
  const me = ME();
  const live = s.phase === 'calling' || s.phase === 'playing';
  const ending = s.phase === 'roundEnd' && !ui.showLast;
  const actor = r.pendingJolly || r.turnId;
  const myTurn = live && !ui.showLast && actor === me;
  const players = tableOrder().map(player).filter((p) => p && (!p.eliminated || p.outRound === r.n));
  const sum = Object.values(r.calls).reduce((a, b) => a + b, 0);
  const levelTag = remote() ? `stanza ${esc(s.code)}` : G.level;
  const sub = s.phase === 'calling' ? 'Giro delle chiamate' : ending ? 'Fine turno' : `Mano ${Math.min(r.trickNo, r.cards)} di ${r.cards}${s.phase === 'playing' && !ui.showLast ? ` · sul tavolo ${r.trick.plays.length}/${r.seats.length}` : ''}`;
  const opener = s.phase === 'calling' ? r.seats[0] : ui.showLast && r.lastTrick ? r.lastTrick.plays[0].pid : r.trick.leader;
  const roles = '';

  let status = '', mine = false;
  if (ui.showLast && r.lastTrick) { status = r.lastTrick.winner === me ? 'Prendi tu' : `Prende ${esc(nameOf(r.lastTrick.winner))}`; mine = r.lastTrick.winner === me; }
  else if (s.phase === 'calling') { status = myTurn ? 'Tocca a te: quante mani prendi?' : `${esc(nameOf(actor))} sta chiamando<span class="dots"></span>`; mine = myTurn; }
  else if (s.phase === 'playing') {
    if (r.pendingJolly) status = myTurn ? "Hai girato l'asso di denari: quanto vale?" : `${esc(nameOf(actor))} sceglie il valore dell'asso<span class="dots"></span>`;
    else status = myTurn ? 'Tocca a te: tira una carta' : `Tocca a ${esc(nameOf(actor))}<span class="dots"></span>`;
    mine = myTurn;
  } else if (ending) status = 'Turno finito';
  const myTimer = myTurn ? timerFor(me) : null;
  if (myTimer) status += ` <span class="hurry">· <span data-timer="${me}" data-short="1">${myTimer.left}s</span></span>`;

  let hand = '', actions = '';
  const inRound = r.seats.includes(me) && !meOut();
  if (!ending) {
    if (inRound && (live || ui.showLast)) {
      const h = r.hands[me] || [];
      if (r.cards === 1) hand = `<p class="hint onehint">${h.length ? 'La tua carta è coperta sul tavolo: si scopre insieme alle altre quando finiscono le chiamate.' : ''}</p>`;
      else {
        const active = myTurn && s.phase === 'playing' && !r.pendingJolly && !locked();
        const cardsHTML = `<div class="hand ${active ? 'active' : 'dim'}" style="--n:${Math.max(h.length, 3)}" role="group" aria-label="Le tue carte">${h.map((c) => (active
          ? `<button class="card-btn" data-act="sel" data-c="${c}" aria-label="Gioca ${cardName(c)}" aria-pressed="${ui.sel === c}">${img(c, ui.sel === c ? 'sel' : '')}</button>`
          : img(c))).join('')}</div>`;
        const showQuick = s.phase === 'playing' || ui.showLast;
        hand = showQuick ? `<div class="handrow">${cardsHTML}${quickHTML(r, active)}</div>` : cardsHTML;
      }
    } else if (meOut()) {
      const isSpect = !player(me);
      hand = remote()
        ? watcherPanelHTML(s, r, live, isSpect)
        : `<div class="banner"><div class="grow">Sei fuori dal gioco: la CPU finisce la partita.</div><button class="btn small" data-act="ff">Vai al risultato</button></div>`;
    }
    if (myTurn && s.phase === 'calling') {
      const forb = E.forbiddenCall(s);
      const dealer = r.dealerId === me;
      actions = `<div class="calls">${Array.from({ length: r.cards + 1 }, (_, n) => `<button data-act="call" data-n="${n}" ${n === forb && dealer ? 'disabled' : ''}>${n}</button>`).join('')}</div>
        <p class="hint">${dealer ? (forb != null ? `Sei il mazziere: non puoi chiamare ${forb}, la somma farebbe ${r.cards}.` : 'Sei il mazziere: puoi chiamare quello che vuoi.') : ''}</p>`;
    } else if (myTurn && r.pendingJolly) {
      actions = `<div class="row2"><button class="btn" data-act="jolly" data-v="high">Più alta di tutte</button><button class="btn light" data-act="jolly" data-v="low">Più bassa di tutte</button></div>`;
    } else if (myTurn && s.phase === 'playing') {
      if (r.cards === 1) actions = '';
      else if (ui.sel == null) actions = `<p class="hint">${settings.confirmPlay || (G?.tut && !isL0()) ? 'Tocca una carta, poi conferma' : 'Tocca una carta per giocarla'}</p>`;
      else if (ui.sel === JOLLY) actions = `<p class="hint">Asso di denari: decidi quanto vale</p><div class="row2"><button class="btn" data-act="play" data-v="high">Più alta di tutte</button><button class="btn light" data-act="play" data-v="low">Più bassa di tutte</button></div>`;
      else actions = `<button class="btn" data-act="play">Gioca ${cardName(ui.sel)}</button>`;
    }
  } else actions = G?.tut && G.tut.kind !== 'maestro' ? roundEndHTML(s, r).replace(/<button[^>]*data-act="next"[\s\S]*?<\/button>/, '') : roundEndHTML(s, r);
  if (G?.tut?.kind === 'sc' && G.tut.phase === 'eval') actions = '';
  if (isL0() && ui.coach?.gate) {
    // nelle lezioni si vede subito cosa toccare
    if (s.phase === 'playing' && myTurn && ui.sel == null) actions = '';
  }

  const topbar = `
    <div class="topbar">
      <div class="t"><b>Turno ${r.n} · ${carte(r.cards)}</b><span>${esc(sub)} · ${levelTag}</span></div>
      ${eyeBtnHTML()}
      <button class="iconbtn" data-act="scores" aria-label="Punteggi"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V10M12 20V4M19 20v-7"/></svg></button>
      <button class="iconbtn" data-act="menu" aria-label="Menu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
    </div>
    ${bannersHTML(s, r, live)}`;

  // vista tavolo: stessi dati, solo un'altra disposizione
  $app.classList.toggle('in-tut', !!G?.tut && !remote());
  $app.classList.toggle('v-classic', viewMode() !== 'table');
  $app.classList.toggle('v-table', viewMode() === 'table');
  if (viewMode() === 'table') {
    $app.innerHTML = `${topbar}${introHTML()}
      <div class="infobar"><span>${bonusText(s)}</span><span class="ibsep"></span><span>Chiamate <b>${sum}</b> su ${carte(r.cards).replace('carte', 'mani').replace('carta', 'mano')}</span></div>
      ${ending ? '' : tableViewHTML(s, r, { live, actor, me })}
      ${ending ? '' : stratHTML(s, r)}
      ${G?.tut ? coachHTML(status) : ending ? '' : `<div class="status small ${mine ? 'mine' : ''}" aria-live="polite">${status}</div>`}
      ${hand}
      <div class="actions">${actions}</div>`;
    ui.lastTurn = live && !ui.showLast ? actor : null;
    focusCoach();
    return;
  }

  $app.innerHTML = `${topbar}${introHTML()}
    ${roles}
    <div class="infobar"><span>${bonusText(s)}</span>${s.phase === 'calling' ? '' : `<span class="ibsep"></span><span>Chiamate <b>${sum}</b> su ${carte(r.cards).replace('carte', 'mani').replace('carta', 'mano')}</span>`}</div>
    <div class="players hscroll" id="players">${players.map((p) => chipHTML(p, s, r, live)).join('<span class="arrow" aria-hidden="true">›</span>')}</div>
    ${ending ? '' : tableHTML(s, r)}
    ${ending ? '' : stratHTML(s, r)}
    ${G?.tut ? coachHTML(status) : `<div class="status ${mine ? 'mine' : ''}" aria-live="polite">${status}</div>`}
    ${hand}
    <div class="actions">${actions}</div>`;

  const pl = document.getElementById('players');
  const turnId = live && !ui.showLast ? actor : null;
  if (pl && turnId && turnId !== ui.lastTurn && !ui.sheet) {
    const el = pl.querySelector(`[data-pid="${turnId}"]`);
    if (el) {
      // si sposta solo quando il giocatore di turno esce dallo schermo, e lo mette a sinistra
      // così si vedono quelli che vengono dopo
      const l = el.offsetLeft - pl.scrollLeft, rgt = l + el.clientWidth;
      if (l < 8 || rgt > pl.clientWidth - 8) pl.scrollTo({ left: Math.max(0, el.offsetLeft - 40), behavior: ui.lastTurn ? 'smooth' : 'auto' });
    }
  }
  ui.lastTurn = turnId;
  focusCoach();
  const ps = document.getElementById('playedScroll');
  if (ps) ps.scrollLeft = ps.scrollWidth;
}

function saveLine() {
  if (remote() || G?.tut) return '';
  const t = {
    ok: '<span style="color:var(--green)">✓</span> Partita salvata: la CPU impara da questo turno.',
    saving: 'Salvataggio…',
    fail: '<span style="color:var(--red)">Non salvata</span>: errore di collegamento, riprovo al prossimo turno.',
    off: '<span style="color:var(--red)">Non salvata</span>: qui la pagina non ha accesso all\'archivio.',
  }[ui.saved];
  return t ? `<p class="hint">${t}</p>` : '';
}

function roundEndHTML(s, r) {
  const me = ME();
  const rows = r.seats.map((id) => {
    const x = r.results[id];
    const notes = [];
    if (x.bonus3) notes.push('+1 vita: chiamata da 3 centrata');
    if (x.zeroBonus) notes.push('Primo a zero: vita bonus');
    if (x.eliminated) notes.push('Eliminato');
    const pill = x.lost === 0 ? '<span class="pill ok">preciso</span>' : `<span class="pill bad">−${x.lost} ${x.lost === 1 ? 'vita' : 'vite'}</span>`;
    return `<div class="res ${notes.length ? 'hl' : ''}"><div class="who"><b>${dot(id)}${esc(player(id).name)}${id === me ? ' (tu)' : ''}</b><span>chiama ${x.call} · prese ${x.won}</span>${notes.map((n) => `<em>${n}</em>`).join('')}</div>${pill}<span class="lv">♥${x.after}</span></div>`;
  }).join('');
  const alive = E.alivePlayers(s);
  const nextCards = Math.min(E.nextCardsCount(s), E.maxCardsFor(alive.length));
  const nextDealer = E.nextAlive(s, r.dealerId);
  let button;
  if (remote()) {
    const humans = s.players.filter((p) => !p.cpu && !p.eliminated);
    const readyN = humans.filter((p) => s.ready.includes(p.id)).length;
    const iReady = s.ready.includes(me);
    const canReady = player(me) && !player(me).eliminated;
    button = `${canReady ? `<button class="btn" data-act="next" ${iReady ? 'disabled' : ''}>${iReady ? 'Pronto ✓' : 'Pronto'} · ${readyN} su ${humans.length}</button>` : ''}
      ${s.hostId === me ? '<button class="btn ghost" data-act="force">Avvia subito il prossimo turno</button>' : ''}
      <p class="hint">Si parte quando tutti i giocatori collegati sono pronti.</p>`;
  } else button = `<button class="btn" data-act="next">${meOut() ? 'Continua' : 'Prossimo turno'}</button>${saveLine()}`;
  return `<div class="results">${rows}</div>
    <div class="inforow" style="padding:2px 4px"><span>Prossimo turno</span><span><b>${carte(nextCards)}</b> · mazziere <b>${who(nextDealer)}</b></span></div>
    ${button}`;
}

function renderFinished() {
  const s = S();
  const me = ME();
  const w = s.winners || [];
  const iWon = w.includes(me);
  const title = iWon ? (w.length > 1 ? 'Pareggio!' : 'Hai vinto!') : w.length > 1 ? 'Pareggio' : `Ha vinto ${esc(player(w[0])?.name)}`;
  const standing = s.players.slice().sort((a, b) => {
    if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
    if (a.eliminated) return (b.outRound || 0) - (a.outRound || 0);
    return b.lives - a.lives;
  });
  const buttons = remote()
    ? `<button class="btn" data-act="to-lobby">Inizia una nuova partita, torna in lobby</button>
       <button class="btn ghost" data-act="leave-room">Esci dalla stanza, torna al menù principale</button>`
    : `<button class="btn" data-act="again">Rivincita, stesse impostazioni</button>
       <button class="btn ghost" data-act="home">Torna al menù principale</button>`;
  $app.innerHTML = `
    <div class="winner">
      <p class="eyebrow">Fine partita · ${s.roundNo} turni</p>
      <h1>${title}</h1>
      ${w.length > 1 ? `<p class="muted">${w.map((id) => esc(player(id).name)).join(' e ')}</p>` : ''}
    </div>
    <div class="panel"><table class="sc"><tr><th>#</th><th>Giocatore</th><th>Vite</th><th>Uscito</th></tr>
      ${standing.map((p, i) => `<tr><td>${i + 1}</td><td><b>${esc(p.name)}</b>${p.id === me ? ' (tu)' : ''}</td><td style="color:var(--red);font-weight:800">♥${p.lives}</td><td class="muted">${p.eliminated ? `turno ${p.outRound}` : '—'}</td></tr>`).join('')}
    </table></div>
    ${saveLine()}
    ${buttons}
    <button class="btn ghost" data-act="scores">Tutti i turni</button>`;
}

// ================================================================ FOGLI E POPUP

function openSheet(kind, data = null) { ui.sheet = kind; ui.sheetData = data; ui.confirmQuit = false; ui.popErr = ''; ui.popStarted = false; drawSheet(); }
function closeSheet() { ui.sheet = null; $sheet.hidden = true; $sheet.innerHTML = ''; }

function drawSheet() {
  let html = '';
  const k = ui.sheet;
  const err = ui.popErr ? `<p class="perr" role="alert">${esc(ui.popErr)}</p>` : '';
  if (k === 'rules') html = rulesHTML();
  else if (k === 'how') html = howHTML();
  else if (k === 'install') html = installHTML();
  else if (k === 'peek') html = peekChooseHTML();
  else if (k === 'eye') html = eyeHTML();
  else if (k === 'viewpick') html = viewPickHTML();
  else if (k === 'scores') html = scoresHTML();
  else if (k === 'avatar') html = avatarSheetHTML();
  else if (k === 'avname') html = avatarNameHTML(err);
  else if (k === 'create') html = `<h2>Crea una stanza</h2>
    ${entryRow(ui.sheetData?.name ?? settings.name)}
    ${err}<button class="btn" data-act="create">Crea la stanza</button>`;
  else if (k === 'join') {
    const d = ui.sheetData || {};
    html = `<h2>Accedi a una stanza</h2>
    ${entryRow(d.name ?? settings.name)}
    <label class="label" for="pcode">Codice di invito</label>
    <input id="pcode" class="field code" maxlength="6" autocomplete="off" autocapitalize="characters" value="${esc(d.code || '')}" placeholder="CODICE">
    ${err}<button class="btn" data-act="join" ${ui.popStarted ? 'disabled' : ''}>Entra come giocatore</button>
    <button class="btn ghost" data-act="join-watch">Guarda come spettatore</button>
    <p class="hint">${ui.popStarted ? 'La partita è già iniziata: puoi guardarla.' : 'Lo spettatore vede la partita senza giocare e senza occupare un posto.'}</p>`;
  } else if (k === 'rename') html = `<h2>Cambia nome</h2>
    <label class="label" for="pname">Nuovo nome</label>
    <input id="pname" class="field" maxlength="22" value="${esc(player(R?.me)?.name || '')}">
    ${err}<button class="btn" data-act="rename">Salva</button>`;
  else if (k === 'addcpu') {
    const d = ui.sheetData || (ui.sheetData = { n: 1, level: 'medio' });
    const room = 13 - (R?.s?.players.length || 0);
    d.n = Math.max(1, Math.min(room, d.n));
    html = `<h2>Aggiungi CPU</h2>
    <div class="label">Quante</div>
    <div class="stepper">
      <button data-act="cpu-n" data-d="-1" aria-label="Meno" ${d.n <= 1 ? 'disabled' : ''}>−</button>
      <div class="val"><b>${d.n} CPU</b><span>posti liberi ${room}</span></div>
      <button data-act="cpu-n" data-d="1" aria-label="Più" ${d.n >= room ? 'disabled' : ''}>+</button>
    </div>
    <div class="label">Difficoltà</div>
    <div class="seg" role="group" aria-label="Difficoltà">${LEVELS.map((l) => `<button data-act="cpu-lv" data-l="${l}" aria-pressed="${d.level === l}">${cap(l)}</button>`).join('')}</div>
    <p class="hint">${LEVEL_HINT[d.level]} Potrai cambiare il livello di ognuna dall'elenco.</p>
    <button class="btn" data-act="add-cpu">Aggiungi</button>`;
  } else if (k === 'player') {
    const s = R?.s;
    const p = s && player(ui.sheetData);
    if (!p || s.hostId !== R.me || p.id === R.me || p.eliminated) return closeSheet();
    html = `<h2>${esc(p.name)}</h2><p class="muted">${p.cpu ? 'CPU' : R.online.has(p.id) ? 'Collegato' : 'Offline'} · ♥ ${p.lives}</p>
      ${p.kickPending ? `<button class="btn ghost" data-act="unkick" data-pid="${p.id}">Annulla l'espulsione</button>` : `<button class="btn" data-act="kick" data-pid="${p.id}" style="background:var(--red);color:#1A0606">Espelli dal prossimo turno</button><p class="hint">Il turno in corso si finisce, poi esce dalla partita.</p>`}`;
  } else if (k === 'menu') {
    html = `<h2>Menu</h2><button class="btn ghost" data-act="rules">Regole</button>
      <div class="label">Vista del tavolo</div>${viewSegHTML()}
      ${remote() ? `<button class="optrow" data-act="view-ask" role="switch" aria-checked="${!settings.viewAlways}"><span><b>Chiedi la vista a ogni partita</b><span>Quando entri in una stanza scegli Tavolo o Classica</span></span><i class="sw ${settings.viewAlways ? '' : 'on'}"></i></button>` : ''}
      <button class="optrow" data-act="confirm-play" role="switch" aria-checked="${!!settings.confirmPlay}"><span><b>Chiedi conferma prima di giocare</b><span>Tocchi la carta, poi confermi</span></span><i class="sw ${settings.confirmPlay ? 'on' : ''}"></i></button>`;
    if (remote()) {
      html += `<button class="btn ghost" data-act="share">Invia l'invito alla stanza</button>
        <button class="btn ghost" data-act="home">Torna al menù principale</button>
        <p class="hint">Resti nella stanza: puoi rientrare da "Gioca con i tuoi amici".</p>`;
    } else {
      if (G?.tut) html += `<button class="btn ghost" data-act="tut-quit">Esci dalla lezione</button>`;
      else html += ui.confirmQuit
        ? `<p class="hint">Vuoi davvero abbandonare? La partita non si potrà riprendere.</p><div class="row2"><button class="btn ghost" data-act="close">No, resto</button><button class="btn" data-act="quit" style="background:var(--red);color:#1A0606">Abbandona</button></div>`
        : `<button class="btn ghost" data-act="quit">Abbandona la partita</button>`;
      html += `<button class="btn ghost" data-act="home">Torna al menù principale</button><p class="hint">Dal single player puoi riprendere la partita quando vuoi.</p>`;
    }
  }
  if (!html) return closeSheet();
  const backBtn = ui.avReturn && (k === 'avatar' || k === 'avname') ? '<button class="btn ghost" data-act="av-back">Indietro</button>' : '<button class="btn ghost" data-act="close">Chiudi</button>';
  $sheet.innerHTML = `<div class="box" role="dialog" aria-modal="true">${html}${backBtn}</div>`;
  $sheet.hidden = false;
  const first = $sheet.querySelector('input');
  if (first && !first.value) first.focus();
}

// Nome e avatar insieme, nella finestra per creare o entrare in una stanza.
function entryRow(name) {
  const me = { id: LOCAL_ME, name: name || settings.name || '?' };
  const missing = needAvatar();
  return `<div class="label">Il tuo nome e il tuo avatar</div>
    <div class="namerow"><button class="avbtn ${missing ? 'need' : ''}" data-act="entry-avatar" aria-label="Scegli il tuo avatar">${avatarHTML(me, 'lg')}</button>
    <input id="pname" class="field" maxlength="22" autocomplete="nickname" value="${esc(name || '')}" placeholder="Es. Thomas"></div>
    ${missing ? '<p class="hint" style="text-align:left">Tocca il cerchio per scegliere il tuo avatar.</p>' : ''}`;
}

function scoresHTML() {
  const s = S();
  if (!s) return '';
  const me = ME();
  const cur = s.players.slice().sort((a, b) => (a.eliminated - b.eliminated) || b.lives - a.lives);
  const hist = s.history.slice().reverse().map((h) => `
    <details><summary style="padding:8px 0;cursor:pointer;font-weight:700">Turno ${h.n} · ${carte(h.cards)} <span class="muted" style="font-weight:500">· mazziere ${esc(nameOf(h.dealerId))}</span></summary>
    <table class="sc"><tr><th>Giocatore</th><th>Chiama</th><th>Prese</th><th>Vite</th></tr>
    ${Object.entries(h.results).map(([id, x]) => `<tr><td>${esc(player(id)?.name || '?')}</td><td>${x.call}</td><td>${x.won}</td><td>♥${x.after}${x.eliminated ? ' · fuori' : ''}</td></tr>`).join('')}
    </table></details>`).join('');
  return `<h2>Punteggi</h2>
    <table class="sc"><tr><th>Giocatore</th><th>Vite</th></tr>
    ${cur.map((p) => `<tr><td><b>${esc(p.name)}</b>${p.id === me ? ' (tu)' : ''}</td><td>${p.eliminated ? '<span class="muted">fuori</span>' : `<span style="color:var(--red);font-weight:800">♥${p.lives}</span>`}</td></tr>`).join('')}</table>
    <p class="hint">${s.bonusZeroUsed ? 'La vita bonus è già stata data: chi arriva a 0 ora è fuori.' : 'Il primo che arriva a 0 riceve una vita bonus.'}</p>
    ${hist ? `<h3 style="font-size:16px">Turni giocati</h3>${hist}` : ''}`;
}

function howHTML() {
  return `<div class="rules"><h2>Come impara la CPU</h2>
    <h3>Come ragiona</h3>
    <ul><li>Vede solo quello che vedresti tu: le sue carte, le chiamate e le carte uscite.</li>
    <li>Per chiamare e per giocare immagina centinaia di modi in cui potrebbero essere distribuite le carte che non vede, e sceglie la mossa che più spesso le fa centrare la chiamata.</li>
    <li>Legge le chiamate: chi ha chiamato 1 probabilmente ha una carta forte, la chiamata forzata del mazziere conta meno.</li>
    <li>Ogni CPU ha un carattere: più prudente o più spavalda. La situazione la sposta: con una vita sola gioca sicura, da mazziere o con vite di scorta rischia di più.</li></ul>
    <h3>Cosa impara da voi</h3>
    <ul><li>Ogni chiamata e ogni carta che tirate vengono salvate, legate al vostro nome.</li>
    <li>Per ogni nome tiene un profilo: se chiami più alto o più basso della forza delle tue carte, e quanto stai basso nella prima mano.</li>
    <li>Quando chiami, usa il tuo profilo per capire che carte hai. Con poche partite si fida del buon senso, poi sempre di più dei dati.</li></ul></div>`;
}

function rulesHTML() {
  return `<div class="rules"><h2>Regole</h2>
    <p>Da 3 a 13 giocatori con le 40 carte trevigiane. Si parte con 3 vite: vince l'ultimo che resta.</p>
    <h3>Forza delle carte</h3>
    <ul><li>In ogni seme l'asso è la più bassa e il re la più alta.</li>
    <li>Dal seme più debole al più forte: bastoni, spade, coppe, denari.</li>
    <li>L'asso di denari è il jolly: chi lo gioca decide se vale più di tutte o meno di tutte.</li></ul>
    <h3>Turni</h3>
    <ul><li>Si parte con 5 carte a testa (4 da 9-10 giocatori, 3 da 11-13), poi 4, 3, 2, 1 e si ricomincia.</li></ul>
    <h3>Chiamate</h3>
    <ul><li>A partire da chi sta dopo il mazziere, ognuno dice quante mani prenderà.</li>
    <li>Il mazziere chiama per ultimo e la somma non può essere uguale al numero di carte.</li></ul>
    <h3>Gioco</h3>
    <ul><li>Si butta una carta qualsiasi; la più alta prende. Apre chi ha preso la mano prima.</li></ul>
    <h3>Vite</h3>
    <ul><li>Si perde una vita per ogni mano di differenza tra chiamate e prese. Non si scende sotto 0.</li>
    <li>Chi chiama 3 e ne prende 3 guadagna una vita.</li>
    <li>Il primo ad arrivare a 0 riceve una vita bonus; da lì in poi chi arriva a 0 è fuori.</li></ul>
    <h3>Turno da 1 carta</h3>
    <p>Vedi le carte di tutti tranne la tua.</p></div>`;
}

// ================================================================ EVENTI

function keepNick() {
  const v = document.getElementById('nick')?.value;
  if (v != null) settings.name = v.trim().slice(0, 22);
}

document.addEventListener('click', (e) => {
  if (e.target === $sheet) return closeSheet();
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'SELECT') return;
  const act = el.dataset.act;
  const pid = el.dataset.pid;
  const s = S();
  switch (act) {
    // navigazione
    case 'home': return goHome();
    case 'go-sp': return goSp();
    case 'go-mp':
      if (ONLINE === false) return toast('Il multiplayer funziona nella versione online di Bisca, pubblicata su Cloudflare.');
      return goMp();
    case 'rules': case 'how': case 'scores': case 'menu': return openSheet(act);
    case 'install': return openSheet('install');
    case 'go-learn': return goLearn();
    case 'lesson': return startLesson(Number(el.dataset.n));
    case 'learn-level': ui.learnLevel = Number(el.dataset.k); return render();
    case 'tut-retry': return startScenario(G.tut.lesson, G.tut.i, G.tut.variant, false);
    case 'tut-alt': return startScenario(G.tut.lesson, G.tut.i, !G.tut.variant, false);
    case 'tut-watch': return tutWatch();
    case 'tut-sc-next': return tutNextScenario();
    case 'tut-hint': return maestroHint();
    case 'tut-next': return tutNext();
    case 'tut-intro':
      ui.tutIntro += 1;
      if (ui.tutIntro >= tutIntroList().length) { ui.tutIntro = null; return step(); }
      return render();
    case 'tut-quit': clearTimeout(ui.timer); return goLearn();
    case 'tag-tap': {
      ui.tagTaps = (Date.now() - (ui.tagAt || 0) < 1500 ? (ui.tagTaps || 0) : 0) + 1; ui.tagAt = Date.now();
      if (ui.tagTaps >= 7 && ONLINE) location.href = 'admin.html';
      return;
    }
    case 'peek-choose': return openSheet('peek');
    case 'peek-ask': send({ t: 'peekAsk', pid }); return closeSheet();
    case 'peek-ans': return send({ t: 'peekAnswer', viewer: el.dataset.viewer, ok: el.dataset.v === '1' });
    case 'eye': return openSheet('eye');
    case 'go-live': return goLive();
    case 'live-open': return openSheet('join', { code: el.dataset.code, name: settings.name });
    case 'sc-ch': return sceneTap(el);
    case 'sc-peek': return scenePeek(el);
    case 'sc-ace': return sceneShuffle(el);
    case 'install-now':
      if (installPrompt) { installPrompt.prompt(); installPrompt.userChoice?.finally(() => { installPrompt = null; closeSheet(); }); }
      return;
    case 'close': return closeSheet();
    // single player
    case 'cpus': keepNick(); settings.cpus = Math.max(2, Math.min(12, settings.cpus + Number(el.dataset.d))); saveSettings(); return render();
    case 'level': keepNick(); settings.level = el.dataset.l; saveSettings(); return render();
    case 'sp-start': return newLocalGame();
    case 'sp-resume': G = store.get('bisca-sp:game'); Object.assign(ui, { screen: 'game', sel: null, showLast: false, lastTurn: null, saved: null }); requestWake(); return step();
    case 'again': G = null; return newLocalGame();
    case 'quit':
      if (!ui.confirmQuit) { ui.confirmQuit = true; return drawSheet(); }
      clearTimeout(ui.timer); store.del('bisca-sp:game'); G = null; return goSp();
    case 'ff': return fastForward();
    // stanze
    case 'pop-create': return openSheet('create');
    case 'pop-join': return openSheet('join');
    case 'create': return createRoom();
    case 'join': return joinRoom('player');
    case 'join-watch': return joinRoom('spectator');
    case 'rejoin': return openRoom(el.dataset.code);
    case 'leave-room': return leaveRoom();
    case 'share': return shareInvite(R.code);
    case 'copy-code':
      try { navigator.clipboard.writeText(R.code).then(() => toast('Codice copiato'), () => toast(`Codice: ${R.code}`)); } catch { toast(`Codice: ${R.code}`); }
      return;
    case 'pop-rename': return openSheet('rename');
    case 'rename': {
      const v = (document.getElementById('pname')?.value || '').trim();
      if (!v) { ui.popErr = 'Scegli un nome'; return drawSheet(); }
      send({ t: 'rename', name: v });
      settings.name = v.slice(0, 22); saveSettings();
      return closeSheet();
    }
    case 'pop-addcpu': return openSheet('addcpu', { n: 1, level: 'medio' });
    case 'cpu-n': ui.sheetData.n += Number(el.dataset.d); return drawSheet();
    case 'cpu-lv': ui.sheetData.level = el.dataset.l; return drawSheet();
    case 'add-cpu': send({ t: 'addCpu', n: ui.sheetData.n, level: ui.sheetData.level }); return closeSheet();
    case 'remove': return send({ t: 'remove', pid });
    case 'start': return send({ t: 'start' });
    case 'to-lobby': return send({ t: 'toLobby' });
    case 'force': return send({ t: 'force' });
    case 'cpu-for': return send({ t: 'cpuFor', pid });
    case 'claim': return send({ t: 'claimHost' });
    case 'kick': send({ t: 'remove', pid }); return closeSheet();
    case 'unkick': send({ t: 'unkick', pid }); return closeSheet();
    case 'reveal': ui.reveal = !ui.reveal; return render();
    case 'pop-avatar': keepNick(); ui.avReturn = null; ui.preTaken = null; ui.preNames = null; return openSheet('avatar');
    case 'entry-avatar': return avatarFromEntry();
    case 'av-back': { const b = ui.avReturn; ui.avReturn = null; return b ? openSheet(b.kind, b.data) : closeSheet(); }
    case 'av-pick': return openSheet('avname', { pick: el.dataset.id });
    case 'av-name': {
      const a = AVATARS.find((x) => x.id === ui.sheetData?.pick);
      return applyAvatarName(el.dataset.v === 'default' && a ? a.name : document.getElementById('pname')?.value);
    }
    case 'av-clear': setAvatar({ clear: true }); return closeSheet();
    case 'chat-open': return openChat();
    case 'chat-close': return closeChat();
    case 'mention': return pickMention(el.dataset.name);
    case 'chip':
      if (remote() && s && s.phase !== 'lobby' && s.hostId === R.me && pid !== R.me) openSheet('player', pid);
      return;
    // gioco
    case 'call': if (!tutAllow('call', Number(el.dataset.n))) return; return doCall(Number(el.dataset.n));
    case 'sel': {
      const c = Number(el.dataset.c);
      if (locked()) return;
      // tocco diretto: la carta parte subito (l'asso di denari chiede solo alta o bassa)
      if (isL0() && ui.coach?.gate?.card !== c) return tutAllow('card', c);
      if (G?.tut?.kind === 'sc' && G.tut.phase === 'eval') return;
      if (c === JOLLY || settings.confirmPlay || (G?.tut && !isL0() && !remote())) { ui.sel = ui.sel === c ? null : c; return render(); }
      if (!tutAllow('card', c)) return;
      ui.sel = null;
      return doPlay(c);
    }
    case 'play': if (ui.sel == null) return; {
      const c = ui.sel;
      if (!tutAllow(c === JOLLY ? 'jolly' : 'card', c === JOLLY ? el.dataset.v : c)) return;
      ui.sel = null; return doPlay(c, c === JOLLY ? el.dataset.v : undefined);
    }
    case 'play1': return doPlay(remote() ? undefined : G.s.round.hands[LOCAL_ME][0]);
    case 'quick': {
      if (locked()) return;
      const q = quickPicks(s.round)[el.dataset.k === 'take' ? 'take' : 'park'];
      if (!q || q.none) return;
      if (!tutAllow('card', q.card, q.jolly)) return;
      ui.sel = null;
      return doPlay(q.card, q.jolly);
    }
    case 'strat': ui.stratOpen = !ui.stratOpen; return render();
    case 'view': keepNick(); setView(el.dataset.v); if (ui.sheet) drawSheet(); return render();
    case 'viewpick': {
      if (document.getElementById('viewalways')?.checked) { settings.viewAlways = true; settings.view = el.dataset.v; }
      setView(el.dataset.v); closeSheet(); return render();
    }
    case 'view-ask': settings.viewAlways = !settings.viewAlways; saveSettings(); return drawSheet();
    case 'confirm-play': settings.confirmPlay = !settings.confirmPlay; saveSettings(); drawSheet(); return render();
    case 'jolly': return doJolly(el.dataset.v);
    case 'next': return doNext();
  }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.id === 'avfile' && el.files?.[0]) {
    try { const data = await photoToDataUrl(el.files[0]); openSheet('avname', { data }); }
    catch { toast('Non riesco a leggere questa foto'); }
    return;
  }
  if (el.dataset?.act === 'cpu-level') send({ t: 'cpuLevel', pid: el.dataset.pid, level: el.value });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ui.chatOpen) return closeChat();
  if (e.key === 'Escape' && ui.sheet) return closeSheet();
  if (e.key !== 'Enter' || !ui.sheet) return;
  if (ui.sheet === 'create') createRoom();
  else if (ui.sheet === 'join') joinRoom('player');
  else if (ui.sheet === 'rename') document.querySelector('[data-act="rename"]')?.click();
  else if (ui.sheet === 'avname' && e.target.id === 'pname') document.querySelector('[data-act="av-name"][data-v="custom"]')?.click();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (R && (!R.ws || R.ws.readyState > 1)) { R.retry = 0; connect(); }
  if ((G && G.s.phase !== 'finished') || R) requestWake();
});

// ================================================================ AVVIO

for (let c = 0; c < 40; c++) { const i = new Image(); i.src = cardSrc(c); }

(async function boot() {
  render();
  try {
    const res = await fetch('api/ping', { cache: 'no-store' });
    ONLINE = res.ok && (await res.json()).ok === true;
  } catch { ONLINE = false; }
  track({ type: 'visit', installed: STANDALONE });
  loadAvatars();
  if (ONLINE && 'serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  let code = null;
  try { code = new URL(location.href).searchParams.get('p'); } catch {}
  if (ONLINE && code) {
    code = code.toUpperCase();
    if (rooms.get(code)) openRoom(code);
    else { ui.screen = 'mp'; render(); openSheet('join', { code }); }
  } else render();
  archive.init();
})();
