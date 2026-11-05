// Motore delle regole del gioco "Bisca".
// Logica pura: nessuna dipendenza da Cloudflare, così si può testare con Node.
//
// Carte: numeri da 0 a 39.  seme = floor(c / 10), valore = c % 10 + 1
//   semi in ordine di forza: 0 bastoni < 1 spade < 2 coppe < 3 denari
//   valori: 1 asso ... 7, 8 fante, 9 cavallo, 10 re
// La forza di una carta è c + 1 (da 1 = asso di bastoni a 40 = re di denari).
// L'asso di denari (30) è il jolly: vale 0 (sotto tutto) o 41 (sopra tutto).

export const SUITS = ['bastoni', 'spade', 'coppe', 'denari'];
export const RANKS = ['Asso', '2', '3', '4', '5', '6', '7', 'Fante', 'Cavallo', 'Re'];
export const JOLLY = 30;
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 13;
export const START_LIVES = 3;

export class GameError extends Error {}

export const suitOf = (c) => Math.floor(c / 10);
export const rankOf = (c) => (c % 10) + 1;
export const cardName = (c) => `${RANKS[c % 10]} di ${SUITS[suitOf(c)]}`;

export function strength(card, jolly) {
  if (card === JOLLY) {
    if (jolly === 'high') return 41;
    if (jolly === 'low') return 0;
    return null;
  }
  return card + 1;
}

export function maxCardsFor(n) {
  return Math.min(5, Math.floor(40 / n));
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const player = (s, id) => s.players.find((p) => p.id === id);
export const alivePlayers = (s) => s.order.filter((id) => !player(s, id).eliminated);

// Prossimo giocatore vivo dopo `id` seguendo l'ordine al tavolo (salta gli eliminati).
export function nextAlive(s, id) {
  const n = s.order.length;
  const start = s.order.indexOf(id);
  for (let k = 1; k <= n; k++) {
    const cand = s.order[(start + k) % n];
    if (!player(s, cand).eliminated) return cand;
  }
  return null;
}

// Ordine di gioco dentro un turno: parte da `first` e gira tra i partecipanti del turno.
function seatAfter(round, id) {
  const i = round.seats.indexOf(id);
  return round.seats[(i + 1) % round.seats.length];
}

// ---------------------------------------------------------------- creazione

export function createGame({ code, hostId, hostName, now = Date.now() }) {
  const s = {
    code,
    createdAt: now,
    hostId,
    phase: 'lobby', // lobby | calling | playing | roundEnd | finished
    players: [],
    spectators: [],
    order: [],
    maxCards: null,
    bonusZeroUsed: false,
    round: null,
    roundNo: 0,
    history: [],
    winners: null,
    ready: [],
  };
  addPlayer(s, { id: hostId, name: hostName });
  return s;
}

function cleanName(name) {
  const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 22);
  if (!n) throw new GameError('Scegli un nickname');
  return n;
}

function nameTaken(s, name) {
  const l = name.toLowerCase();
  return [...s.players, ...s.spectators].some((p) => p.name.toLowerCase() === l);
}

export function addPlayer(s, { id, name, cpu = null }) {
  if (s.phase !== 'lobby') throw new GameError('La partita è già iniziata: puoi entrare come spettatore');
  if (s.players.length >= MAX_PLAYERS) throw new GameError(`Massimo ${MAX_PLAYERS} giocatori`);
  const n = cleanName(name);
  if (nameTaken(s, n)) throw new GameError('Nickname già usato in questa partita');
  s.players.push({ id, name: n, lives: START_LIVES, eliminated: false, kicked: false, kickPending: false, outRound: null, cpu });
  return s;
}

// Cambio nome, solo in sala d'attesa.
export function renamePlayer(s, id, name) {
  if (s.phase !== 'lobby') throw new GameError('Il nome si cambia solo in sala d\'attesa');
  const p = s.players.find((x) => x.id === id) || s.spectators.find((x) => x.id === id);
  if (!p) throw new GameError('Giocatore non trovato');
  const n = cleanName(name);
  const l = n.toLowerCase();
  if ([...s.players, ...s.spectators].some((x) => x.id !== id && x.name.toLowerCase() === l)) throw new GameError('Nickname già usato in questa partita');
  p.name = n;
  return s;
}

