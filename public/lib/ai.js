// CPU di Bisca.
//
// La CPU vede solo quello che vedrebbe un giocatore vero: la sua mano (tranne nel
// turno da 1, dove vede le carte degli altri e non la sua), le chiamate, le prese
// e le carte già uscite.
//
// Tre capacità:
// 1. Contare le carte: sa quali carte sono uscite e quante ne restano in giro.
// 2. Leggere le chiamate: quando immagina le mani degli altri tiene di più quelle
//    coerenti con quello che hanno chiamato (chi chiama 1 probabilmente ha una
//    carta forte; la chiamata forzata del mazziere conta meno).
// 3. Conoscere le persone: ogni giocatore ha un profilo (chiama alto o basso
//    rispetto alle carte, apre basso o no), imparato dalle partite registrate.
//
// Gioca con prudenza: apre basso, prende quando è sicuro o quando serve, scarica
// le carte alte quando qualcun altro sta già prendendo. Il carattere (prudente o
// spavaldo) e la situazione (vite, mazziere) spostano quanto rischia.

import { JOLLY, forbiddenCall } from './engine.js';

// ---------------------------------------------------------------- utilità

export function makeRng(seed) {
  let x = (seed >>> 0) || 0x9e3779b9;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    return x / 4294967296;
  };
}

