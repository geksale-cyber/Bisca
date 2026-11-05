import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../public/lib/engine.js';

// rng deterministico
function seeded(seed) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    return x / 4294967296;
  };
}

function newGame(n, seed = 1) {
  const s = E.createGame({ code: 'TEST', hostId: 'p1', hostName: 'P1' });
  for (let i = 2; i <= n; i++) E.addPlayer(s, { id: 'p' + i, name: 'P' + i });
  E.startGame(s, { rng: seeded(seed) });
  return s;
}

// Imposta a mano un turno: ordine fisso p1..pn, mazziere e mani note.
function rigRound(s, dealerId, hands) {
  s.order = s.players.map((p) => p.id);
  const cards = Object.values(hands)[0].length;
  const seats = [];
  let cur = E.nextAlive(s, dealerId);
  for (let i = 0; i < E.alivePlayers(s).length; i++) { seats.push(cur); cur = E.nextAlive(s, cur); }
  s.round = {
    n: 1, cards, dealerId, seats, hands: structuredClone(hands), calls: {},
    won: Object.fromEntries(seats.map((id) => [id, 0])), turnId: seats[0], turnStartedAt: 0,
    trick: { leader: seats[0], plays: [] }, trickNo: 1, lastTrick: null, played: [], playedBy: {}, pendingJolly: null, proxy: null, results: null,
  };
  s.phase = 'calling';
}

const C = (rank, suit) => ['bastoni', 'spade', 'coppe', 'denari'].indexOf(suit) * 10 + rank - 1;

test('forza delle carte: asso di bastoni la più bassa, re di denari la più alta, semi in ordine', () => {
  assert.equal(E.strength(C(1, 'bastoni')), 1);
  assert.equal(E.strength(C(10, 'denari')), 40);
  assert.ok(E.strength(C(1, 'spade')) > E.strength(C(10, 'bastoni')));
  assert.ok(E.strength(C(1, 'coppe')) > E.strength(C(10, 'spade')));
  assert.ok(E.strength(C(2, 'denari')) > E.strength(C(10, 'coppe')));
  assert.equal(E.strength(E.JOLLY, 'high'), 41);
  assert.equal(E.strength(E.JOLLY, 'low'), 0);
  assert.equal(E.cardName(E.JOLLY), 'Asso di denari');
});

test('carte massime in base ai giocatori', () => {
  assert.deepEqual([3, 8, 9, 10, 11, 13].map(E.maxCardsFor), [5, 5, 4, 4, 3, 3]);
});

test('meno di 3 o più di 13 giocatori non si parte / non si entra', () => {
  const s = E.createGame({ code: 'X', hostId: 'p1', hostName: 'A' });
  E.addPlayer(s, { id: 'p2', name: 'B' });
  assert.throws(() => E.startGame(s), /almeno 3/);
  for (let i = 3; i <= 13; i++) E.addPlayer(s, { id: 'p' + i, name: 'N' + i });
  assert.throws(() => E.addPlayer(s, { id: 'p14', name: 'Z' }), /Massimo 13/);
  assert.throws(() => E.addSpectator(s, { id: 's', name: 'b' }), /già usato/);
});

test('chiamate: partono dopo il mazziere, il mazziere chiude e non può pareggiare il totale', () => {
  const s = newGame(4);
  rigRound(s, 'p1', { p1: [0, 1, 2], p2: [3, 4, 5], p3: [6, 7, 8], p4: [9, 10, 11] });
  assert.deepEqual(s.round.seats, ['p2', 'p3', 'p4', 'p1']);
  assert.throws(() => E.makeCall(s, 'p1', 1), /Non tocca/);
  E.makeCall(s, 'p2', 1);
  E.makeCall(s, 'p3', 0);
  E.makeCall(s, 'p4', 1);
  assert.equal(E.forbiddenCall(s), 1); // 3 carte, somma 2 -> vietato 1
  assert.throws(() => E.makeCall(s, 'p1', 1), /non può chiamare 1/);
  E.makeCall(s, 'p1', 0);
  assert.equal(s.phase, 'playing');
  assert.equal(s.round.turnId, 'p2'); // si tira dal giocatore dopo il mazziere
});