// Fine partita: si torna in sala d'attesa con gli stessi giocatori (CPU comprese).
export function resetToLobby(s) {
  if (s.phase !== 'finished') throw new GameError('La partita non è finita');
  const names = (s.winners || []).map((id) => s.players.find((p) => p.id === id)?.name).filter(Boolean);
  s.lastWinners = names;
  s.players = s.players.filter((p) => !p.kicked);
  for (const p of s.players) Object.assign(p, { lives: START_LIVES, eliminated: false, kicked: false, kickPending: false, outRound: null });
  Object.assign(s, { phase: 'lobby', order: [], maxCards: null, bonusZeroUsed: false, round: null, roundNo: 0, history: [], winners: null, ready: [], firstDealer: null, peek: {} });
  return s;
}

// Lo stato visto da un utente: le carte che non deve vedere diventano -1, e non partono
// proprio dal server (chi smanetta non trova niente da leggere).
// Chi guarda (spettatori ed eliminati) vede solo le carte giocate, più la mano del
// giocatore che gli ha dato il permesso ("angelo custode"), tranne nel turno da 1 carta.
export function maskState(s, viewerId) {
  const m = JSON.parse(JSON.stringify(s));
  for (const p of m.players) if (p.cpu) p.cpu = { level: p.cpu.level };
  const r = m.round;
  if (!r) return m;
  const live = m.phase === 'calling' || m.phase === 'playing';
  const me = m.players.find((p) => p.id === viewerId);
  const inRound = !!(me && !me.eliminated && r.seats.includes(viewerId));
  const peek = !inRound && m.peek?.[viewerId]?.status === 'ok' ? m.peek[viewerId].target : null;
  for (const id of Object.keys(r.hands)) {
    let visible;
    if (!inRound) visible = id === peek && !(live && r.cards === 1);
    else if (id === viewerId) visible = !(live && r.cards === 1);
    else visible = live && r.cards === 1;
    if (!visible) r.hands[id] = r.hands[id].map(() => -1);
  }
  return m;
}

// ---- "angelo custode": chi guarda chiede a un giocatore di vedere le sue carte
export const PEEK_TTL = 30_000;
const canWatch = (s, id) => s.spectators.some((x) => x.id === id) || !!s.players.find((p) => p.id === id && p.eliminated);

export function askPeek(s, viewerId, targetId, now = Date.now()) {
  if (s.phase === 'lobby' || s.phase === 'finished') throw new GameError('Si può chiedere solo durante la partita');
  if (!canWatch(s, viewerId)) throw new GameError('Puoi chiedere solo se stai guardando');
  const t = s.players.find((p) => p.id === targetId);
  if (!t || t.cpu || t.eliminated) throw new GameError('Puoi chiederlo solo a un giocatore ancora in gioco');
  s.peek ||= {};
  const cur = s.peek[viewerId] || { declined: [] };
  const curTarget = cur.target && s.players.find((p) => p.id === cur.target);
  if (cur.status === 'ok' && curTarget && !curTarget.eliminated) throw new GameError(`Stai già guardando le carte di ${curTarget.name}`);
  if (cur.status === 'pending' && now - cur.at < PEEK_TTL) throw new GameError('Aspetta la risposta alla richiesta che hai fatto');
  if (cur.declined.includes(targetId)) throw new GameError(`${t.name} ha già detto di no`);
  s.peek[viewerId] = { target: targetId, status: 'pending', at: now, declined: cur.declined };
  return s;
}

export function answerPeek(s, targetId, viewerId, ok, now = Date.now()) {
  const cur = s.peek?.[viewerId];
  if (!cur || cur.target !== targetId || cur.status !== 'pending') throw new GameError('Richiesta non più valida');
  if (now - cur.at > PEEK_TTL + 5000) { delete s.peek[viewerId].target; cur.status = null; throw new GameError('Richiesta scaduta'); }
  if (ok) Object.assign(cur, { status: 'ok', at: now });
  else Object.assign(cur, { status: null, target: null, declined: [...cur.declined, targetId] });
  return s;
}

export function addSpectator(s, { id, name }) {
  const n = cleanName(name);
  if (nameTaken(s, n)) throw new GameError('Nickname già usato in questa partita');
  s.spectators.push({ id, name: n });
  return s;
}

export function removeFromLobby(s, id) {
  if (s.phase !== 'lobby') throw new GameError('Si può togliere qualcuno dalla sala solo prima di iniziare');
  if (id === s.hostId) throw new GameError("L'admin non può togliersi");
  s.players = s.players.filter((p) => p.id !== id);
  s.spectators = s.spectators.filter((p) => p.id !== id);
  return s;
}

// ---------------------------------------------------------------- partita

