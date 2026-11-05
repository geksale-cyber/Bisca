// Tasti rapidi PARCHEGGIO e PRESA: quale carta giocare.
// Logica pura (niente schermo), così si prova con Node.
//
// Regole del gioco che contano qui: si può tirare qualsiasi carta, prende la più forte.
// Chi gioca dopo può solo alzare la carta migliore, quindi una carta più bassa della
// migliore sul tavolo di sicuro non prende. L'asso di denari (30) vale 41 se alto, 0 se basso.

import { JOLLY, strength } from './engine.js';

const str = (c) => (c === JOLLY ? 41 : c + 1); // forza "per prendere" (asso alto)

// Situazione vista da `me` nel turno in corso.
export function situation(r, me) {
  const hand = (r.hands[me] || []).filter((c) => c >= 0);
  let best = -1;
  for (const p of r.trick.plays) best = Math.max(best, strength(p.card, p.jolly) ?? -1);
  const seen = new Set([...hand, ...(r.played || []), ...r.trick.plays.map((p) => p.card)]);
  const unseen = [];
  for (let c = 0; c < 40; c++) if (!seen.has(c)) unseen.push(c); // anche le carte non distribuite: non si può sapere
  const call = r.calls[me] ?? 0;
  const sumCalls = Object.values(r.calls).reduce((a, b) => a + b, 0);
  return {
    hand, best, unseen,
    lead: r.trick.plays.length === 0,
    last: r.trick.plays.length === r.seats.length - 1,
    need: call - (r.won[me] || 0),
    over: sumCalls > r.cards, // più prese chiamate che mani: qualcuno resterà a secco
  };
}

// Una carta normale prende di sicuro: batte il tavolo e nessuna carta ancora in gioco
// (asso di denari compreso, che può essere giocato alto) può superarla dopo di me.
function sure(c, st) {
  if (str(c) <= st.best) return false;
  if (st.last) return true;
  return !st.unseen.some((u) => str(u) > str(c));
}

// Quante carte ancora in gioco battono questa: meno sono, più vale per le prese future.
const threats = (c, st) => st.unseen.filter((u) => str(u) > str(c)).length;

export function parkPick(st) {
  const normal = st.hand.filter((c) => c !== JOLLY).sort((a, b) => a - b);
  const hasJ = st.hand.includes(JOLLY);
  // apri tu la mano: la carta più bassa (l'asso basso solo se non hai altro)
  if (st.lead) return normal.length ? { card: normal[0] } : hasJ ? { card: JOLLY, jolly: 'low' } : { none: 'Nessuna carta' };
  const safe = normal.filter((c) => str(c) < st.best);
  if (!safe.length) return hasJ ? { card: JOLLY, jolly: 'low' } : { none: 'Nessuna resta sotto' };
  if (st.need > 0) {
    // tengo da parte le carte migliori per le prese che mancano (una in più se le chiamate superano le mani)
    const keepN = st.need + (st.over ? 1 : 0);
    const keep = new Set(normal.slice().sort((a, b) => threats(a, st) - threats(b, st) || b - a).slice(0, keepN));
    const free = safe.filter((c) => !keep.has(c));
    if (free.length) return { card: free.sort((a, b) => threats(b, st) - threats(a, st) || a - b)[0] }; // la più scarsa
    return { card: safe[0] }; // tutte le sicure servirebbero: sacrifico la più bassa
  }
  // a posto o sforato: mi libero della carta sicura più alta, quella che più avanti mi farebbe prendere
  return { card: safe[safe.length - 1] };
}

export function takePick(st) {
  if (st.need <= 0) return { none: st.need === 0 ? 'Sei a posto' : 'Hai sforato', warn: true };
  const normal = st.hand.filter((c) => c !== JOLLY).sort((a, b) => a - b);
  const winners = normal.filter((c) => str(c) > st.best);
  if (!winners.length) return { none: st.hand.includes(JOLLY) ? "Solo l'asso" : 'Nessuna prende' };
  const top = winners[winners.length - 1];
  // ultima presa che mi serve: uso la più alta, così dopo mi restano le basse da parcheggiare
  if (st.need === 1) return { card: top, sure: sure(top, st) };
  // me ne servono altre: se c'è una presa sicura la faccio con la più bassa e tengo le alte
  const certain = winners.filter((c) => sure(c, st));
  if (certain.length) return { card: certain[0], sure: true };
  return { card: top, sure: false };
}

export function quickPicks(r, me) {
  const st = situation(r, me);
  return { park: parkPick(st), take: takePick(st), st };
}