test('se le altre chiamate superano già le carte, il mazziere può chiamare tutto', () => {
  const s = newGame(3);
  rigRound(s, 'p1', { p1: [0, 1], p2: [2, 3], p3: [4, 5] });
  E.makeCall(s, 'p2', 2);
  E.makeCall(s, 'p3', 2);
  assert.equal(E.forbiddenCall(s), null);
  E.makeCall(s, 'p1', 0);
});

test('chi prende la mano apre la successiva (esempio: prende il 6, si riparte da 6,7,8,1...)', () => {
  const s = newGame(8);
  // p6 ha la carta più alta nella prima mano
  const hands = {};
  for (let i = 1; i <= 8; i++) hands['p' + i] = [i - 1, i + 9];
  hands.p6 = [39, 15];
  rigRound(s, 'p1', hands);
  for (const id of s.round.seats) E.makeCall(s, id, id === 'p1' ? 0 : 0);
  // ordine prima mano: 2..8 poi 1
  for (const id of ['p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p1']) {
    assert.equal(s.round.turnId, id);
    E.playCard(s, id, s.round.hands[id][0] === 39 ? 39 : s.round.hands[id][0]);
  }
  assert.equal(s.round.lastTrick.winner, 'p6');
  const order = [];
  while (s.phase === 'playing') { order.push(s.round.turnId); E.playCard(s, s.round.turnId, s.round.hands[s.round.turnId][0]); }
  assert.deepEqual(order, ['p6', 'p7', 'p8', 'p1', 'p2', 'p3', 'p4', 'p5']);
});

test('asso di denari: alto batte il re di denari, basso perde con l’asso di bastoni', () => {
  const s = newGame(3);
  rigRound(s, 'p3', { p1: [E.JOLLY], p2: [39], p3: [0] });
  // turno da 1: chiamate (seats p1,p2,p3)
  E.makeCall(s, 'p1', 1); E.makeCall(s, 'p2', 1);
  assert.equal(E.forbiddenCall(s), null); // 1 - 2 < 0
  E.makeCall(s, 'p3', 0);
  E.playCard(s, 'p1'); // nel turno da 1 non si sceglie la carta
  assert.equal(s.round.pendingJolly, 'p1');
  assert.throws(() => E.playCard(s, 'p2'), /asso di denari/);
  E.chooseJolly(s, 'p1', 'high');
  E.playCard(s, 'p2'); E.playCard(s, 'p3');
  assert.equal(s.round.lastTrick.winner, 'p1');

  const t = newGame(3);
  rigRound(t, 'p3', { p1: [E.JOLLY, 5], p2: [0, 6], p3: [1, 7] });
  E.makeCall(t, 'p1', 0); E.makeCall(t, 'p2', 0); E.makeCall(t, 'p3', 0);
  E.playCard(t, 'p1', E.JOLLY, 'low');
  E.playCard(t, 'p2', 0); E.playCard(t, 'p3', 1);
  assert.equal(t.round.lastTrick.winner, 'p3');
});

test('vite: si perde la differenza, mai sotto zero; bonus del 3; primo a zero prende la bonus', () => {
  const s = newGame(4);
  // p2 chiama 2 e prende 0 -> perde 2. p3 chiama 3 e prende 3 -> +1. p4 chiama 0 prende 0.
  rigRound(s, 'p1', {
    p1: [20, 21, 22, 23, 24], p2: [5, 6, 7, 8, 9], p3: [0, 1, 37, 38, 39], p4: [11, 12, 13, 14, 15],
  });
  s.players.find((p) => p.id === 'p2').lives = 1;
  E.makeCall(s, 'p2', 2); E.makeCall(s, 'p3', 3); E.makeCall(s, 'p4', 0);
  // somma 5 -> mazziere non può chiamare 0
  assert.equal(E.forbiddenCall(s), 0);
  E.makeCall(s, 'p1', 2);
  // Gioco: tutti tirano la carta più bassa, tranne p3 che tira alte nelle prime 3 e poi la più bassa
  while (s.phase === 'playing') {
    const id = s.round.turnId; const h = s.round.hands[id];
    let c = h[0];
    if (id === 'p3') c = s.round.trickNo <= 3 ? h[h.length - 1] : h[0];
    if (id === 'p4') c = h[0];
    if (id === 'p1') c = s.round.trickNo >= 4 ? h[h.length - 1] : h[0];
    E.playCard(s, id, c);
  }
  const res = s.round.results;
  assert.equal(res.p3.won, 3); assert.equal(res.p3.bonus3, 1); assert.equal(res.p3.after, 4);
  assert.equal(res.p2.won, 0); assert.equal(res.p2.lost, 2);
  // p2 aveva 1 vita, ne perde 2 -> 0 (non -1) -> primo a zero -> bonus
  assert.equal(res.p2.zeroBonus, true); assert.equal(res.p2.after, 1);
  assert.equal(s.bonusZeroUsed, true);
  assert.equal(s.phase, 'roundEnd');
});