export function startGame(s, { rng = Math.random, now = Date.now() } = {}) {
  if (s.phase !== 'lobby') throw new GameError('La partita è già iniziata');
  const n = s.players.length;
  if (n < MIN_PLAYERS) throw new GameError(`Servono almeno ${MIN_PLAYERS} giocatori`);
  // Sorteggio dei posti al tavolo: resta fisso fino alla fine.
  s.order = shuffle(s.players.map((p) => p.id), rng);
  s.maxCards = maxCardsFor(n);
  // Sorteggio del primo mazziere.
  const firstDealer = s.order[Math.floor(rng() * n)];
  s.firstDealer = firstDealer;
  startRound(s, { cards: s.maxCards, dealerId: firstDealer, rng, now });
  return s;
}

function startRound(s, { cards, dealerId, rng, now }) {
  const alive = alivePlayers(s);
  // Turno da N carte: servono N carte per ognuno (il massimo è già calcolato per stare nel mazzo).
  const deck = shuffle([...Array(40).keys()], rng);
  const seats = [];
  // seats = ordine di gioco del turno partendo dal giocatore dopo il mazziere, mazziere ultimo.
  let cur = nextAlive(s, dealerId);
  for (let i = 0; i < alive.length; i++) {
    seats.push(cur);
    cur = nextAlive(s, cur);
  }
  const hands = {};
  seats.forEach((id, i) => {
    hands[id] = deck.slice(i * cards, (i + 1) * cards).sort((a, b) => a - b);
  });
  s.roundNo += 1;
  s.round = {
    n: s.roundNo,
    cards,
    dealerId,
    seats,
    hands,
    calls: {},
    won: Object.fromEntries(seats.map((id) => [id, 0])),
    turnId: seats[0],
    turnStartedAt: now,
    trick: { leader: seats[0], plays: [] },
    trickNo: 1,
    lastTrick: null,
    played: [], // tutte le carte uscite nel turno (mani completate)
    playedBy: {}, // carte uscite per giocatore
    tricks: [], // storico delle mani del turno
    pendingJolly: null,
    proxy: null,
    results: null,
  };
  s.ready = [];
  s.phase = 'calling';
}

export function forbiddenCall(s) {
  const r = s.round;
  if (!r || s.phase !== 'calling' || r.turnId !== r.dealerId) return null;
  const sum = Object.values(r.calls).reduce((a, b) => a + b, 0);
  const f = r.cards - sum;
  return f >= 0 && f <= r.cards ? f : null;
}

function setTurn(s, id, now) {
  s.round.turnId = id;
  s.round.turnStartedAt = now;
  s.round.proxy = null;
}

export function makeCall(s, pid, n, { now = Date.now() } = {}) {
  const r = s.round;
  if (s.phase !== 'calling') throw new GameError('Non è il momento delle chiamate');
  if (r.turnId !== pid) throw new GameError('Non tocca a te chiamare');
  if (!Number.isInteger(n) || n < 0 || n > r.cards) throw new GameError(`Chiamata non valida (da 0 a ${r.cards})`);
  if (pid === r.dealerId && n === forbiddenCall(s)) {
    throw new GameError(`Il mazziere non può chiamare ${n}: la somma farebbe ${r.cards}`);
  }
  r.calls[pid] = n;
  if (pid === r.dealerId) {
    s.phase = 'playing';
    setTurn(s, r.seats[0], now);
  } else {
    setTurn(s, seatAfter(r, pid), now);
  }
  return s;
}

export function playCard(s, pid, card, jolly, { now = Date.now() } = {}) {
  const r = s.round;
  if (s.phase !== 'playing') throw new GameError('Non è il momento di giocare');
  if (r.pendingJolly) throw new GameError("Si aspetta la scelta sull'asso di denari");
  if (r.turnId !== pid) throw new GameError('Non tocca a te');
  const hand = r.hands[pid];
  if (r.cards === 1) card = hand[0]; // nel turno da 1 non vedi la tua carta: giochi quella
  if (!hand.includes(card)) throw new GameError('Non hai questa carta');
  if (jolly !== undefined && jolly !== null && jolly !== 'high' && jolly !== 'low') throw new GameError('Valore jolly non valido');
  r.hands[pid] = hand.filter((c) => c !== card);
  const play = { pid, card };
  if (card === JOLLY) {
    if (jolly) play.jolly = jolly;
    else {
      r.trick.plays.push(play);
      r.pendingJolly = pid;
      r.turnStartedAt = now;
      return s;
    }
  }
  r.trick.plays.push(play);
  return advance(s, pid, now);
}

