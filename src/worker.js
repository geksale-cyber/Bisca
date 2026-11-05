import { DurableObject } from 'cloudflare:workers';
import * as E from '../public/lib/engine.js';
import * as AI from '../public/lib/ai.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CLEANUP_AFTER = 7 * 24 * 3600 * 1000; // stanze ferme da 7 giorni vengono cancellate
const EMPTY_CLOSE = 5 * 60 * 1000; // stanza senza nessuno collegato da 5 minuti: si chiude
const HOST_TAKEOVER_AFTER = 60_000;
const CHAT_KEEP = 150;
const MAX_AVATAR = 80_000; // byte della foto (già rimpicciolita dall'app)
const LEVELS = ['facile', 'medio', 'difficile'];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

function randomId(bytes = 6) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function randomCode() {
  const a = crypto.getRandomValues(new Uint8Array(5));
  return [...a].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}
const rng = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
const archive = (env) => env.ARCHIVE.get(env.ARCHIVE.idFromName('archivio'));

// ---------------------------------------------------------------- Worker (instradamento)

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'api') return env.ASSETS.fetch(request);
    try {
      if (parts[1] === 'ping') return json({ ok: true });
      if (parts[1] === 'records' && request.method === 'POST') return archive(env).fetch('https://a/put', { method: 'POST', body: await request.text() });
      if (parts[1] === 'profiles') return archive(env).fetch('https://a/profiles');
      if (parts[1] === 'event' && request.method === 'POST') return archive(env).fetch('https://a/event', { method: 'POST', body: await request.text() });
      const keyOk = () => !!env.STATS_KEY && (url.searchParams.get('key') || request.headers.get('x-key')) === env.STATS_KEY;
      if (parts[1] === 'stats') {
        if (!keyOk()) return json({ error: 'Chiave sbagliata' }, 403);
        return archive(env).fetch('https://a/stats');
      }
      // avatar: elenco pubblico (solo quelli visibili) e immagini, con cache lunga
      if (parts[1] === 'avatars' && parts[2] === 'img' && parts[3]) {
        const cache = caches.default;
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await archive(env).fetch(`https://a/avatar-img?id=${encodeURIComponent(parts[3])}&kind=${parts[4] === 'full' ? 'full' : 'circle'}`);
        if (res.ok) await cache.put(request, res.clone());
        return res;
      }
      if (parts[1] === 'avatars') return archive(env).fetch('https://a/avatars');
      if (parts[1] === 'admin') {
        if (!keyOk()) return json({ error: 'Chiave sbagliata' }, 403);
        if (parts[2] === 'avatars' && request.method === 'POST') return archive(env).fetch('https://a/admin-avatars', { method: 'POST', body: await request.text() });
        if (parts[2] === 'avatars') return archive(env).fetch('https://a/avatars?all=1');
        return json({ error: 'Non trovato' }, 404);
      }
      // partite in corso e stanze in attesa, per gli spettatori
      if (parts[1] === 'live') return archive(env).fetch('https://a/live');
      if (parts[1] === 'games' && parts.length === 2 && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        for (let i = 0; i < 6; i++) {
          const code = randomCode();
          const stub = env.GAME.get(env.GAME.idFromName(code));
          const res = await stub.fetch('https://do/init', { method: 'POST', body: JSON.stringify({ code, name: body.name, device: body.device, pick: body.pick }) });
          if (res.status !== 409) return res;
        }
        return json({ error: 'Riprova' }, 500);
      }
      if (parts[1] === 'games' && parts[2]) {
        const code = parts[2].toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
        const stub = env.GAME.get(env.GAME.idFromName(code));
        const target = new URL(`https://do/${parts[3] || 'info'}`);
        target.search = url.search;
        return stub.fetch(new Request(target, request));
      }
    } catch (e) {
      return json({ error: 'Errore del server' }, 500);
    }
    return json({ error: 'Non trovato' }, 404);
  },
};

// ---------------------------------------------------------------- Archivio: partite registrate e profili

// Statistiche d'uso: una riga per ogni evento (visita, partita iniziata o finita).
const EVENT_TYPES = ['visit', 'sp_start', 'sp_end', 'room', 'mp_start', 'mp_end', 'mp_seat'];
const clip = (v, n) => (v == null ? null : String(v).slice(0, n));