test('dopo la bonus, chi va a zero è eliminato e il gioco salta gli eliminati; il ciclo carte continua', () => {
  const s = newGame(4, 7);
  s.bonusZeroUsed = true;
  s.players.find((p) => p.id === 'p3').lives = 1;
  rigRound(s, 'p1', { p1: [0, 1, 2], p2: [3, 4, 5], p3: [6, 7, 8], p4: [37, 38, 39] });
  // p3 chiama 1 ma ha carte basse: perde
  E.makeCall(s, 'p2', 0); E.makeCall(s, 'p3', 1); E.makeCall(s, 'p4', 3);
  E.makeCall(s, 'p1', 0);
  while (s.phase === 'playing') { const id = s.round.turnId; E.playCard(s, id, s.round.hands[id][0]); }
  assert.equal(s.round.results.p3.eliminated, true);
  assert.equal(s.round.results.p4.bonus3, 1);
  E.nextRound(s, { rng: seeded(3) });
  assert.equal(s.round.cards, 2); // dopo il 3 viene il 2
  assert.equal(s.round.dealerId, 'p2');
  assert.deepEqual(s.round.seats, ['p4', 'p1', 'p2']); // p3 saltato
});

test('mazziere eliminato: le carte le dà il prossimo vivo', () => {
  const s = newGame(4);
  rigRound(s, 'p2', { p1: [0], p2: [1], p3: [2], p4: [3] });
  s.players.find((p) => p.id === 'p2').eliminated = true; // simula
  s.phase = 'roundEnd';
  s.round.cards = 2;
  E.nextRound(s, { rng: seeded(2) });
  assert.equal(s.round.dealerId, 'p3');
  assert.equal(s.round.cards, 1);
  assert.deepEqual(s.round.seats, ['p4', 'p1', 'p3']);
});

test('dopo il turno da 1 si riparte dal massimo (ricalcolato sui vivi)', () => {
  const s = newGame(10);
  assert.equal(s.round.cards, 4);
  s.phase = 'roundEnd';
  s.round.cards = 1;
  for (const id of ['p8', 'p9', 'p10']) s.players.find((p) => p.id === id).eliminated = true;
  E.nextRound(s, { rng: seeded(5) });
  assert.equal(s.round.cards, 5); // 7 vivi -> 5
});

test('due a zero nello stesso turno prendono entrambi la bonus', () => {
  const s = newGame(3);
  rigRound(s, 'p1', { p1: [37, 38], p2: [0, 1], p3: [2, 3] });
  s.players.forEach((p) => (p.lives = 1));
  E.makeCall(s, 'p2', 2); E.makeCall(s, 'p3', 2); E.makeCall(s, 'p1', 1);
  while (s.phase === 'playing') { const id = s.round.turnId; E.playCard(s, id, s.round.hands[id][0]); }
  assert.equal(s.round.results.p2.zeroBonus, true);
  assert.equal(s.round.results.p3.zeroBonus, true);
  assert.equal(s.round.results.p1.after, 0 + 1); // anche p1: chiama 1 prende 2 -> 0 -> bonus
});

test('pareggio: gli ultimi vivi vanno a zero insieme', () => {
  const s = newGame(3);
  s.bonusZeroUsed = true;
  s.players.find((p) => p.id === 'p1').eliminated = true;
  rigRound(s, 'p2', { p2: [0], p3: [1] });
  s.players.find((p) => p.id === 'p2').lives = 1;
  s.players.find((p) => p.id === 'p3').lives = 1;
  E.makeCall(s, 'p3', 1); E.makeCall(s, 'p2', 1);
  E.playCard(s, 'p3'); E.playCard(s, 'p2');
  // p3 prende (carta 1 > 0): chiama 1 prende 1 ok. p2 chiama 1 prende 0 -> eliminato -> vince p3
  assert.equal(s.phase, 'finished');
  assert.deepEqual(s.winners, ['p3']);

  const t = newGame(3);
  t.bonusZeroUsed = true;
  t.players.find((p) => p.id === 'p1').eliminated = true;
  rigRound(t, 'p2', { p2: [2, 3], p3: [0, 1] });
  t.players.forEach((p) => (p.lives = 1));
  E.makeCall(t, 'p3', 1); E.makeCall(t, 'p2', 0);
  while (t.phase === 'playing') { const id = t.round.turnId; E.playCard(t, id, t.round.hands[id][0]); }
  assert.equal(t.phase, 'finished');
  assert.deepEqual(t.winners.sort(), ['p2', 'p3']);
});