export function chooseJolly(s, pid, v, { now = Date.now() } = {}) {
  const r = s.round;
  if (s.phase !== 'playing' || r.pendingJolly !== pid) throw new GameError("Non c'è nessun asso di denari da decidere");
  if (v !== 'high' && v !== 'low') throw new GameError('Scegli alta o bassa');
  const play = r.trick.plays.find((p) => p.card === JOLLY);
  play.jolly = v;
  r.pendingJolly = null;
  return advance(s, pid, now);
}

function advance(s, pid, now) {
  const r = s.round;
  if (r.trick.plays.length < r.seats.length) {
    setTurn(s, seatAfter(r, pid), now);
    return s;
  }
  // Mano completa: prende la carta più forte.
  let best = r.trick.plays[0];
  for (const p of r.trick.plays) if (strength(p.card, p.jolly) > strength(best.card, best.jolly)) best = p;
  r.won[best.pid] += 1;
  r.lastTrick = { no: r.trickNo, plays: r.trick.plays, winner: best.pid };
  for (const p of r.trick.plays) { r.played.push(p.card); (r.playedBy[p.pid] ||= []).push(p.card); }
  (r.tricks ||= []).push({ plays: r.trick.plays.map((p) => ({ pid: p.pid, card: p.card, jolly: p.jolly })), winner: best.pid });
  r.trickNo += 1;
  if (r.hands[r.seats[0]].length === 0) return endRound(s, now);
  r.trick = { leader: best.pid, plays: [] };
  setTurn(s, best.pid, now);
  return s;
}

function endRound(s, now) {
  const r = s.round;
  const results = {};
  for (const id of r.seats) {
    const p = player(s, id);
    const call = r.calls[id];
    const won = r.won[id];
    const lost = Math.abs(call - won);
    const bonus3 = call === 3 && won === 3 ? 1 : 0;
    const before = p.lives;
    p.lives = Math.max(0, p.lives - lost + bonus3);
    results[id] = { call, won, lost, bonus3, before, after: p.lives, zeroBonus: false, eliminated: false };
  }
  const atZero = r.seats.filter((id) => player(s, id).lives === 0);
  if (atZero.length) {
    if (!s.bonusZeroUsed) {
      // Il primo (o i primi, se insieme) ad arrivare a 0 ricevono la vita bonus.
      s.bonusZeroUsed = true;
      for (const id of atZero) {
        player(s, id).lives = 1;
        results[id].after = 1;
        results[id].zeroBonus = true;
      }
    } else {
      for (const id of atZero) {
        const p = player(s, id);
        p.eliminated = true;
        p.outRound = r.n;
        results[id].eliminated = true;
      }
    }
  }
  r.results = results;
  r.turnId = null;
  r.proxy = null;
  s.history.push({
    n: r.n,
    cards: r.cards,
    dealerId: r.dealerId,
    results: Object.fromEntries(Object.entries(results).map(([id, x]) => [id, { call: x.call, won: x.won, after: x.after, zeroBonus: x.zeroBonus, bonus3: x.bonus3, eliminated: x.eliminated }])),
  });
  const alive = alivePlayers(s);
  if (alive.length <= 1) {
    finish(s, alive.length === 1 ? alive : r.seats.filter((id) => results[id].eliminated));
  } else {
    s.phase = 'roundEnd';
    s.ready = [];
  }
  return s;
}

function finish(s, winners) {
  s.phase = 'finished';
  s.winners = winners;
}

export function nextCardsCount(s) {
  const r = s.round;
  if (r.cards > 1) return r.cards - 1;
  return maxCardsFor(alivePlayers(s).length);
}

export function nextRound(s, { rng = Math.random, now = Date.now() } = {}) {
  if (s.phase !== 'roundEnd') throw new GameError('Il turno non è finito');
  // Le espulsioni decise durante il turno scattano adesso.
  for (const p of s.players) {
    if (p.kickPending && !p.eliminated) {
      p.eliminated = true;
      p.kicked = true;
      p.kickPending = false;
      p.outRound = s.round.n;
    }
  }
  const alive = alivePlayers(s);
  if (alive.length <= 1) {
    finish(s, alive);
    return s;
  }
  const cards = Math.min(nextCardsCount(s), maxCardsFor(alive.length));
  startRound(s, { cards, dealerId: nextAlive(s, s.round.dealerId), rng, now });
  return s;
}

export function setReady(s, pid) {
  if (s.phase !== 'roundEnd') throw new GameError('Il turno non è finito');
  if (!s.ready.includes(pid)) s.ready.push(pid);
  return s;
}