function gauss(rng) {
  const u = Math.max(rng(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

function shuffleIn(a, rng) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// parametri della prudenza (tarati con i tornei CPU contro CPU)
export const TUNE = { theta: 0.75, thetaRisk: 0.22, thetaPressure: 0.35, boldLead: 0.2, boldLeadHold: 0.88, afterNoNeed: 0.25, harm: 0.06 };
const str = (c, j) => (c === JOLLY ? (j === 'low' ? 0 : 41) : c + 1);

// funzione di ripartizione normale
function phi(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

function pNoneHigher(U, H, k) {
  if (k <= 0 || H <= 0) return 1;
  if (k > U - H) return 0;
  let p = 1;
  for (let i = 0; i < k; i++) p *= (U - H - i) / (U - i);
  return p;
}

// ---------------------------------------------------------------- stima "a occhio"

// Mani che una mano "dovrebbe" prendere contando solo la forza delle carte.
// È il metro su cui si misura come chiama ogni giocatore.
export function baseEstimate(hand, nPlayers) {
  const U = 40 - hand.length;
  const hasJ = hand.includes(JOLLY);
  let sum = 0;
  for (const c of hand) {
    if (c === JOLLY) { sum += 1; continue; }
    let H = hasJ ? 0 : 1;
    for (let x = c + 1; x < 40; x++) if (x !== JOLLY && !hand.includes(x)) H++;
    sum += pNoneHigher(U, H, nPlayers - 1);
  }
  return sum;
}

// Turno da 1: probabilità che la propria carta (che non si vede) batta quelle visibili.
export function oneCardEstimate(visible, poolSize) {
  if (visible.includes(JOLLY)) return 0.02;
  const best = Math.max(...visible.map((c) => c + 1));
  let higher = 0;
  for (let c = 0; c < 40; c++) {
    if (visible.includes(c)) continue;
    if (c === JOLLY || c + 1 > best) higher++;
  }
  return higher / Math.max(1, poolSize);
}

// ---------------------------------------------------------------- profili

// Profilo di partenza ("buon senso"): chiama vicino alla forza delle carte.
export const GENERIC = { callBias: 0, callStd: 0.7, firstLow: null, samples: { calls: 0, firstTricks: 0 } };
// Compatibilità con la versione precedente.
export const GENERIC_GROUP = GENERIC;

function statsOf(records, filter) {
  let bSum = 0, bSq = 0, bN = 0, lowK = 0, lowN = 0, games = 0, decisions = 0;
  for (const g of records) {
    if (filter && !filter(g)) continue;
    games++;
    for (const c of g.calls || []) {
      let base;
      if (c.cards === 1 && c.visible) base = oneCardEstimate(c.visible, c.pool || 40 - c.visible.length);
      else if (c.hand) base = baseEstimate(c.hand, c.n);
      else continue;
      const d = c.call - base;
      bSum += d; bSq += d * d; bN++; decisions++;
    }
    for (const p of g.plays || []) {
      decisions++;
      if (p.trick === 1 && p.options > 1) { lowN++; if (p.lowest) lowK++; }
    }
  }
  return { bSum, bSq, bN, lowK, lowN, games, decisions };
}

function blend(st, prior, K) {
  const bias = (st.bSum + prior.callBias * K) / (st.bN + K);
  const varEmp = st.bN > 1 ? Math.max(0, st.bSq / st.bN - (st.bSum / st.bN) ** 2) : prior.callStd ** 2;
  const std = Math.sqrt((varEmp * st.bN + prior.callStd ** 2 * K) / (st.bN + K));
  const pFL = prior.firstLow ?? 0.5;
  const firstLow = st.lowN ? (st.lowK + pFL * K) / (st.lowN + K) : prior.firstLow;
  return {
    callBias: bias, callStd: clamp(std, 0.35, 1.5), firstLow,
    games: st.games, decisions: st.decisions,
    samples: { calls: st.bN, firstTricks: st.lowN },
    raw: { callBias: st.bN ? st.bSum / st.bN : null, firstLow: st.lowN ? st.lowK / st.lowN : null },
  };
}

const keyOf = (name) => String(name || '').trim().toLowerCase();
// Ogni persona ha il suo profilo legato al telefono (due "Marco" diversi restano distinti);
// le partite vecchie senza telefono restano legate al nome.
const recKey = (g) => (g.device ? 'd:' + g.device : keyOf(g.player));

// Dalle partite registrate: il profilo del gruppo e uno per ogni giocatore.
// Ogni profilo parte dal gruppo e se ne stacca man mano che i suoi dati crescono.
export function learnProfiles(records) {
  const group = blend(statsOf(records), GENERIC, 12);
  const names = new Set(records.map(recKey).filter(Boolean));
  const byName = {};
  for (const n of names) byName[n] = blend(statsOf(records, (g) => recKey(g) === n), group, 8);
  return { group, byName };
}
// who: { device, name } oppure solo il nome
export const profileFor = (profiles, who) => {
  const w = typeof who === 'object' && who ? who : { name: who };
  return (w.device && profiles?.byName?.['d:' + w.device]) || profiles?.byName?.[keyOf(w.name)] || profiles?.group || GENERIC;
};

// Compatibilità: modello del solo gruppo.
export const learnGroup = (records) => learnProfiles(records).group;

// Probabilità che un giocatore con questo profilo chiami `call` avendo questa mano.
export function callLikelihood(model, base, cards, call, forbidden) {
  const mu = base + model.callBias;
  const sd = model.callStd;
  const P = (c) => {
    if (c < 0 || c > cards) return 0;
    const lo = c === 0 ? 0 : phi((c - 0.5 - mu) / sd);
    const hi = c === cards ? 1 : phi((c + 0.5 - mu) / sd);
    return hi - lo;
  };
  let p = P(call);
  if (forbidden != null) p /= Math.max(1e-6, 1 - P(forbidden)); // chiamata forzata: dice meno
  return 0.03 + 0.97 * p; // mai zero: le persone sorprendono
}

// ---------------------------------------------------------------- carattere

export function makePersona(rng) {
  return {
    risk: (rng() * 2 - 1) * 0.6, // < 0 prudente, > 0 spavaldo
    cunning: 0.4 + rng() * 0.6, // quanto si fida dei profili imparati
  };
}

function situationalRisk(persona, lives, isDealer, bonusZeroUsed) {
  let r = persona?.risk ?? 0;
  if (lives <= 1 && bonusZeroUsed) r -= 0.6;
  else if (lives <= 1) r -= 0.2;
  if (lives >= 4) r += 0.3;
  if (isDealer) r += 0.2;
  return clamp(r, -1, 1);
}

const LEVELS = {
  facile: { callSims: 0, playSims: 0, read: false, temp: 0.7, blunder: 0.2 },
  medio: { callSims: 90, playSims: 0, read: true, temp: 0.3, blunder: 0.03 },
  difficile: { callSims: 240, playSims: 120, read: true, temp: 0.12, blunder: 0 },
};

// ---------------------------------------------------------------- politica di gioco

// Probabilità che una carta di forza `s` regga contro chi gioca dopo.
// Conta solo le carte che il giocatore non vede; chi non ha bisogno di prese
// difficilmente la supera (pesa poco).
function holdProb(s, hand, gone, goneN, after) {
  if (s >= 41) return 1;
  const U = 40 - hand.length - goneN;
  if (U <= 0) return 1;
  let H = 0;
  for (let c = s; c < 40; c++) if (c !== JOLLY && !gone[c] && !hand.includes(c)) H++;
  if (!gone[JOLLY] && !hand.includes(JOLLY)) H++;
  let k = 0;
  for (const a of after) k += a.need > 0 ? a.count : a.count * TUNE.afterNoNeed;
  if (k <= 0) return 1;
  return Math.pow(Math.max(0, U - H) / U, k);
}

// Sceglie una carta. Restituisce {i, j}: indice in mano e valore del jolly.
// o = {hand, need, tricksLeft, best, after:[{need,count}], allOthers:[{need,count}],
//      gone (Uint8Array 40), goneN, risk, trickNo, firstLow, rng}
export function chooseCard(o) {
  const { hand, need, tricksLeft, best, after, rng } = o;
  if (hand.length === 1) {
    const c = hand[0];
    return { i: 0, j: c === JOLLY ? (need > 0 ? 'high' : 'low') : undefined };
  }
  const leading = best < 0;
  // abitudine personale: in prima mano tira la più bassa
  if (o.firstLow != null && o.trickNo === 1 && rng() < o.firstLow * 0.5) {
    return lowestIdx(hand);
  }
  const ji = hand.indexOf(JOLLY);
  const normal = [];
  for (let i = 0; i < hand.length; i++) if (i !== ji) normal.push(i);
  normal.sort((a, b) => hand[a] - hand[b]); // dalla più bassa alla più alta
  const hold = (i) => holdProb(hand[i] + 1, hand, o.gone, o.goneN, after);
  const holdAll = (i) => holdProb(hand[i] + 1, hand, o.gone, o.goneN, o.allOthers);
  const lowest = () => (normal.length ? { i: normal[0] } : { i: ji, j: 'low' });
  const highest = () => (normal.length ? { i: normal[normal.length - 1] } : { i: ji, j: 'high' });

  if (need > 0) {
    const urgent = need >= tricksLeft;
    // L'asso di denari alto è una presa sicura. Conviene usarlo quando le altre carte non
    // bastano per le prese che mancano e il resto della mano non rischia di prendere
    // (allora tanto vale subito, magari sul re di chi ha osato); altrimenti si tiene,
    // perché da basso è anche il parcheggio perfetto.
    // Se si usa prima dell'ultima mano, le altre carte devono essere perdenti sicure al 100%:
    // se poi tutti parcheggiano, anche un 3 di coppe si prende l'ultima.
    const restCertain = normal.every((i) => certainLoser(hand[i], hand, o.gone, o.allOthers.length + 1));
    const jollyOk = ji >= 0 && (urgent || tricksLeft === 1 || (need >= 1 && restCertain));
    if (leading) {
      if (urgent) {
        const top = normal[normal.length - 1];
        if (top !== undefined && (ji < 0 || holdAll(top) >= 0.9)) return { i: top };
        return ji >= 0 ? { i: ji, j: 'high' } : highest();
      }
      // si apre basso e si lascia prendere; lo spavaldo apre con una carta sicura
      if (o.risk > TUNE.boldLead && normal.length) {
        const top = normal[normal.length - 1];
        if (holdAll(top) > TUNE.boldLeadHold) return { i: top };
      }
      return lowest();
    }
    const win = normal.filter((i) => hand[i] + 1 > best);
    // con una sola presa da fare si prende con la più alta: dopo restano carte basse
    const pickWin = (list) => (need === 1 ? list[list.length - 1] : list[0]);
    if (after.length === 0) {
      if (win.length) return { i: pickWin(win) };
      if (jollyOk) return { i: ji, j: 'high' };
      return park(hand, normal, ji, best, need);
    }
    if (urgent) {
      const sure = win.filter((i) => hold(i) >= 0.8);
      if (sure.length) return { i: sure[sure.length - 1] };
      if (ji >= 0) return { i: ji, j: 'high' };
      return win.length ? { i: win[win.length - 1] } : lowest();
    }
    const pressure = need / tricksLeft;
    const theta = clamp(TUNE.theta - TUNE.thetaRisk * o.risk - TUNE.thetaPressure * pressure, 0.3, 0.95);
    const good = win.filter((i) => hold(i) >= theta);
    if (good.length) return { i: pickWin(good) };
    if (jollyOk) return { i: ji, j: 'high' };
    return park(hand, normal, ji, best, need);
  }

  // non vuole prendere: parcheggio, la più alta che resta sotto
  const losers = normal.filter((i) => hand[i] + 1 < best);
  if (losers.length) return { i: losers[losers.length - 1] };
  if (leading) {
    if (ji >= 0 && (!normal.length || hand[normal[0]] > 19)) return { i: ji, j: 'low' };
    return lowest();
  }
  if (ji >= 0) return { i: ji, j: 'low' };
  // tutte le carte prendono: se nessuno dopo ha bisogno di prese la mano è sua comunque,
  // tanto vale liberarsi della più alta e restare con carte basse
  if (after.every((a) => a.need <= 0)) return highest();
  return lowest();
}

// Una carta che non può prendere in nessun caso: per vincere una mano dovrebbe essere la più
// alta, quindi tutte le altre carte giocate dovrebbero essere più basse. Se in giro non ci sono
// abbastanza carte più basse (asso di denari basso compreso), è una perdente sicura.
export function certainLoser(c, hand, gone, n) {
  if (c === JOLLY) return false;
  let lower = 0;
  for (let x = 0; x < c; x++) if (x !== JOLLY && !gone[x] && !hand.includes(x)) lower++;
  if (!gone[JOLLY] && !hand.includes(JOLLY)) lower++;
  return lower < n - 1;
}

// Parcheggio per chi deve ancora prendere: si libera della carta più alta che resta
// sotto il tavolo, tenendo da parte le carte migliori che gli servono per le prese.
function park(hand, normal, ji, best, need) {
  const losers = normal.filter((i) => hand[i] + 1 < best);
  if (!losers.length) return normal.length ? { i: normal[0] } : { i: ji, j: 'low' };
  const reserved = new Set(normal.slice(Math.max(0, normal.length - Math.max(0, need - (ji >= 0 ? 1 : 0)))));
  const free = losers.filter((i) => !reserved.has(i));
  return { i: free.length ? free[free.length - 1] : losers[0] };
}

function lowestIdx(hand) {
  let li = 0;
  for (let i = 1; i < hand.length; i++) if (str(hand[i], 'low') < str(hand[li], 'low')) li = i;
  return hand[li] === JOLLY ? { i: li, j: 'low' } : { i: li };
}

// ---------------------------------------------------------------- vista della CPU

function knowledge(s, pid) {
  const r = s.round;
  const seats = r.seats;
  const me = seats.indexOf(pid);
  const one = r.cards === 1;
  const trickCards = Object.fromEntries(r.trick.plays.map((p) => [p.pid, p.card]));
  const played = [...r.played, ...r.trick.plays.map((p) => p.card)];
  const hands = seats.map((id) => {
    if (id === pid) return one ? null : r.hands[id].slice();
    return one ? r.hands[id].slice() : null;
  });
  const counts = seats.map((id) => r.hands[id].length);
  const seen = new Set(played);
  hands.forEach((h) => h && h.forEach((c) => seen.add(c)));
  const unknown = [];
  for (let c = 0; c < 40; c++) if (!seen.has(c)) unknown.push(c);
  const player = (id) => s.players.find((p) => p.id === id);
  // carte già giocate da ciascuno in questo turno (per ricostruire la mano iniziale)
  const usedBy = seats.map((id) => [...(r.playedBy?.[id] || []), ...(id in trickCards ? [trickCards[id]] : [])]);
  // chiamate e se erano forzate (il mazziere)
  const calls = seats.map((id) => r.calls[id] ?? null);
  let sumBeforeDealer = 0;
  for (let i = 0; i < seats.length - 1; i++) sumBeforeDealer += calls[i] ?? 0;
  const dealerForbidden = r.cards - sumBeforeDealer >= 0 ? r.cards - sumBeforeDealer : null;
  return {
    r, seats, me, one, hands, counts, unknown, usedBy, calls,
    won: seats.map((id) => r.won[id]),
    lives: seats.map((id) => player(id).lives),
    trickPlays: r.trick.plays.map((p) => ({ seat: seats.indexOf(p.pid), s: str(p.card, p.jolly), c: p.card })),
    leader: seats.indexOf(r.trick.leader),
    tricksLeft: r.cards - (r.trickNo - 1),
    played,
    dealerForbidden,
    bonusZeroUsed: s.bonusZeroUsed,
  };
}

// Una distribuzione a caso delle carte che non si vedono.
function sampleOnce(k, rng) {
  const pool = shuffleIn(k.unknown.slice(), rng);
  let i = 0;
  return k.hands.map((h, seat) => {
    if (h) return h.slice();
    const n = k.counts[seat];
    const out = pool.slice(i, i + n);
    i += n;
    return out;
  });
}

// Distribuzioni coerenti con le chiamate fatte (campionamento pesato).
function sampleDeals(k, N, models, read, rng) {
  const n = k.seats.length;
  const callers = [];
  if (read) for (let i = 0; i < n; i++) if (i !== k.me && k.calls[i] != null) callers.push(i);
  if (!callers.length) return Array.from({ length: N }, () => sampleOnce(k, rng));
  const M = N * 3;
  const deals = [], w = [];
  let tot = 0;
  for (let m = 0; m < M; m++) {
    const d = sampleOnce(k, rng);
    let lw = 1;
    for (const i of callers) {
      const model = models[i] || GENERIC;
      let base;
      if (k.one) {
        const vis = [];
        for (let j = 0; j < n; j++) if (j !== i) vis.push(d[j][0] ?? k.usedBy[j][0]);
        base = oneCardEstimate(vis, 40 - vis.length);
      } else base = baseEstimate(d[i].concat(k.usedBy[i]), n);
      const forb = i === n - 1 ? k.dealerForbidden : null;
      lw *= callLikelihood(model, base, k.r.cards, k.calls[i], forb);
    }
    deals.push(d); w.push(lw); tot += lw;
  }
  // ricampionamento sistematico
  const out = [];
  const step = tot / N;
  let u = rng() * step, acc = w[0], j = 0;
  for (let t = 0; t < N; t++) {
    while (u > acc && j < M - 1) { j++; acc += w[j]; }
    out.push(deals[j].map((h) => h.slice()));
    u += step;
  }
  return out;
}

// ---------------------------------------------------------------- simulazione

// Gioca il turno fino alla fine. st: {hands, calls, won, leader, plays:[{seat,s,c}], trickNo, cards, gone(Uint8Array), goneN}
function playOut(st, n, risks, firstLows, rng) {
  const { hands, calls, won } = st;
  const gone = st.gone;
  let goneN = st.goneN;
  let plays = st.plays.slice();
  let leader = st.leader;
  let trickNo = st.trickNo;
  while (trickNo <= st.cards) {
    let seat = plays.length ? (plays[plays.length - 1].seat + 1) % n : leader;
    while (plays.length < n) {
      const h = hands[seat];
      let best = -1;
      for (const p of plays) if (p.s > best) best = p.s;
      const after = [], allOthers = [];
      for (let q = 1; q < n; q++) {
        const sq = (seat + q) % n;
        const e = { need: calls[sq] - won[sq], count: hands[sq].length };
        allOthers.push(e);
        if (q < n - plays.length) after.push(e);
      }
      const ch = chooseCard({
        hand: h, need: calls[seat] - won[seat], tricksLeft: st.cards - trickNo + 1, best, after, allOthers,
        gone, goneN, risk: risks[seat], trickNo, firstLow: firstLows[seat], rng,
      });
      const c = h[ch.i];
      h.splice(ch.i, 1);
      gone[c] = 1; goneN++;
      plays.push({ seat, s: str(c, ch.j), c });
      seat = (seat + 1) % n;
    }
    let w = plays[0];
    for (const p of plays) if (p.s > w.s) w = p;
    won[w.seat]++;
    leader = w.seat;
    plays = [];
    trickNo++;
  }
  return won;
}

function utility(lives, lost, bonus3, bonusZeroUsed, risk) {
  const after = lives - lost + bonus3;
  if (after <= 0) {
    if (!bonusZeroUsed) return 0.7; // si torna a 1 con la vita bonus
    return -2.5 + risk * 0.8; // eliminato
  }
  return after;
}

function softmaxPick(scores, temp, rng) {
  const m = Math.max(...scores.map((x) => x.v));
  const ws = scores.map((x) => Math.exp((x.v - m) / Math.max(temp, 1e-3)));
  const tot = ws.reduce((a, b) => a + b, 0);
  let u = rng() * tot;
  for (let i = 0; i < scores.length; i++) { u -= ws[i]; if (u <= 0) return scores[i].key; }
  return scores[scores.length - 1].key;
}

function sampleCall(model, base, cards, rng) {
  return clamp(Math.round(base + model.callBias + gauss(rng) * model.callStd), 0, cards);
}

// modelli per posto: profili imparati mescolati al buon senso secondo la furbizia
function seatModels(s, k, cfg, level) {
  const w = level === 'difficile' ? (cfg.persona?.cunning ?? 0.7) : level === 'medio' ? 0.4 : 0;
  return k.seats.map((id) => {
    const m = cfg.models?.[id];
    if (!m) return GENERIC;
    return {
      callBias: GENERIC.callBias * (1 - w) + m.callBias * w,
      callStd: GENERIC.callStd * (1 - w) + m.callStd * w,
      firstLow: m.firstLow != null && w > 0 ? m.firstLow * w : null,
    };
  });
}

function goneFlags(k) {
  const g = new Uint8Array(40);
  for (const c of k.played) g[c] = 1;
  return g;
}

// ---------------------------------------------------------------- decisioni

export function decideCall(s, pid, cfg) {
  const rng = cfg.rng || Math.random;
  const level = LEVELS[cfg.level] ? cfg.level : 'medio';
  const lv = LEVELS[level];
  const k = knowledge(s, pid);
  const { r, seats, me } = k;
  const n = seats.length;
  const cards = r.cards;
  const isDealer = pid === r.dealerId;
  const forbidden = isDealer ? forbiddenCall(s) : null;
  const options = [];
  for (let c = 0; c <= cards; c++) if (c !== forbidden) options.push(c);
  const risk = situationalRisk(cfg.persona, k.lives[me], isDealer, k.bonusZeroUsed);

  if (!lv.callSims) {
    const base = k.one ? oneCardEstimate(k.hands.filter(Boolean).flat(), k.unknown.length) : baseEstimate(k.hands[me], n);
    let c = clamp(Math.round(base + risk * 0.4 + gauss(rng) * 0.6), 0, cards);
    if (c === forbidden) c = c > 0 && (rng() < 0.5 || c === cards) ? c - 1 : c + 1;
    return c;
  }

  const models = seatModels(s, k, cfg, level);
  const N = lv.callSims;
  const deals = sampleDeals(k, N, models, lv.read, rng);
  const hits = Object.fromEntries(options.map((c) => [c, new Array(cards + 1).fill(0)]));
  const risks = seats.map((_, i) => (i === me ? risk : 0));
  const firstLows = models.map((m, i) => (i === me ? null : m.firstLow));
  for (const hands of deals) {
    // chiamate immaginate di chi viene dopo
    const calls = k.calls.slice();
    for (let seat = me + 1; seat < n; seat++) {
      let base;
      if (k.one) base = oneCardEstimate(hands.filter((_, i) => i !== seat).map((h) => h[0]), 40 - (n - 1));
      else base = baseEstimate(hands[seat], n);
      calls[seat] = sampleCall(models[seat], base, cards, rng);
    }
    for (const myCall of options) {
      const cs = calls.slice();
      cs[me] = myCall;
      if (me < n - 1) {
        let sum = 0;
        for (let i = 0; i < n - 1; i++) sum += cs[i];
        if (sum + cs[n - 1] === cards) cs[n - 1] = cs[n - 1] > 0 && (rng() < 0.5 || cs[n - 1] === cards) ? cs[n - 1] - 1 : cs[n - 1] + 1;
      }
      const st = {
        hands: hands.map((h) => h.slice()), calls: cs, won: new Array(n).fill(0),
        leader: 0, plays: [], trickNo: 1, cards, gone: new Uint8Array(40), goneN: 0,
      };
      const won = playOut(st, n, risks, firstLows, rng)[me];
      hits[myCall][Math.min(won, cards)]++;
    }
  }
  const scores = options.map((c) => {
    let ev = 0, ev2 = 0;
    for (let w2 = 0; w2 <= cards; w2++) {
      const p = hits[c][w2] / deals.length;
      const u = utility(k.lives[me], Math.abs(c - w2), c === 3 && w2 === 3 ? 1 : 0, k.bonusZeroUsed, risk);
      ev += p * u; ev2 += p * u * u;
    }
    const sd = Math.sqrt(Math.max(0, ev2 - ev * ev));
    return { key: c, v: ev + risk * 0.25 * sd + risk * 0.12 * c };
  });
  return softmaxPick(scores, lv.temp, rng);
}

export function decideJolly(s, pid) {
  const r = s.round;
  return (r.calls[pid] ?? 0) - r.won[pid] > 0 ? 'high' : 'low';
}

export function decidePlay(s, pid, cfg) {
  const rng = cfg.rng || Math.random;
  const level = LEVELS[cfg.level] ? cfg.level : 'medio';
  const lv = LEVELS[level];
  const r = s.round;
  const hand = r.hands[pid];
  if (r.cards === 1) return { card: hand[0], jolly: undefined };
  const k = knowledge(s, pid);
  const { me, seats } = k;
  const n = seats.length;
  const isDealer = r.dealerId === pid;
  const risk = situationalRisk(cfg.persona, k.lives[me], isDealer, k.bonusZeroUsed);

  if (lv.blunder && rng() < lv.blunder) {
    const c = hand[Math.floor(rng() * hand.length)];
    return { card: c, jolly: c === JOLLY ? (rng() < 0.5 ? 'high' : 'low') : undefined };
  }

  let best = -1;
  for (const p of k.trickPlays) if (p.s > best) best = p.s;
  const gone = goneFlags(k);
  const after = [], allOthers = [];
  for (let q = 1; q < n; q++) {
    const sq = (me + q) % n;
    const e = { need: k.calls[sq] - k.won[sq], count: k.counts[sq] };
    allOthers.push(e);
    if (q < n - k.trickPlays.length) after.push(e);
  }
  const base = { need: k.calls[me] - k.won[me], tricksLeft: k.tricksLeft, best, after, allOthers, gone, goneN: k.played.length, risk, trickNo: r.trickNo, firstLow: null, rng };

  if (!lv.playSims || hand.length === 1) {
    const ch = chooseCard({ ...base, hand: hand.slice() });
    return { card: hand[ch.i], jolly: ch.j };
  }

  // difficile: prova ogni carta su distribuzioni coerenti con le chiamate
  const cands = [];
  // l'asso alto prima dell'ultima mano solo se il resto della mano non può prendere in nessun caso
  const needMe = k.calls[me] - k.won[me];
  const restCertain = hand.every((c) => c === JOLLY || certainLoser(c, hand, gone, n));
  const jollyHighOk = k.tricksLeft === 1 || needMe >= k.tricksLeft || restCertain;
  for (const c of hand) {
    if (c === JOLLY) { if (jollyHighOk) cands.push({ c, j: 'high' }); cands.push({ c, j: 'low' }); }
    else cands.push({ c });
  }
  const models = seatModels(s, k, cfg, level);
  const deals = sampleDeals(k, lv.playSims, models, true, rng);
  const risks = seats.map((_, i) => (i === me ? risk : 0));
  const firstLows = models.map((m, i) => (i === me ? null : m.firstLow));
  const sums = cands.map(() => 0);
  for (const hands of deals) {
    cands.forEach((cd, ci) => {
      const hs = hands.map((h) => h.slice());
      hs[me].splice(hs[me].indexOf(cd.c), 1);
      const g = gone.slice();
      g[cd.c] = 1;
      const plays = k.trickPlays.concat([{ seat: me, s: str(cd.c, cd.j), c: cd.c }]);
      const st = { hands: hs, calls: k.calls.slice(), won: k.won.slice(), leader: k.leader, plays, trickNo: r.trickNo, cards: r.cards, gone: g, goneN: k.played.length + 1 };
      const wonAll = playOut(st, n, risks, firstLows, rng);
      const won = wonAll[me];
      const lost = Math.abs(k.calls[me] - won);
      // si vince restando l'ultimo: a parità conviene che gli altri sbaglino (punire chi osa)
      let harm = 0;
      for (let q = 0; q < n; q++) if (q !== me) harm += Math.abs(st.calls[q] - wonAll[q]);
      sums[ci] += utility(k.lives[me], lost, k.calls[me] === 3 && won === 3 ? 1 : 0, k.bonusZeroUsed, risk) + TUNE.harm * harm;
    });
  }
  // nessuna regola fissa: vince la mossa che più spesso porta a fare esattamente le proprie prese
  const scores = cands.map((cd, i) => ({ key: i, v: sums[i] / deals.length }));
  const pick = cands[softmaxPick(scores, lv.temp * 0.4, rng)];
  return { card: pick.c, jolly: pick.j };
}

// ---------------------------------------------------------------- per il tutorial
// Quanto spesso ogni scelta porta a fare esattamente la propria chiamata, visto da chi gioca
// (le carte degli altri immaginate in modo coerente con le chiamate). options: [{call}] o [{card, jolly}]
export function evaluateOptions(s, pid, options, N = 220, rng = Math.random) {
  const k = knowledge(s, pid);
  const { r, seats, me } = k;
  const n = seats.length, cards = r.cards;
  const models = seats.map(() => GENERIC);
  const deals = sampleDeals(k, N, models, true, rng);
  const risks = seats.map(() => 0);
  const firstLows = seats.map(() => null);
  const hit = options.map(() => 0);
  for (const hands of deals) {
    options.forEach((o, oi) => {
      if (o.call != null) {
        const calls = k.calls.slice();
        for (let seat = 0; seat < n; seat++) {
          if (seat === me || calls[seat] != null) continue;
          const base = k.one ? oneCardEstimate(hands.filter((_, i) => i !== seat).map((h) => h[0]), 40 - (n - 1)) : baseEstimate(hands[seat], n);
          calls[seat] = sampleCall(GENERIC, base, cards, rng);
        }
        calls[me] = o.call;
        const st = { hands: hands.map((h) => h.slice()), calls, won: new Array(n).fill(0), leader: 0, plays: [], trickNo: 1, cards, gone: new Uint8Array(40), goneN: 0 };
        if (playOut(st, n, risks, firstLows, rng)[me] === o.call) hit[oi]++;
      } else {
        const hs = hands.map((h) => h.slice());
        hs[me].splice(hs[me].indexOf(o.card), 1);
        const g = goneFlags(k); g[o.card] = 1;
        const plays = k.trickPlays.concat([{ seat: me, s: str(o.card, o.jolly), c: o.card }]);
        const st = { hands: hs, calls: k.calls.slice(), won: k.won.slice(), leader: k.leader, plays, trickNo: r.trickNo, cards, gone: g, goneN: k.played.length + 1 };
        if (playOut(st, n, risks, firstLows, rng)[me] === k.calls[me]) hit[oi]++;
      }
    });
  }
  return hit.map((h) => h / deals.length);
}
