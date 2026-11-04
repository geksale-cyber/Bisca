// Bisca — app web: home, single player contro la CPU e multiplayer con le stanze.
// Le regole sono in lib/engine.js, la CPU in lib/ai.js: le stesse usate dal server.
// Il tavolo si disegna allo stesso modo nelle due modalità: cambia solo chi tiene lo
// stato (il telefono in single player, il server in multiplayer).

import * as E from './lib/engine.js';
import * as AI from './lib/ai.js';

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
const img = (c, cls = '') => `<img class="card ${cls}" src="${cardSrc(c)}" alt="${cardName(c)}" draggable="false">`;
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
  if (!G) return;
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
const gameModels = () => ({ [LOCAL_ME]: AI.profileFor(profiles, player(LOCAL_ME)?.name || settings.name) });

async function saveRecord() {
  if (!G || (!G.rec.calls.length && !G.rec.plays.length)) return;
  if (!archive.mode) { ui.saved = 'off'; render(); return; }
  ui.saved = 'saving';
  const s = G.s;
  try {
    await archive.save(G.id, {
      v: 1, at: G.at, updated: Date.now(), level: G.level,
      player: player(LOCAL_ME)?.name || settings.name,
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
  const r = G.s.round;
  const e = { cards: r.cards, n: r.seats.length, call: n, dealer: r.dealerId === LOCAL_ME, pos: r.seats.indexOf(LOCAL_ME) };
  if (r.cards === 1) { e.visible = r.seats.filter((id) => id !== LOCAL_ME).map((id) => r.hands[id][0]); e.pool = 40 - e.visible.length; }
  else e.hand = r.hands[LOCAL_ME].slice();
  G.rec.calls.push(e);
}

function recordPlay(card, jolly) {
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
  if (s.phase !== 'calling' && s.phase !== 'playing') return;
  const r = s.round;
  const actor = r.pendingJolly || r.turnId;
  if (actor === LOCAL_ME) return;
  const base = s.phase === 'calling' ? 1300 : r.pendingJolly ? 800 : 1150;
  ui.timer = setTimeout(() => cpuAct(actor), base * speedFactor());
}

// Velocità della CPU in single player: quanto aspetta prima di ogni mossa.
const SPEEDS = { lenta: 1.7, normale: 1, veloce: 0.55 };
function speedFactor() { return (SPEEDS[settings.speed] || 1) * (meOut() ? 0.5 : 1); }

function cpuAct(pid) {
  const s = G.s;
  const r = s.round;
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
  try { fn(); } catch (e) { toast(e.message || 'Mossa non valida'); render(); return; }
  const r = s.round;
  ui.sel = null;
  ui.acted = { pid: before.actor, at: Date.now() };
  const trickDone = before.phase === 'playing' && (s.phase !== 'playing' || r.trickNo !== before.t);
  if ((s.phase === 'roundEnd' || s.phase === 'finished') && r.results) logRound(r);
  saveLocal();
  if (s.phase === 'roundEnd' || s.phase === 'finished') saveRecord();
  if (trickDone && r.lastTrick) {
    ui.showLast = true;
    render();
    ui.timer = setTimeout(() => { ui.showLast = false; step(); }, 2000 * speedFactor());
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
        toast(res.status === 404 ? 'La stanza non esiste più' : 'Non fai più parte di questa stanza');
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
  const s = m.s, r = s.round, pr = prev?.round;
  // la mano appena finita resta visibile un attimo
  if (pr && r && pr.n === r.n && prev.phase === 'playing' && (s.phase !== 'playing' || r.trickNo !== pr.trickNo) && r.lastTrick) {
    ui.showLast = true;
    clearTimeout(ui.timer);
    ui.timer = setTimeout(() => { ui.showLast = false; render(); }, 1500);
  }
  if (pr && r && pr.n === r.n) {
    const actor = pr.pendingJolly || pr.turnId;
    if (actor && actor !== R.me && (r.pendingJolly || r.turnId) !== actor) ui.acted = { pid: actor, at: Date.now() };
  }
  if (!prev || prev.round?.n !== r?.n || prev.round?.turnId !== r?.turnId) ui.sel = null;
  if (s.phase !== 'lobby' && s.phase !== 'finished') requestWake();
  render();
  if (ui.sheet) drawSheet();
}

function send(msg) {
  if (!R?.ws || R.ws.readyState !== 1) { toast('Non sei collegato, riprovo…'); return; }
  R.ws.send(JSON.stringify(msg));
}

async function createRoom() {
  const name = (document.getElementById('pname')?.value || '').trim();
  if (!name) { ui.popErr = 'Scegli un nome'; return drawSheet(); }
  settings.name = name.slice(0, 22); saveSettings();
  try {
    const r = await api('games', { name: settings.name, device: DEVICE });
    rooms.put(r.code, { playerId: r.playerId, token: r.token, as: 'player' });
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
  try {
    const r = await api(`games/${code}/join`, { name: settings.name, as, device: DEVICE });
    rooms.put(r.code, { playerId: r.playerId, token: r.token, as });
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
let AVATARS = []; // personaggini disponibili: [{id, name}] da avatar/index.json
fetch('avatar/index.json').then((r) => (r.ok ? r.json() : [])).then((a) => { AVATARS = Array.isArray(a) ? a : []; if (ui.screen === 'home') { ui.scene = null; render(); } }).catch(() => {});

function avatarSrc(p) {
  if (!p || p.cpu) return null;
  if (remote() && p.avatar?.photo) return `api/games/${R.code}/avatar?pid=${encodeURIComponent(p.id)}&v=${p.avatar.photo}`;
  if (p.avatar?.pick) return `avatar/${p.avatar.pick}.webp`;
  if (!remote() && p.id === LOCAL_ME) {
    if (settings.avatarPhoto) return settings.avatarPhoto;
    if (settings.avatarPick) return `avatar/${settings.avatarPick}.webp`;
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
  if (!remote() || !R?.s) return null;
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
        return `<button class="avrow ${cur === a.id ? 'on' : ''}" data-act="av-pick" data-id="${esc(a.id)}" ${by ? 'disabled' : ''}><img src="avatar/${esc(a.id)}.webp" alt="" loading="lazy"><span><b>${esc(a.name || a.id)}</b>${by ? `<small>scelto da ${esc(by.name)}</small>` : ''}</span></button>`;
      }).join('')}</div>`
      : '<p class="hint">I personaggi arrivano presto: intanto puoi usare una foto.</p>'}
    <button class="btn ghost" data-act="av-clear">Togli l'avatar</button>`;
}

// Secondo passo: con quale nome giochi.
function avatarNameHTML(err) {
  const d = ui.sheetData || {};
  const a = d.pick && AVATARS.find((x) => x.id === d.pick);
  const curName = (remote() ? myAvatarPlayer()?.name : settings.name) || '';
  const pic = a ? `<img class="avfull" src="avatar/full/${esc(a.id)}.webp" alt="">` : `<img class="av lg" src="${esc(d.data)}" alt="">`;
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
  settings.name = name; saveSettings();
  const d = ui.sheetData || {};
  closeSheet();
  setAvatar(d.pick ? { pick: d.pick } : { data: d.data });
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

const doCall = (n) => (remote() ? send({ t: 'call', n }) : (recordCall(n), perform(() => E.makeCall(G.s, LOCAL_ME, n))));
const doPlay = (card, jolly) => (remote() ? send({ t: 'play', card, jolly }) : (recordPlay(card, jolly), perform(() => E.playCard(G.s, LOCAL_ME, card, jolly))));
const doJolly = (v) => (remote() ? send({ t: 'jolly', v }) : perform(() => E.chooseJolly(G.s, LOCAL_ME, v)));
const doNext = () => (remote() ? send({ t: 'ready' }) : localNextRound());

// ================================================================ SCHERMATE

function render() {
  clearTimeout(ui.redraw); ui.redraw = null;
  renderScreen();
  updateChatBtn();
}

function renderScreen() {
  switch (ui.screen) {
    case 'home': return renderHome();
    case 'sp': return renderSpSetup();
    case 'mp': return renderMp();
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
  chev: '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  share: '<svg class="inl" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4"/><path d="M6 11v8h12v-8"/></svg>',
  dots: '<svg class="inl" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>',
};

function renderHome() {
  const mpOff = ONLINE === false;
  $app.innerHTML = `
    <div class="homebg" aria-hidden="true"></div>
    ${sceneHTML()}
    <p class="tagline">Chiama, gioca, non perdere vite.</p>
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
    ${STANDALONE ? '' : `<button class="installcard" data-act="install">
      <span class="mi">${ICONS.phone}</span>
      <span class="mt"><b>Come scaricare l'app</b><span>Aggiungila alla schermata Home: non occupa spazio</span></span>${ICONS.chev}
    </button>`}
    <div class="linkrow center2"><button class="link" data-act="rules">Regole del gioco</button></div>`;
}

// ================================================================ SCENA DELLA HOME
// Titolo fatto di carte, assi sparsi e una tavolata di personaggi presi a caso.
// Tocchi: personaggio → saltello e nuvoletta; quello nascosto → si rinasconde;
// asso di denari → gira e cambia tavolata. Ogni 12 secondi un personaggio cambia.

const SAY = ['Io chiamo 3', 'Questa la prendo io', 'Parcheggio!', 'Chi è il mazziere?', 'Asso di denari alto!', 'Sto a posto così', 'Ne devo prendere ancora due',
  'Zero, e non se ne parla più', 'Chi ha mischiato?', 'Mi resta una vita…', 'Tocca a me?', 'Vita bonus, grazie', 'Non guardarmi le carte!', 'Questa è mia', 'Chiamo 1 e basta'];
// le cinque carte dentro l'immagine del titolo: inizio e fine in larghezza, bordo alto (in %)
const TCARD = [{ a: 1, b: 19.5, t: 8 }, { a: 20.5, b: 36.5, t: 8 }, { a: 38, b: 56, t: 4 }, { a: 56, b: 74, t: 8 }, { a: 75, b: 98, t: 7 }];
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
    const pk = sc.peeks.filter((p) => p.card === i).map((p) => `<button class="sc-peek ${sc.hidden[p.id] ? 'down' : ''}" data-act="sc-peek" data-id="${p.id}" aria-label="${esc(nameOfAv(p.id))}"><img src="avatar/full/${p.id}.webp" alt=""></button>`).join('');
    return pk ? `<div class="sc-pw" style="left:${c.a}%;width:${c.b - c.a}%;top:${c.t}%">${pk}</div>` : '';
  }).join('');
  const cards = `<div class="sc-tbox">${peeks}<img class="sc-title" src="icons/title.webp" alt="Bisca"></div>`;
  const chars = sc.chars.map((c, i) => `<button class="sc-ch" data-act="sc-ch" data-i="${i}" style="left:${c.x}%;height:${c.h}%;z-index:${c.z}" aria-label="${esc(nameOfAv(c.id))}"><img src="avatar/full/${c.id}.webp" alt="" class="${c.mirror ? 'mir' : ''}"></button>`).join('');
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

function sceneBubble(el, name) {
  const scene = document.getElementById('scene');
  if (!scene) return;
  scene.querySelector('.sc-bub')?.remove();
  const sb = scene.getBoundingClientRect(), eb = el.getBoundingClientRect();
  const b = document.createElement('div');
  b.className = 'sc-bub';
  b.innerHTML = `<b>${esc(name)}</b>${esc(pick(SAY))}`;
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
  sceneBubble(el, AVATARS.find((a) => a.id === c.id)?.name || '');
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
  new Image().src = `avatar/full/${next.id}.webp`;
  el.classList.add('leave');
  setTimeout(swap, 450);
}, 12000);

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

function brainHTML() {
  if (archive.mode === undefined) return `<div class="panel brain"><h3>Cosa ha imparato la CPU</h3><p class="muted">Carico l'archivio…</p></div>`;
  if (archive.mode === null) return `<div class="panel brain"><h3>Cosa ha imparato la CPU</h3><p class="muted">Qui le partite non vengono salvate, quindi la CPU non impara. Gioca comunque con il buon senso.</p></div>`;
  const g = profiles.group;
  const you = settings.name ? profiles.byName?.[settings.name.trim().toLowerCase()] : null;
  const p = you || { samples: { calls: 0, firstTricks: 0 }, raw: {} };
  const facts = [];
  const sc = p.samples?.calls || 0;
  const sf = p.samples?.firstTricks || 0;
  if (sc >= 5) {
    const b = p.raw.callBias;
    facts.push(Math.abs(b) < 0.1 ? 'Chiamate: in linea con la forza delle tue carte.' : `Chiamate: in media ${fmtNum(b)} mani rispetto a quello che direbbe la forza delle carte (${b > 0 ? 'chiami alto' : 'chiami basso'}).`);
  } else facts.push(`Chiamate: servono almeno 5 chiamate per farsi un'idea (ora ${sc}).`);
  if (sf >= 5) facts.push(`Prima mano: tiri la carta più bassa il ${Math.round(p.raw.firstLow * 100)}% delle volte.`);
  else facts.push(`Prima mano: servono almeno 5 prime mani giocate (ora ${sf}).`);
  facts.push('Quando chiami, la CPU usa queste abitudini per capire che carte hai in mano.');
  return `<div class="panel brain">
    <h3>Cosa ha imparato la CPU <span>più giocate, più impara</span></h3>
    <div class="nums"><div><b>${g?.games || 0}</b><span>partite registrate</span></div><div><b>${g?.decisions || 0}</b><span>decisioni studiate</span></div></div>
    <p class="muted" style="font-size:13px;margin-bottom:6px">Su di te${settings.name ? ` (${esc(settings.name)})` : ''}:</p>
    <ul>${facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
  </div>`;
}

function backBar(title) {
  return `<div class="topbar"><button class="iconbtn" data-act="home" aria-label="Indietro"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button><div class="t"><b>${title}</b></div></div>`;
}

function speedHTML() {
  return `<div class="label">Velocità della CPU</div>
    <div class="seg" role="group" aria-label="Velocità della CPU">${Object.keys(SPEEDS).map((v) => `<button data-act="speed" data-v="${v}" aria-pressed="${(settings.speed || 'normale') === v}">${cap(v)}</button>`).join('')}</div>`;
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
    ${speedHTML()}
    <button class="btn" data-act="sp-start">Inizia la partita</button>
    ${canResume ? `<button class="btn ghost" data-act="sp-resume">Riprendi la partita · turno ${saved.s.roundNo}</button>` : ''}
`;
}

function renderMp() {
  const list = Object.entries(rooms.all()).sort((a, b) => b[1].at - a[1].at).slice(0, 5);
  $app.innerHTML = `
    ${backBar('Gioca con i tuoi amici')}
    <div class="modes">
      <button class="mode" data-act="pop-create"><b>Crea una stanza</b><span>Diventi tu l'host: inviti gli amici e avvii la partita</span></button>
      <button class="mode alt" data-act="pop-join"><b>Accedi a una stanza</b><span>Inserisci il codice che ti hanno mandato</span></button>
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

function queueHTML(s, r) {
  if (ui.showLast) return '';
  const me = ME();
  const seats = r.seats;
  const meIn = seats.includes(me) && !meOut();
  if (s.phase === 'calling') return '';
  if (false) {
    const missing = seats.filter((id) => r.calls[id] == null);
    if (!missing.length) return '';
    const myTurn = r.turnId === me;
    const list = myTurn ? missing.slice(1) : missing;
    const label = myTurn ? (list.length ? `Dopo di te chiamano ${list.length}` : 'Sei l\'ultimo a chiamare') : 'Devono ancora chiamare';
    return `<div class="queue"><div class="ql">${label}</div><div class="qrow hscroll">${list.map((id) => `<span class="qi">${who(id)}${id === r.dealerId ? '<em>mazziere</em>' : ''}</span>`).join('')}</div></div>`;
  }
  if (s.phase !== 'playing') return '';
  const playedIds = new Set(r.trick.plays.map((p) => p.pid));
  const i = seats.indexOf(r.trick.leader);
  const order = [];
  for (let k = 0; k < seats.length; k++) order.push(seats[(i + k) % seats.length]);
  let todo = order.filter((id) => !playedIds.has(id));
  const myTurn = (r.pendingJolly || r.turnId) === me;
  if (myTurn) todo = todo.filter((id) => id !== me);
  if (!todo.length) return meIn && myTurn ? `<div class="queue"><div class="ql">Sei l'ultimo di mano</div></div>` : '';
  const status = (id) => {
    const need = r.calls[id] - r.won[id];
    if (r.calls[id] === 0 && r.won[id] === 0) return '<em>ha chiamato 0</em>';
    if (need > 0) return `<em class="need">deve prenderne ${need}</em>`;
    if (need === 0) return '<em>è a posto</em>';
    return '<em>ha già sforato</em>';
  };
  const needN = todo.filter((id) => r.calls[id] - r.won[id] > 0).length;
  const zeroN = todo.filter((id) => r.calls[id] === 0).length;
  const label = `${myTurn ? 'Dopo di te' : 'Devono ancora tirare'}: ${todo.length} · <b>${needN}</b> ${needN === 1 ? 'deve' : 'devono'} prendere · <b>${zeroN}</b> ${zeroN === 1 ? 'ha' : 'hanno'} chiamato 0`;
  return `<div class="queue"><div class="ql">${label}</div><div class="qrow hscroll">${todo.map((id) => `<span class="qi">${who(id)}${status(id)}</span>`).join('')}</div></div>`;
}

function tableHTML(s, r) {
  const me = ME();
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

function bonusText(s) {
  if (!s.bonusZeroUsed) return 'Vita bonus a 0: <b>ancora libera</b>';
  const ids = [];
  for (const h of s.history) for (const [id, x] of Object.entries(h.results)) if (x.zeroBonus) ids.push(id);
  return `Vita bonus a 0: <b>già presa</b>${ids.length ? ` da ${ids.map((id) => (id === ME() ? 'te' : esc(nameOf(id)))).join(' e ')}` : ''}`;
}

// Tasti rapidi. PARCHEGGIO: la carta più alta che resta sotto la migliore sul tavolo, tenendo
// da parte le carte migliori che servono per le prese mancanti. PRENDI: la carta più alta.
function quickPicks(r) {
  const me = ME();
  const h = r.hands[me];
  let best = -1;
  for (const p of r.trick.plays) best = Math.max(best, strength(p.card, p.jolly));
  const need = (r.calls[me] ?? 0) - r.won[me];
  const takeStr = (c) => (c === JOLLY ? 41 : c + 1);
  const ranked = h.slice().sort((a, b) => takeStr(b) - takeStr(a));
  const reserved = need > 0 ? ranked.slice(0, need) : [];
  const pool = h.filter((c) => !reserved.includes(c));
  let park;
  if (!pool.length) park = { none: 'Devi prenderle tutte' };
  else {
    const normal = pool.filter((c) => c !== JOLLY).sort((a, b) => a - b);
    const hasJ = pool.includes(JOLLY);
    const under = normal.filter((c) => c + 1 < best);
    if (best < 0) park = normal.length ? { card: normal[0] } : { card: JOLLY, jolly: 'low' };
    else if (under.length) park = { card: under[under.length - 1] };
    else if (hasJ) park = { card: JOLLY, jolly: 'low' };
    else park = { card: normal[0], over: true };
  }
  const top = ranked[0];
  let take;
  if (best >= 0 && takeStr(top) <= best) {
    take = { none: 'Nessuna carta prende' };
    // non puoi prendere questa mano: se devi ancora prendere, butta la più bassa e tieni le altre
    if (need > 0) park = { card: ranked[ranked.length - 1] };
  } else take = top === JOLLY ? { card: JOLLY, jolly: 'high' } : { card: top };
  return { park, take };
}
const pickName = (p) => (p.card === JOLLY ? `Asso denari ${p.jolly === 'high' ? 'alto' : 'basso'}` : cardName(p.card).replace(' di ', ' '));

function quickHTML(r) {
  const { park, take } = quickPicks(r);
  const btn = (k, label, p, cls) => p.none
    ? `<button class="btn qk ${cls}" disabled><b>${label}</b><span>${p.none}</span></button>`
    : `<button class="btn qk ${cls}" data-act="quick" data-k="${k}"><b>${label}</b><span>${esc(pickName(p))}${p.over ? ' (prende)' : ''}</span></button>`;
  return `<div class="row2 quick">${btn('park', 'Parcheggio', park, '')}${btn('take', 'Prendi', take, 'light')}</div>`;
}

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
  const players = tableOrder().map(player).filter(Boolean);
  const sum = Object.values(r.calls).reduce((a, b) => a + b, 0);
  const levelTag = remote() ? `stanza ${esc(s.code)}` : G.level;
  const sub = s.phase === 'calling' ? 'Giro delle chiamate' : ending ? 'Fine turno' : `Mano ${Math.min(r.trickNo, r.cards)} di ${r.cards}`;
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
      if (r.cards === 1) hand = h.length ? `<div class="hand one"><div class="back" aria-label="La tua carta coperta">?</div></div>` : '<div class="hand one"></div>';
      else {
        const active = myTurn && s.phase === 'playing' && !r.pendingJolly;
        hand = `<div class="hand ${active ? 'active' : 'dim'}" role="group" aria-label="Le tue carte">${h.map((c) => (active
          ? `<button class="card-btn" data-act="sel" data-c="${c}" aria-label="${cardName(c)}" aria-pressed="${ui.sel === c}">${img(c, ui.sel === c ? 'sel' : '')}</button>`
          : img(c))).join('')}</div>`;
      }
    } else if (meOut()) {
      const isSpect = !player(me);
      hand = remote()
        ? `<div class="banner"><div class="grow">${isSpect ? 'Stai guardando la partita.' : 'Sei fuori dal gioco: ora guardi.'} Le carte sono coperte.</div><button class="btn small ${ui.reveal ? '' : 'light'}" data-act="reveal">${ui.reveal ? 'Copri' : 'Mostra carte'}</button></div>`
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
      if (r.cards === 1) actions = `<button class="btn" data-act="play1">Gira e gioca la tua carta</button>`;
      else if (ui.sel == null) actions = `<p class="hint">Tocca una carta oppure usa i tasti rapidi</p>`;
      else if (ui.sel === JOLLY) actions = `<p class="hint">Asso di denari: decidi quanto vale</p><div class="row2"><button class="btn" data-act="play" data-v="high">Più alta di tutte</button><button class="btn light" data-act="play" data-v="low">Più bassa di tutte</button></div>`;
      else actions = `<button class="btn" data-act="play">Gioca ${cardName(ui.sel)}</button>`;
    }
  } else actions = roundEndHTML(s, r);

  $app.innerHTML = `
    <div class="topbar">
      <div class="t"><b>Turno ${r.n} · ${carte(r.cards)}</b><span>${esc(sub)} · ${levelTag}</span></div>
      <button class="iconbtn" data-act="scores" aria-label="Punteggi"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V10M12 20V4M19 20v-7"/></svg></button>
      <button class="iconbtn" data-act="menu" aria-label="Menu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
    </div>
    ${bannersHTML(s, r, live)}
    ${roles}
    <div class="inforow"><span>${bonusText(s)}</span>${s.phase === 'calling' ? '' : `<span>Chiamate <b>${sum}</b> su ${r.cards} ${r.cards === 1 ? 'mano' : 'mani'}</span>`}</div>
    <div class="players hscroll" id="players">${players.map((p) => chipHTML(p, s, r, live)).join('<span class="arrow" aria-hidden="true">›</span>')}</div>
    ${ending ? '' : queueHTML(s, r)}
    ${ending ? '' : tableHTML(s, r)}
    <div class="status ${mine ? 'mine' : ''}" aria-live="polite">${status}</div>
    ${myTurn && s.phase === 'playing' && !r.pendingJolly && r.cards > 1 ? quickHTML(r) : ''}
    ${hand}
    <div class="actions">${actions}</div>`;

  const pl = document.getElementById('players');
  const turnId = live && !ui.showLast ? actor : null;
  if (pl && turnId && turnId !== ui.lastTurn) {
    const el = pl.querySelector(`[data-pid="${turnId}"]`);
    if (el) {
      // si sposta solo quando il giocatore di turno esce dallo schermo, e lo mette a sinistra
      // così si vedono quelli che vengono dopo
      const l = el.offsetLeft - pl.scrollLeft, rgt = l + el.clientWidth;
      if (l < 8 || rgt > pl.clientWidth - 8) pl.scrollTo({ left: Math.max(0, el.offsetLeft - 40), behavior: ui.lastTurn ? 'smooth' : 'auto' });
    }
  }
  ui.lastTurn = turnId;
  const ps = document.getElementById('playedScroll');
  if (ps) ps.scrollLeft = ps.scrollWidth;
}

function saveLine() {
  if (remote()) return '';
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
  else if (k === 'scores') html = scoresHTML();
  else if (k === 'avatar') html = avatarSheetHTML();
  else if (k === 'avname') html = avatarNameHTML(err);
  else if (k === 'create') html = `<h2>Crea una stanza</h2>
    <label class="label" for="pname">Il tuo nome</label>
    <input id="pname" class="field" maxlength="22" autocomplete="nickname" value="${esc(settings.name)}" placeholder="Es. Thomas">
    ${err}<button class="btn" data-act="create">Crea la stanza</button>`;
  else if (k === 'join') {
    const d = ui.sheetData || {};
    html = `<h2>Accedi a una stanza</h2>
    <label class="label" for="pname">Il tuo nome</label>
    <input id="pname" class="field" maxlength="22" autocomplete="nickname" value="${esc(d.name ?? settings.name)}" placeholder="Es. Marco">
    <label class="label" for="pcode">Codice di invito</label>
    <input id="pcode" class="field code" maxlength="6" autocomplete="off" autocapitalize="characters" value="${esc(d.code || '')}" placeholder="CODICE">
    ${err}<button class="btn" data-act="join">Entra</button>
    ${ui.popStarted ? '<button class="btn ghost" data-act="join-watch">Guarda come spettatore</button>' : ''}`;
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
    html = `<h2>Menu</h2><button class="btn ghost" data-act="rules">Regole</button>`;
    if (remote()) {
      html += `<button class="btn ghost" data-act="share">Invia l'invito alla stanza</button>
        <button class="btn ghost" data-act="home">Torna al menù principale</button>
        <p class="hint">Resti nella stanza: puoi rientrare da "Gioca con i tuoi amici".</p>`;
    } else {
      html += ui.confirmQuit
        ? `<p class="hint">Vuoi davvero abbandonare? La partita non si potrà riprendere.</p><div class="row2"><button class="btn ghost" data-act="close">No, resto</button><button class="btn" data-act="quit" style="background:var(--red);color:#1A0606">Abbandona</button></div>`
        : `<button class="btn ghost" data-act="quit">Abbandona la partita</button>`;
      html += speedHTML() + `<button class="btn ghost" data-act="home">Torna al menù principale</button><p class="hint">Dal single player puoi riprendere la partita quando vuoi.</p>`;
    }
  }
  if (!html) return closeSheet();
  $sheet.innerHTML = `<div class="box" role="dialog" aria-modal="true">${html}<button class="btn ghost" data-act="close">Chiudi</button></div>`;
  $sheet.hidden = false;
  const first = $sheet.querySelector('input');
  if (first && !first.value) first.focus();
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
    case 'speed': keepNick(); settings.speed = el.dataset.v; saveSettings(); if (ui.sheet) drawSheet(); return render();
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
    case 'pop-avatar': keepNick(); return openSheet('avatar');
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
    case 'call': return doCall(Number(el.dataset.n));
    case 'sel': { const c = Number(el.dataset.c); ui.sel = ui.sel === c ? null : c; return render(); }
    case 'play': if (ui.sel == null) return; { const c = ui.sel; ui.sel = null; return doPlay(c, c === JOLLY ? el.dataset.v : undefined); }
    case 'play1': return doPlay(remote() ? undefined : G.s.round.hands[LOCAL_ME][0]);
    case 'quick': { const q = quickPicks(s.round)[el.dataset.k === 'take' ? 'take' : 'park']; ui.sel = null; return doPlay(q.card, q.jolly); }
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