export function setKick(s, pid, on) {
  const p = player(s, pid);
  if (!p) throw new GameError('Giocatore non trovato');
  if (p.eliminated) throw new GameError('Giocatore già fuori dal gioco');
  p.kickPending = !!on;
  return s;
}

// ---------------------------------------------------------------- vista per ogni utente

// Restituisce lo stato visto da `viewerId`, senza le carte che non deve vedere.
// opts: { connected: Set di id online, disconnectedAt: {id: ts}, now, proxyDelay }
export function viewFor(s, viewerId, opts = {}) {
  const { connected = new Set(), disconnectedAt = {}, now = Date.now() } = opts;
  const r = s.round;
  const me = player(s, viewerId);
  const spect = s.spectators.find((x) => x.id === viewerId);
  const inRound = !!(r && me && r.seats.includes(viewerId) && !me.eliminated && ['calling', 'playing'].includes(s.phase));
  const watcher = !inRound; // spettatore, eliminato, o tra un turno e l'altro
  const oneCard = r && r.cards === 1;
  const live = ['calling', 'playing'].includes(s.phase);

  const players = s.players.map((p) => {
    const inThis = r && r.seats.includes(p.id);
    const v = {
      id: p.id,
      name: p.name,
      lives: p.lives,
      eliminated: p.eliminated,
      kicked: p.kicked,
      kickPending: p.kickPending,
      outRound: p.outRound,
      online: connected.has(p.id),
      offlineSince: connected.has(p.id) ? null : disconnectedAt[p.id] || null,
      seat: s.order.indexOf(p.id),
      inRound: !!inThis,
    };
    if (inThis) {
      v.call = r.calls[p.id] ?? null;
      v.won = r.won[p.id];
      v.handCount = r.hands[p.id].length;
      // Turno da 1: tutti vedono le carte degli altri. Spettatori/eliminati possono vedere tutto (coperto di default).
      if (live && p.id !== viewerId && (oneCard || watcher)) v.hand = r.hands[p.id];
    }
    return v;
  });
  players.sort((a, b) => (a.seat === -1 ? 99 : a.seat) - (b.seat === -1 ? 99 : b.seat));

  const view = {
    code: s.code,
    phase: s.phase,
    hostId: s.hostId,
    now,
    me: {
      id: viewerId,
      name: me ? me.name : spect ? spect.name : '?',
      role: me ? 'player' : 'spectator',
      isHost: viewerId === s.hostId,
      eliminated: me ? me.eliminated : false,
      inRound,
    },
    players,
    spectators: s.spectators.map((x) => ({ id: x.id, name: x.name, online: connected.has(x.id) })),
    maxCards: s.maxCards,
    bonusZeroUsed: s.bonusZeroUsed,
    history: s.history,
    winners: s.winners,
    ready: s.ready,
    round: null,
  };

  if (r) {
    view.round = {
      n: r.n,
      cards: r.cards,
      dealerId: r.dealerId,
      seats: r.seats,
      turnId: r.turnId,
      turnStartedAt: r.turnStartedAt,
      trick: r.trick,
      trickNo: r.trickNo,
      lastTrick: r.lastTrick,
      pendingJolly: r.pendingJolly,
      proxy: r.proxy,
      results: r.results,
      forbidden: forbiddenCall(s),
      callSum: Object.values(r.calls).reduce((a, b) => a + b, 0),
      nextCards: s.phase === 'roundEnd' ? Math.min(nextCardsCount(s), maxCardsFor(alivePlayers(s).length)) : null,
    };
    if (inRound) {
      view.myHand = oneCard && live ? null : r.hands[viewerId];
      view.myHandCount = r.hands[viewerId].length;
    }
    // L'admin che gioca al posto di un assente vede le sue carte.
    if (r.proxy && viewerId === s.hostId && live) {
      view.proxyHand = r.hands[r.proxy];
    }
  }
  return view;
}

// Turno da 1 carta: finite le chiamate le carte si scoprono tutte insieme, nell'ordine del giro.
// jollyFor(pid) dice alta o bassa per chi ha l'asso di denari (CPU); se torna undefined
// la scelta resta in sospeso finché quel giocatore non la fa.
export function revealOneCard(s, jollyFor = () => undefined, { now = Date.now() } = {}) {
  const r = s.round;
  let guard = 20;
  while (s.phase === 'playing' && r.cards === 1 && !r.pendingJolly && guard-- > 0) {
    const pid = r.turnId;
    const c = r.hands[pid][0];
    playCard(s, pid, c, c === JOLLY ? jollyFor(pid) : undefined, { now });
  }
  return s;
}