test('espulsione: scatta all’inizio del turno successivo', () => {
  const s = newGame(4, 9);
  const victim = s.round.seats[1];
  E.setKick(s, victim, true);
  while (s.phase === 'calling') { const id = s.round.turnId; const f = E.forbiddenCall(s); E.makeCall(s, id, f === 0 ? 1 : 0); }
  assert.ok(s.round.seats.includes(victim)); // finisce il turno
  while (s.phase === 'playing') { const id = s.round.turnId; E.playCard(s, id, s.round.hands[id][0], 'high'); }
  if (s.phase === 'roundEnd') {
    E.nextRound(s, { rng: seeded(1) });
    const p = s.players.find((x) => x.id === victim);
    assert.equal(p.kicked, true);
    if (s.round) assert.ok(!s.round.seats.includes(victim) || s.phase === 'finished');
  }
});

test('visibilità: nel turno da 1 vedi le carte altrui ma non la tua', () => {
  const s = newGame(3);
  rigRound(s, 'p1', { p1: [5], p2: [6], p3: [7] });
  s.round.cards = 1;
  const v = E.viewFor(s, 'p2');
  assert.equal(v.myHand, null);
  assert.deepEqual(v.players.find((p) => p.id === 'p1').hand, [5]);
  assert.equal(v.players.find((p) => p.id === 'p2').hand, undefined);
  // turno normale: niente carte altrui
  const t = newGame(3);
  const v2 = E.viewFor(t, 'p1');
  assert.equal(v2.myHand.length, 5);
  assert.ok(v2.players.every((p) => p.hand === undefined));
  // spettatore: riceve tutte le mani (coperte nell'interfaccia finché non preme l'occhio)
  E.addSpectator(t, { id: 's1', name: 'Guardone' });
  const v3 = E.viewFor(t, 's1');
  assert.ok(v3.players.every((p) => Array.isArray(p.hand)));
  assert.equal(v3.myHand, undefined);
});

test('simulazione: 3000 partite casuali da 3 a 13 giocatori finiscono senza errori e senza carte duplicate', () => {
  let rounds = 0;
  for (let g = 0; g < 3000; g++) {
    const n = 3 + (g % 11);
    const rng = seeded(g + 11);
    const s = newGame(n, g + 1);
    let guard = 0;
    while (s.phase !== 'finished') {
      if (++guard > 5000) throw new Error('partita infinita');
      const r = s.round;
      if (s.phase === 'calling') {
        const f = E.forbiddenCall(s);
        let c; do { c = Math.floor(rng() * (r.cards + 1)); } while (c === f);
        E.makeCall(s, r.turnId, c);
      } else if (s.phase === 'playing') {
        if (r.pendingJolly) { E.chooseJolly(s, r.pendingJolly, rng() < 0.5 ? 'high' : 'low'); continue; }
        const h = r.hands[r.turnId];
        const card = h[Math.floor(rng() * h.length)];
        const jolly = card === E.JOLLY && r.cards > 1 ? (rng() < 0.5 ? 'high' : 'low') : undefined;
        E.playCard(s, r.turnId, card, jolly);
      } else if (s.phase === 'roundEnd') {
        rounds++;
        const r2 = s.round;
        // controlli di coerenza
        const total = Object.values(r2.won).reduce((a, b) => a + b, 0);
        assert.equal(total, r2.cards);
        const sumCalls = Object.values(r2.calls).reduce((a, b) => a + b, 0);
        assert.notEqual(sumCalls, r2.cards);
        assert.ok(s.players.every((p) => p.lives >= 0));
        E.nextRound(s, { rng });
        if (s.phase !== 'finished') {
          const all = Object.values(s.round.hands).flat();
          assert.equal(new Set(all).size, all.length);
          assert.equal(all.length, s.round.cards * s.round.seats.length);
          assert.ok(all.length <= 40);
        }
      }
    }
    assert.ok(s.winners.length >= 1, 'vincitori');
  }
  assert.ok(rounds > 5000, 'turni ' + rounds);
});