export class Archive extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS events (ts INTEGER, day TEXT, type TEXT, device TEXT, name TEXT, game TEXT, players INTEGER, humans INTEGER, rounds INTEGER, installed INTEGER)`);
    this.sql.exec('CREATE INDEX IF NOT EXISTS ev_day ON events(day)');
    this.sql.exec(`CREATE TABLE IF NOT EXISTS avatars (id TEXT PRIMARY KEY, name TEXT, pose TEXT, dir TEXT, say TEXT, hidden INTEGER DEFAULT 0, ord INTEGER DEFAULT 0, v INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, phase TEXT, info TEXT, updated INTEGER)`);
  }

  // ---- avatar
  avatarList(all) {
    const rows = this.sql.exec(`SELECT id, name, pose, dir, say, hidden, ord, v FROM avatars ${all ? '' : 'WHERE hidden = 0'} ORDER BY ord, name`).toArray();
    return rows.map((r) => ({ id: r.id, name: r.name, pose: r.pose || 'stand', dir: r.dir || null, say: r.say || '', hidden: !!r.hidden, ord: r.ord, v: r.v }));
  }

  async adminAvatars(body) {
    const okImg = (d) => typeof d === 'string' && /^data:image\/(webp|png|jpeg);base64,/.test(d) && d.length < 1_500_000;
    const slug = (t) => String(t || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    if (body.action === 'delete') {
      const id = String(body.id || '');
      this.sql.exec('DELETE FROM avatars WHERE id = ?', id);
      await this.ctx.storage.delete(['img:' + id + ':full', 'img:' + id + ':circle']);
      return { ok: true };
    }
    if (body.action === 'order') {
      (body.ids || []).forEach((id, i) => this.sql.exec('UPDATE avatars SET ord = ? WHERE id = ?', i, String(id)));
      return { ok: true };
    }
    if (body.action === 'save') {
      const it = body.item || {};
      let id = it.id ? String(it.id) : slug(it.name);
      if (!id) throw new Error('Manca il nome');
      const exists = this.sql.exec('SELECT 1 FROM avatars WHERE id = ?', id).toArray().length;
      if (!it.id && exists) { let k = 2; while (this.sql.exec('SELECT 1 FROM avatars WHERE id = ?', `${id}-${k}`).toArray().length) k++; id = `${id}-${k}`; }
      if (!exists && !(okImg(body.full) && okImg(body.circle))) throw new Error('Serve un\'immagine');
      const pose = ['point', 'up', 'cross', 'stand'].includes(it.pose) ? it.pose : 'stand';
      const dir = it.dir === 'left' ? 'left' : null;
      const name = clip(String(it.name || id).replace(/\s+/g, ' ').trim(), 22);
      const say = clip(String(it.say || '').trim(), 60);
      const ord = Number.isFinite(it.ord) ? it.ord : (this.sql.exec('SELECT COALESCE(MAX(ord), 0) + 1 AS n FROM avatars').toArray()[0].n);
      let v = it.v || Date.now();
      if (okImg(body.full) && okImg(body.circle)) {
        await this.ctx.storage.put({ ['img:' + id + ':full']: body.full, ['img:' + id + ':circle']: body.circle });
        v = Date.now();
      }
      this.sql.exec(`INSERT INTO avatars (id, name, pose, dir, say, hidden, ord, v) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, pose = excluded.pose, dir = excluded.dir, say = excluded.say, hidden = excluded.hidden, ord = excluded.ord, v = excluded.v`,
        id, name, pose, dir, say, it.hidden ? 1 : 0, ord, v);
      return { ok: true, id, v };
    }
    throw new Error('Azione sconosciuta');
  }

  // ---- stanze in corso (aggiornate dalle stanze stesse)
  setRoom(r) {
    if (!r?.code) return;
    if (r.phase === 'gone' || r.phase === 'finished' || !r.humans) { this.sql.exec('DELETE FROM rooms WHERE code = ?', r.code); return; }
    this.sql.exec(`INSERT INTO rooms (code, phase, info, updated) VALUES (?, ?, ?, ?) ON CONFLICT(code) DO UPDATE SET phase = excluded.phase, info = excluded.info, updated = excluded.updated`,
      clip(r.code, 8), clip(r.phase, 12), JSON.stringify(r).slice(0, 4000), Date.now());
  }

  liveRooms() {
    const since = Date.now() - 20 * 60_000; // stanze ferme da più di 20 minuti non compaiono
    this.sql.exec('DELETE FROM rooms WHERE updated < ?', Date.now() - 24 * 3600_000);
    // in partita: solo se c'è qualcuno collegato; in sala d'attesa: anche fino a 5 minuti dopo l'ultima attività
    const recent = Date.now() - 5 * 60_000;
    return this.sql.exec('SELECT info, updated FROM rooms WHERE updated >= ? ORDER BY updated DESC LIMIT 80', since).toArray()
      .map((r) => ({ ...JSON.parse(r.info), updated: r.updated }))
      .filter((g) => g.online > 0 || (g.phase === 'lobby' && g.updated >= recent))
      .slice(0, 50);
  }

  addEvent(e) {
    if (!EVENT_TYPES.includes(e.type)) return false;
    const ts = Date.now();
    const day = new Date(ts + 3600_000).toISOString().slice(0, 10); // giorno italiano (circa)
    // una sola visita al giorno per telefono
    if (e.type === 'visit') {
      const seen = this.sql.exec('SELECT 1 FROM events WHERE type = ? AND day = ? AND device = ? LIMIT 1', 'visit', day, clip(e.device, 40)).toArray();
      if (seen.length) { if (e.installed) this.sql.exec('UPDATE events SET installed = 1 WHERE type = ? AND day = ? AND device = ?', 'visit', day, clip(e.device, 40)); return true; }
    }
    this.sql.exec('INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', ts, day, e.type, clip(e.device, 40), clip(e.name, 22), clip(e.game, 60),
      Number(e.players) || null, Number(e.humans) || null, Number(e.rounds) || null, e.installed ? 1 : 0);
    return true;
  }

  stats() {
    const q = (sql, ...a) => this.sql.exec(sql, ...a).toArray();
    const one = (sql, ...a) => Object.values(q(sql, ...a)[0] || { v: 0 })[0] || 0;
    const since = (d) => new Date(Date.now() + 3600_000 - d * 86400_000).toISOString().slice(0, 10);
    const count = (type) => one('SELECT COUNT(*) FROM events WHERE type = ?', type);
    const days = [];
    for (let i = 29; i >= 0; i--) days.push(since(i));
    const byDay = (type, distinct) => Object.fromEntries(q(`SELECT day, ${distinct ? 'COUNT(DISTINCT device)' : 'COUNT(*)'} AS n FROM events WHERE type = ? AND day >= ? GROUP BY day`, type, days[0]).map((r) => [r.day, r.n]));
    const vis = byDay('visit', true), sp = byDay('sp_start'), mp = byDay('mp_start');
    return {
      updated: Date.now(),
      people: {
        total: one('SELECT COUNT(DISTINCT device) FROM events WHERE device IS NOT NULL'),
        today: one('SELECT COUNT(DISTINCT device) FROM events WHERE device IS NOT NULL AND day = ?', since(0)),
        week: one('SELECT COUNT(DISTINCT device) FROM events WHERE device IS NOT NULL AND day >= ?', since(6)),
        month: one('SELECT COUNT(DISTINCT device) FROM events WHERE device IS NOT NULL AND day >= ?', since(29)),
        installed: one('SELECT COUNT(DISTINCT device) FROM events WHERE installed = 1'),
      },
      games: {
        spStarted: count('sp_start'), spFinished: count('sp_end'),
        rooms: count('room'), mpStarted: count('mp_start'), mpFinished: count('mp_end'),
        avgTable: Math.round(one('SELECT AVG(players) FROM events WHERE type = ?', 'mp_start') * 10) / 10,
        avgHumans: Math.round(one('SELECT AVG(humans) FROM events WHERE type = ?', 'mp_start') * 10) / 10,
        rounds: one("SELECT SUM(rounds) FROM events WHERE type IN ('sp_end', 'mp_end')"),
      },
      daily: days.map((d) => ({ day: d, people: vis[d] || 0, sp: sp[d] || 0, mp: mp[d] || 0 })),
      players: q("SELECT name, COUNT(*) AS games, MAX(ts) AS last FROM events WHERE type IN ('sp_start', 'mp_seat') AND name IS NOT NULL GROUP BY lower(name) ORDER BY games DESC LIMIT 20"),
      recent: q("SELECT ts, type, name, players, humans, rounds FROM events WHERE type IN ('sp_start', 'sp_end', 'mp_start', 'mp_end') ORDER BY ts DESC LIMIT 25"),
    };
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/event') {
      const e = await request.json().catch(() => null);
      if (!e) return json({ error: 'Dati mancanti' }, 400);
      const list = Array.isArray(e) ? e.slice(0, 20) : [e];
      for (const x of list) this.addEvent(x || {});
      return json({ ok: true });
    }
    if (url.pathname === '/stats') return json(this.stats());
    if (url.pathname === '/avatars') return json(this.avatarList(url.searchParams.get('all') === '1'));
    if (url.pathname === '/avatar-img') {
      const data = await this.ctx.storage.get('img:' + url.searchParams.get('id') + ':' + url.searchParams.get('kind'));
      if (!data) return new Response('', { status: 404 });
      const [head, b64] = data.split(',');
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      return new Response(bin, { headers: { 'content-type': head.slice(5, head.indexOf(';')), 'cache-control': 'public, max-age=31536000, immutable' } });
    }
    if (url.pathname === '/admin-avatars') {
      try { return json(await this.adminAvatars(await request.json())); } catch (e) { return json({ error: e.message || 'Errore' }, 400); }
    }
    if (url.pathname === '/room' && request.method === 'POST') { this.setRoom(await request.json().catch(() => null)); return json({ ok: true }); }
    if (url.pathname === '/live') return json(this.liveRooms());
    if (url.pathname === '/put') {
      const { id, record } = await request.json();
      if (!id || !record) return json({ error: 'Dati mancanti' }, 400);
      await this.ctx.storage.put('rec:' + String(id).slice(0, 80), record);
      this.cache = null;
      return json({ ok: true });
    }
    if (url.pathname === '/profiles') {
      if (!this.cache || Date.now() - this.cache.at > 60_000) {
        const all = await this.ctx.storage.list({ prefix: 'rec:' });
        const pr = AI.learnProfiles([...all.values()]);
        this.cache = { at: Date.now(), data: pr };
      }
      return json(this.cache.data);
    }
    return json({ error: 'Non trovato' }, 404);
  }
}

// ---------------------------------------------------------------- Stanza di gioco

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.turnMs = Number(env.TURN_MS || 60000); // tempo massimo per una mossa
    this.offlineMs = Number(env.OFFLINE_MS || 30000); // tempo per rientrare se si va offline
    this.proxyDelay = this.offlineMs;
    this.cpuDelay = Number(env.CPU_DELAY_MS || 5000); // attesa prima di ogni mossa delle CPU
    this.emptyClose = Number(env.EMPTY_CLOSE_MS || EMPTY_CLOSE);
    this.subMs = Number(env.SUB_MS || 7000); // dopo il subentro, attesa prima di ogni mossa al posto di chi è offline
    this.ctx.blockConcurrencyWhile(async () => {
      const st = await this.ctx.storage.get(['state', 'tokens', 'offline', 'rec', 'meta', 'chat']);
      this.state = st.get('state') || null;
      this.tokens = st.get('tokens') || {};
      this.offline = st.get('offline') || {};
      this.rec = st.get('rec') || {};
      this.meta = st.get('meta') || { gameNo: 0, cpuSeq: 0, nextAt: 0, lastActivity: Date.now() };
      this.chat = st.get('chat') || [];
      this.devices = (await this.ctx.storage.get('devices')) || {};
    });
  }

  async save() {
    this.meta.lastActivity = Date.now();
    if (this.state?.phase === 'finished' && this.meta.statEnd !== this.meta.gameNo) {
      this.meta.statEnd = this.meta.gameNo;
      await this.statGame('mp_end');
    }
    await this.ctx.storage.put({ state: this.state, tokens: this.tokens, offline: this.offline, rec: this.rec, meta: this.meta });
    await this.reschedule();
    await this.reportLive();
  }

  // Avvisa l'archivio di com'è la stanza, per l'elenco delle partite live (al massimo ogni 20 s
  // se non cambia niente di importante).
  async reportLive(gone = false) {
    const s = this.state;
    if (!s && !gone) return;
    const humans = s ? s.players.filter((p) => !p.cpu).length : 0;
    const info = gone ? { code: this.meta.code, phase: 'gone' } : {
      code: s.code, phase: s.phase, roundNo: s.roundNo, cards: s.round?.cards || null, humans,
      host: this.player(s.hostId)?.name || '', spectators: s.spectators.length,
      players: s.players.map((p) => ({ name: p.name, lives: p.lives, cpu: !!p.cpu, out: !!p.eliminated })),
      online: this.connectedSet().size,
      open: s.phase === 'lobby' && s.players.length < E.MAX_PLAYERS,
    };
    if (s) this.meta.code = s.code;
    const sig = JSON.stringify(info);
    const now = Date.now();
    if (sig === this.meta.liveSig && now - (this.meta.liveAt || 0) < 20_000) return;
    this.meta.liveSig = sig; this.meta.liveAt = now;
    try { await archive(this.env).fetch('https://a/room', { method: 'POST', body: sig }); } catch {}
  }

  // Turno da 1 carta: finite le chiamate si scoprono tutte le carte. L'asso di denari lo
  // decide la CPU (o chi la sostituisce); una persona sceglie da sé.
  reveal() {
    const s = this.state;
    if (!s?.round || s.phase !== 'playing' || s.round.cards !== 1) return;
    E.revealOneCard(s, (pid) => (this.isCpu(pid) ? AI.decideJolly(s, pid) : undefined));
  }

  async closeRoom() {
    for (const ws of this.ctx.getWebSockets()) { try { ws.close(1000, 'Stanza chiusa'); } catch {} }
    await this.reportLive(true);
    await this.ctx.storage.deleteAll();
    this.state = null;
  }

  // Un solo allarme: la prossima mossa della CPU (o il turno automatico) oppure la pulizia.
  async reschedule() {
    let cleanup = this.meta.lastActivity + CLEANUP_AFTER;
    if (this.meta.emptySince) cleanup = Math.min(cleanup, this.meta.emptySince + this.emptyClose + 1000);
    const at = this.meta.nextAt ? Math.min(this.meta.nextAt, cleanup) : cleanup;
    await this.ctx.storage.setAlarm(at);
  }

  async alarm() {
    if (!this.state) return;
    const now = Date.now();
    // nessuno collegato da 5 minuti: la stanza si chiude per sempre
    if (this.meta.emptySince && now - this.meta.emptySince >= this.emptyClose && this.connectedSet().size === 0) return this.closeRoom();
    if (this.meta.nextAt && now >= this.meta.nextAt - 25) {
      this.meta.nextAt = 0;
      try { this.autoStep(); this.reveal(); } catch (e) { console.error(e); }
      this.planNext();
      await this.save();
      this.broadcast();
      return;
    }
    if (now - this.meta.lastActivity >= CLEANUP_AFTER) {
      for (const ws of this.ctx.getWebSockets()) ws.close(1000, 'Stanza scaduta');
      await this.reportLive(true);
      await this.ctx.storage.deleteAll();
      this.state = null;
      return;
    }
    await this.reschedule();
  }

  player(id) { return this.state.players.find((p) => p.id === id); }
  isCpu(id) { return !!this.player(id)?.cpu; }

  connectedSet() {
    const set = new Set();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const a = ws.deserializeAttachment();
      if (a?.pid) set.add(a.pid);
    }
    return set;
  }

  // Scadenza della mossa di un giocatore: un minuto dall'inizio del turno; se è offline,
  // 30 secondi per rientrare (sempre dentro il minuto). Allo scadere gioca la CPU per lui.
  // Dopo il primo subentro (chi è offline non ha giocato nei 30 secondi) la CPU continua
  // al suo posto con 7 secondi per mossa, finché il giocatore non si ricollega.
  deadlineFor(pid, connected = this.connectedSet()) {
    const r = this.state.round;
    const start = r.turnStartedAt || Date.now();
    let d = start + this.turnMs;
    if (!connected.has(pid)) {
      if (this.meta.subbed?.[pid]) return start + this.subMs;
      d = Math.min(d, Math.max(start, this.offline[pid] || start) + this.offlineMs);
    }
    return d;
  }

  // Decide quando deve muoversi la CPU (o partire il turno successivo da solo).
  planNext(justFinishedTrick = false) {
    const s = this.state;
    this.meta.nextAt = 0;
    if (!s) return;
    const humansAlive = s.players.filter((p) => !p.cpu && !p.eliminated);
    const fast = humansAlive.length === 0 ? 0.5 : 1;
    if (s.phase === 'calling' || s.phase === 'playing') {
      const r = s.round;
      const actor = r.pendingJolly || r.turnId;
      if (actor && this.isCpu(actor)) {
        const base = Math.max(this.cpuDelay, justFinishedTrick ? 1700 : 0);
        this.meta.nextAt = Date.now() + base * fast;
      } else if (actor) this.meta.nextAt = this.deadlineFor(actor);
    } else if (s.phase === 'roundEnd') {
      const connected = this.connectedSet();
      const waiting = humansAlive.filter((p) => connected.has(p.id) && !s.ready.includes(p.id));
      if (!waiting.length) this.meta.nextAt = Date.now() + (humansAlive.length ? 1500 : 3000);
    }
  }

  cpuCfg(pid, level) {
    const p = this.player(pid);
    const models = {};
    for (const q of this.state.players) if (!q.cpu) models[q.id] = AI.profileFor(this.profiles, { device: this.devices[q.id], name: q.name });
    return { level: level || p.cpu?.level || 'medio', persona: p.cpu?.persona || AI.makePersona(rng), rng, models };
  }

  // Mossa automatica: CPU di turno, oppure turno successivo quando tutti sono pronti.
  autoStep() {
    const s = this.state;
    if (s.phase === 'roundEnd') { E.nextRound(s, { rng }); return; }
    if (s.phase !== 'calling' && s.phase !== 'playing') return;
    const r = s.round;
    const pid = r.pendingJolly || r.turnId;
    if (this.isCpu(pid)) return this.cpuMove(pid);
    // tempo scaduto: la CPU gioca al posto del giocatore
    const connected = this.connectedSet();
    if (pid && Date.now() >= this.deadlineFor(pid, connected) - 50) {
      if (!connected.has(pid)) (this.meta.subbed ||= {})[pid] = true;
      this.cpuMove(pid, 'medio');
    }
  }

  cpuMove(pid, level) {
    const s = this.state;
    const r = s.round;
    const cfg = this.cpuCfg(pid, level);
    if (s.phase === 'calling') E.makeCall(s, pid, AI.decideCall(s, pid, cfg));
    else if (r.pendingJolly === pid) E.chooseJolly(s, pid, AI.decideJolly(s, pid));
    else { const d = AI.decidePlay(s, pid, cfg); E.playCard(s, pid, d.card, d.jolly); }
  }

  newIdentity() {
    const id = randomId(5);
    const token = randomId(18);
    this.tokens[token] = id;
    return { id, token };
  }

  isMember(pid) {
    const s = this.state;
    return s.players.some((p) => p.id === pid && !p.cpu) || s.spectators.some((p) => p.id === pid);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const action = url.pathname.slice(1);
    try {
      if (action === 'init') {
        if (this.state) return json({ error: 'exists' }, 409);
        const body = await request.json();
        const who = this.newIdentity();
        this.state = E.createGame({ code: body.code, hostId: who.id, hostName: body.name });
        const pick0 = this.cleanPick(body.pick);
        if (pick0) this.state.players[0].avatar = { pick: pick0 };
        this.devices = { [who.id]: clip(body.device, 40) };
        this.meta.emptySince = Date.now();
        await this.ctx.storage.put('devices', this.devices);
        await this.save();
        await this.stat([{ type: 'room', device: body.device, name: body.name, game: body.code }]);
        return json({ code: body.code, playerId: who.id, token: who.token });
      }
      if (!this.state) return json({ error: 'Stanza non trovata. Controlla il codice.' }, 404);

      if (action === 'info') {
        const s = this.state;
        return json({
          code: s.code, phase: s.phase,
          players: s.players.map((p) => p.name),
          picks: [...s.players, ...s.spectators].filter((p) => p.avatar?.pick).map((p) => ({ pick: p.avatar.pick, name: p.name })),
          names: [...s.players, ...s.spectators].map((p) => p.name),
          canJoinAsPlayer: s.phase === 'lobby' && s.players.length < E.MAX_PLAYERS,
        });
      }

      if (action === 'join' && request.method === 'POST') {
        const body = await request.json();
        const s = this.state;
        if (body.as !== 'spectator' && s.phase !== 'lobby') return json({ error: 'La partita è già iniziata: puoi entrare come spettatore', started: true }, 400);
        const pick = this.cleanPick(body.pick); // lo stesso personaggio lo possono avere in tanti
        const who = this.newIdentity();
        if (body.as === 'spectator') E.addSpectator(s, { id: who.id, name: body.name });
        else E.addPlayer(s, { id: who.id, name: body.name });
        if (pick) this.member(who.id).avatar = { pick };
        this.devices[who.id] = clip(body.device, 40);
        await this.ctx.storage.put('devices', this.devices);
        await this.save();
        this.broadcast();
        return json({ code: s.code, playerId: who.id, token: who.token });
      }

      if (action === 'ws') {
        const pid = this.tokens[url.searchParams.get('token')];
        if (!pid || !this.isMember(pid)) return json({ error: 'Non fai parte di questa stanza' }, 403);
        if (request.headers.get('Upgrade') !== 'websocket') return json({ ok: true }, 426);
        const pair = new WebSocketPair();
        this.ctx.acceptWebSocket(pair[1], [pid]);
        pair[1].serializeAttachment({ pid });
        try { pair[1].send(JSON.stringify({ t: 'chatAll', msgs: this.chat })); } catch {}
        if (this.offline[pid]) delete this.offline[pid];
        if (this.meta.subbed?.[pid]) delete this.meta.subbed[pid];
        this.meta.emptySince = 0;
        this.planNext();
        await this.save();
        this.broadcast();
        return new Response(null, { status: 101, webSocket: pair[0] });
      }

      // il telefono è passato a un'altra stanza: esce da questa (se si può)
      if (action === 'leave' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const pid = this.tokens[body.token];
        if (pid && this.member(pid) && (this.state.phase === 'lobby' || this.state.phase === 'finished')) {
          await this.handle(pid, { t: 'leave' });
          await this.save();
          this.broadcast();
        }
        return json({ ok: true });
      }

      // foto profilo: caricata dall'app già ritagliata e rimpicciolita
      if (action === 'avatar' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const pid = this.tokens[body.token];
        const who = pid && this.member(pid);
        if (!who) return json({ error: 'Non fai parte di questa stanza' }, 403);
        if (body.clear) { delete who.avatar; await this.ctx.storage.delete('av:' + pid); }
        else if (body.pick) {
          who.avatar = { pick: this.cleanPick(body.pick) };
        }
        else {
          const data = String(body.data || '');
          if (!/^data:image\/(jpeg|webp|png);base64,/.test(data) || data.length > MAX_AVATAR) return json({ error: 'Foto non valida o troppo grande' }, 400);
          await this.ctx.storage.put('av:' + pid, data);
          who.avatar = { photo: Date.now() };
        }
        await this.save();
        this.broadcast();
        return json({ ok: true });
      }
      if (action === 'avatar') {
        const data = await this.ctx.storage.get('av:' + url.searchParams.get('pid'));
        if (!data) return new Response('', { status: 404 });
        const [head, b64] = data.split(',');
        const type = head.slice(5, head.indexOf(';'));
        const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        return new Response(bin, { headers: { 'content-type': type, 'cache-control': 'public, max-age=604800' } });
      }
    } catch (e) {
      if (e instanceof E.GameError) return json({ error: e.message }, 400);
      console.error(e);
      return json({ error: 'Errore del server' }, 500);
    }
    return json({ error: 'Non trovato' }, 404);
  }

  broadcast(skipWs, goneId) {
    if (!this.state) return;
    const connected = this.connectedSet();
    if (goneId) connected.delete(goneId);
    const now = Date.now();
    let deadline = null, deadlineFor = null;
    const st = this.state;
    if (st.round && (st.phase === 'calling' || st.phase === 'playing')) {
      const actor = st.round.pendingJolly || st.round.turnId;
      if (actor && !this.isCpu(actor)) { deadlineFor = actor; deadline = this.deadlineFor(actor, connected); }
    }
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === skipWs) continue;
      const a = ws.deserializeAttachment();
      if (!a?.pid) continue;
      if (!this.isMember(a.pid)) {
        try { ws.send(JSON.stringify({ t: 'kicked' })); ws.close(1000, 'kicked'); } catch {}
        continue;
      }
      try {
        ws.send(JSON.stringify({
          t: 'state', now, me: a.pid,
          s: E.maskState(this.state, a.pid),
          online: [...connected], offline: this.offline,
          proxyDelay: this.proxyDelay, hostTakeoverAfter: HOST_TAKEOVER_AFTER,
          deadline, deadlineFor,
        }));
      } catch {}
    }
  }

  async webSocketMessage(ws, raw) {
    const { pid } = ws.deserializeAttachment() || {};
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.t === 'ping') return ws.send(JSON.stringify({ t: 'pong', now: Date.now() }));
    if (msg.t === 'chat') {
      try { await this.chatMessage(pid, msg.text); } catch (e) { ws.send(JSON.stringify({ t: 'error', msg: e instanceof E.GameError ? e.message : 'Messaggio non inviato' })); }
      return;
    }
    try {
      const before = this.state.round ? { n: this.state.round.n, t: this.state.round.trickNo, phase: this.state.phase } : null;
      await this.handle(pid, msg);
      this.reveal();
      const r = this.state.round;
      const trickDone = !!(before && r && before.phase === 'playing' && (this.state.phase !== 'playing' || r.trickNo !== before.t || r.n !== before.n));
      this.planNext(trickDone);
      await this.save();
      this.broadcast();
    } catch (e) {
      const text = e instanceof E.GameError ? e.message : 'Errore imprevisto';
      if (!(e instanceof E.GameError)) console.error(e);
      ws.send(JSON.stringify({ t: 'error', msg: text }));
    }
  }

  pushEntry(pid, entry) {
    if (!entry) return;
    const rec = (this.rec[pid] ||= { calls: [], plays: [] });
    (entry.kind === 'call' ? rec.calls : rec.plays).push(entry.e);
  }

  // Personaggio già scelto da qualcun altro nella stanza?
  pickTaken(pick, exceptId) {
    const s = this.state;
    return [...s.players, ...s.spectators].find((p) => p.id !== exceptId && p.avatar?.pick === pick) || null;
  }
  cleanPick(v) { return v ? String(v).replace(/[^a-z0-9_-]/gi, '').slice(0, 40) : null; }

  member(pid) { return this.state.players.find((p) => p.id === pid && !p.cpu) || this.state.spectators.find((p) => p.id === pid); }

  // Chat della stanza: i tag @nome valgono per le persone presenti (non per le CPU).
  async chatMessage(pid, text) {
    const who = this.member(pid);
    if (!who) throw new E.GameError('Non fai parte della stanza');
    const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!t) return;
    const people = [...this.state.players.filter((p) => !p.cpu), ...this.state.spectators];
    const low = t.toLowerCase();
    const mentions = people.filter((p) => {
      const tag = '@' + p.name.toLowerCase();
      let i = low.indexOf(tag);
      while (i >= 0) {
        const after = low[i + tag.length];
        if (after === undefined || !/[\p{L}\p{N}_]/u.test(after)) return true;
        i = low.indexOf(tag, i + 1);
      }
      return false;
    }).map((p) => p.id);
    const m = { id: randomId(6), pid, name: who.name, text: t, at: Date.now(), mentions };
    this.chat.push(m);
    if (this.chat.length > CHAT_KEEP) this.chat = this.chat.slice(-CHAT_KEEP);
    this.meta.lastActivity = Date.now();
    await this.ctx.storage.put({ chat: this.chat, meta: this.meta });
    const out = JSON.stringify({ t: 'chat', msg: m });
    for (const ws of this.ctx.getWebSockets()) { try { ws.send(out); } catch {} }
  }

  recordEntry(pid, kind, data) {
    const p = this.player(pid);
    if (!p || p.cpu || !this.state.round) return null;
    const r = this.state.round;
    if (r.turnId !== pid && r.pendingJolly !== pid) return null;
    const rec = { calls: [], plays: [] };
    if (kind === 'call') {
      const e = { cards: r.cards, n: r.seats.length, call: data.n, dealer: r.dealerId === pid, pos: r.seats.indexOf(pid) };
      if (r.cards === 1) { e.visible = r.seats.filter((id) => id !== pid).map((id) => r.hands[id][0]); e.pool = 40 - e.visible.length; }
      else e.hand = r.hands[pid].slice();
      rec.calls.push(e);
    } else if (kind === 'play' && r.cards > 1) {
      const h = r.hands[pid];
      const low = Math.min(...h.map((c) => (c === E.JOLLY ? 0 : c + 1)));
      const sv = data.card === E.JOLLY ? (data.jolly === 'high' ? 41 : 0) : data.card + 1;
      rec.plays.push({ trick: r.trickNo, options: h.length, lowest: sv === low, need: (r.calls[pid] ?? 0) - r.won[pid] });
    }
    if (rec.calls.length) return { kind: 'call', e: rec.calls[0] };
    if (rec.plays.length) return { kind: 'play', e: rec.plays[0] };
    return null;
  }

  // Statistiche: inizio e fine di ogni partita della stanza.
  async stat(events) {
    try { await archive(this.env).fetch('https://a/event', { method: 'POST', body: JSON.stringify(events) }); } catch {}
  }

  async statGame(kind) {
    const s = this.state;
    const humans = s.players.filter((p) => !p.cpu);
    const game = `${s.code}-${this.meta.gameNo}`;
    const ev = [{ type: kind, game, players: s.players.length, humans: humans.length, rounds: kind === 'mp_end' ? s.roundNo : null, device: this.devices[s.hostId] }];
    if (kind === 'mp_start') for (const p of humans) ev.push({ type: 'mp_seat', game, name: p.name, device: this.devices[p.id], players: s.players.length });
    await this.stat(ev);
  }

  async pushRecords() {
    const s = this.state;
    const jobs = [];
    for (const [pid, rec] of Object.entries(this.rec)) {
      const p = this.player(pid);
      if (!p || (!rec.calls.length && !rec.plays.length)) continue;
      const record = { v: 1, player: p.name, device: this.devices[pid] || null, level: 'online', at: Date.now(), players: s.players.length, rounds: s.roundNo, calls: rec.calls, plays: rec.plays };
      jobs.push(archive(this.env).fetch('https://a/put', { method: 'POST', body: JSON.stringify({ id: `${s.code}-${this.meta.gameNo}-${pid}`, record }) }).catch(() => {}));
    }
    await Promise.all(jobs);
  }

  async loadProfiles() {
    try {
      const res = await archive(this.env).fetch('https://a/profiles');
      this.profiles = await res.json();
    } catch { this.profiles = null; }
  }

  async handle(pid, msg) {
    const s = this.state;
    const now = Date.now();
    const isHost = pid === s.hostId;
    const needHost = () => { if (!isHost) throw new E.GameError("Solo chi ha creato la stanza può farlo"); };
    const me = this.player(pid);

    switch (msg.t) {
      // ---- sala d'attesa
      case 'start':
        needHost();
        await this.loadProfiles();
        for (const p of s.players) if (p.cpu) p.cpu.persona = AI.makePersona(rng);
        this.rec = {};
        this.meta.gameNo += 1;
        E.startGame(s, { rng, now });
        await this.statGame('mp_start');
        return;
      case 'addCpu': {
        needHost();
        if (s.phase !== 'lobby') throw new E.GameError('Le CPU si aggiungono in sala d\'attesa');
        const level = LEVELS.includes(msg.level) ? msg.level : 'medio';
        const n = Math.max(1, Math.min(12, Number(msg.n) || 1));
        for (let i = 0; i < n; i++) {
          if (s.players.length >= E.MAX_PLAYERS) throw new E.GameError(`Massimo ${E.MAX_PLAYERS} al tavolo`);
          let name;
          do { this.meta.cpuSeq += 1; name = 'CPU' + this.meta.cpuSeq; } while (s.players.some((p) => p.name.toLowerCase() === name.toLowerCase()));
          E.addPlayer(s, { id: 'cpu' + randomId(3), name, cpu: { level } });
        }
        return;
      }
      case 'cpuLevel': {
        needHost();
        const p = this.player(msg.pid);
        if (!p?.cpu) throw new E.GameError('Non è una CPU');
        if (s.phase !== 'lobby') throw new E.GameError('Il livello si cambia in sala d\'attesa');
        p.cpu.level = LEVELS.includes(msg.level) ? msg.level : p.cpu.level;
        return;
      }
      case 'remove':
        needHost();
        if (msg.pid === s.hostId) throw new E.GameError('Non puoi togliere te stesso');
        if (s.phase === 'lobby') E.removeFromLobby(s, msg.pid);
        else E.setKick(s, msg.pid, true);
        return;
      case 'unkick':
        needHost();
        E.setKick(s, msg.pid, false);
        return;
      case 'rename':
        E.renamePlayer(s, pid, msg.name);
        return;
      case 'leave': {
        // uscita dalla stanza (in sala d'attesa o a partita finita)
        if (s.phase !== 'lobby' && s.phase !== 'finished') throw new E.GameError('Durante la partita non puoi uscire dalla stanza');
        if (s.phase === 'finished') E.resetToLobby(s);
        const humans = s.players.filter((p) => !p.cpu && p.id !== pid);
        if (pid === s.hostId) {
          if (!humans.length) { s.players = s.players.filter((p) => !p.cpu); }
          else s.hostId = humans[0].id;
        }
        s.players = s.players.filter((p) => p.id !== pid);
        s.spectators = s.spectators.filter((p) => p.id !== pid);
        return;
      }
      case 'toLobby':
        if (s.phase === 'finished') E.resetToLobby(s);
        return;

      // ---- partita
      case 'call': {
        const entry = this.recordEntry(pid, 'call', { n: Number(msg.n) });
        E.makeCall(s, pid, Number(msg.n), { now });
        this.pushEntry(pid, entry);
        return;
      }
      case 'play': {
        const card = s.round?.cards === 1 ? s.round.hands[pid]?.[0] : msg.card;
        const entry = this.recordEntry(pid, 'play', { card, jolly: msg.jolly });
        E.playCard(s, pid, card, msg.jolly, { now });
        this.pushEntry(pid, entry);
        if (s.phase === 'roundEnd' || s.phase === 'finished') await this.pushRecords();
        return;
      }
      case 'jolly':
        E.chooseJolly(s, pid, msg.v, { now });
        if (s.phase === 'roundEnd' || s.phase === 'finished') await this.pushRecords();
        return;
      case 'ready': {
        if (s.phase !== 'roundEnd') return;
        E.setReady(s, pid);
        return;
      }
      case 'force':
        needHost();
        E.nextRound(s, { rng, now });
        return;
      case 'cpuFor': {
        // chi ha creato la stanza fa giocare la CPU al posto di un giocatore offline
        needHost();
        const r = s.round;
        if (!r || !['calling', 'playing'].includes(s.phase)) throw new E.GameError('Nessun turno in corso');
        const target = r.pendingJolly || r.turnId;
        if (msg.pid !== target) throw new E.GameError('Non è il suo turno');
        if (this.connectedSet().has(target)) throw new E.GameError('Il giocatore è collegato');
        const since = Math.max(r.turnStartedAt, this.offline[target] || 0);
        if (now - since < this.proxyDelay) throw new E.GameError('Aspetta ancora qualche secondo');
        this.cpuMove(target, 'medio');
        return;
      }
      // ---- angelo custode: chi guarda chiede di vedere le carte di un giocatore
      case 'peekAsk':
        E.askPeek(s, pid, msg.pid, now);
        return;
      case 'peekAnswer':
        E.answerPeek(s, pid, msg.viewer, !!msg.ok, now);
        return;
      case 'claimHost': {
        if (!me || me.cpu) throw new E.GameError('Solo un giocatore può diventare admin');
        if (this.connectedSet().has(s.hostId)) throw new E.GameError("L'admin è collegato");
        if (now - (this.offline[s.hostId] || 0) < HOST_TAKEOVER_AFTER) throw new E.GameError("Aspetta: l'admin potrebbe rientrare");
        s.hostId = pid;
        return;
      }
      default:
        throw new E.GameError('Azione sconosciuta');
    }
  }

  async markOffline(ws) {
    const a = ws.deserializeAttachment();
    if (!a?.pid || !this.state) return;
    const stillOn = this.ctx.getWebSockets(a.pid).some((w) => w !== ws && w.readyState === WebSocket.OPEN);
    if (!stillOn) this.offline[a.pid] = Date.now();
    const anyone = this.ctx.getWebSockets().some((w) => w !== ws && w.readyState === WebSocket.OPEN);
    if (!anyone) this.meta.emptySince = Date.now();
    this.planNext();
    await this.save();
    this.broadcast(ws, stillOn ? null : a.pid);
  }

  async webSocketClose(ws, code) {
    await this.markOffline(ws);
    try { ws.close(code === 1005 ? 1000 : code, 'bye'); } catch {}
  }

  async webSocketError(ws) {
    await this.markOffline(ws);
  }
}