test('sala d\'attesa: CPU, cambio nome, ritorno in lobby a fine partita', () => {
  const s = E.createGame({ code: 'L', hostId: 'h', hostName: 'Thomas' });
  E.addPlayer(s, { id: 'c1', name: 'CPU1', cpu: { level: 'medio' } });
  E.addPlayer(s, { id: 'a', name: 'Anna' });
  assert.throws(() => E.renamePlayer(s, 'a', 'thomas'), /già usato/);
  E.renamePlayer(s, 'a', 'Annina');
  assert.equal(s.players.find((p) => p.id === 'a').name, 'Annina');
  E.startGame(s, { rng: seeded(4) });
  assert.ok(s.firstDealer);
  assert.throws(() => E.renamePlayer(s, 'a', 'X'), /sala/);
  // finisco la partita a forza
  s.phase = 'finished'; s.winners = ['a']; s.players.forEach((p) => (p.lives = 0));
  E.resetToLobby(s);
  assert.equal(s.phase, 'lobby');
  assert.deepEqual(s.lastWinners, ['Annina']);
  assert.ok(s.players.every((p) => p.lives === 3 && !p.eliminated));
  assert.equal(s.players.length, 3);
  assert.equal(s.players.find((p) => p.id === 'c1').cpu.level, 'medio');
});

test('stato mascherato: ognuno vede solo quello che deve', () => {
  const s = newGame(4);
  const me = s.round.seats[0];
  const other = s.round.seats[1];
  const m = E.maskState(s, me);
  assert.deepEqual(m.round.hands[me], s.round.hands[me]);
  assert.ok(m.round.hands[other].every((c) => c === -1));
  assert.equal(m.round.hands[other].length, s.round.hands[other].length);
  // turno da 1: vedo gli altri ma non me
  s.round.cards = 1;
  for (const id of s.round.seats) s.round.hands[id] = s.round.hands[id].slice(0, 1);
  const m1 = E.maskState(s, me);
  assert.deepEqual(m1.round.hands[me], [-1]);
  assert.deepEqual(m1.round.hands[other], s.round.hands[other]);
  // chi guarda non riceve nessuna mano
  const ms = E.maskState(s, 'nessuno');
  assert.ok(Object.values(ms.round.hands).every((h) => h.every((c) => c === -1)));
});

test('angelo custode: chi guarda vede solo la mano di chi gli dà il permesso', () => {
  const s = newGame(4);
  E.addSpectator(s, { id: 'sp', name: 'Spettatore' });
  const [a, b] = s.round.seats.filter((id) => !s.players.find((p) => p.id === id).cpu);
  E.askPeek(s, 'sp', a, 1000);
  assert.ok(E.maskState(s, 'sp').round.hands[a].every((c) => c === -1), 'in attesa: niente');
  assert.throws(() => E.askPeek(s, 'sp', b, 2000), /risposta/);
  E.answerPeek(s, a, 'sp', false, 3000);
  assert.throws(() => E.askPeek(s, 'sp', a, 4000), /detto di no/);
  E.askPeek(s, 'sp', b, 5000);
  E.answerPeek(s, b, 'sp', true, 6000);
  const m = E.maskState(s, 'sp');
  assert.deepEqual(m.round.hands[b], s.round.hands[b]);
  assert.ok(m.round.hands[a].every((c) => c === -1));
  assert.throws(() => E.askPeek(s, 'sp', a, 7000), /già guardando/);
  // turno da 1 carta: anche l'angelo custode non vede nulla
  s.round.cards = 1;
  for (const id of s.round.seats) s.round.hands[id] = s.round.hands[id].slice(0, 1);
  assert.deepEqual(E.maskState(s, 'sp').round.hands[b], [-1]);
  // se il suo giocatore viene eliminato può chiedere a un altro
  s.players.find((p) => p.id === b).eliminated = true;
  const third = s.players.find((p) => !p.cpu && p.id !== a && p.id !== b);
  if (third) E.askPeek(s, 'sp', third.id, 8000);
});
