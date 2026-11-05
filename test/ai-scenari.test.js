// Prove fisse sulla CPU, costruite sugli esempi di gioco reali del gruppo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../public/lib/engine.js';
import * as AI from '../public/lib/ai.js';

// carte: indice = seme*10 + valore-1 (bastoni 0, spade 1, coppe 2, denari 3)
const C = (v, seme) => ['bastoni', 'spade', 'coppe', 'denari'].indexOf(seme) * 10 + v - 1;

// Prepara un turno a mano. seats = ordine di gioco (l'ultimo è il mazziere).
function rig({ seats, hands, calls = {}, trick = [], phase = 'playing', lives = {} }) {
  const s = E.createGame({ code: 'T', hostId: seats[0], hostName: seats[0] });
  for (const id of seats.slice(1)) E.addPlayer(s, { id, name: id });
  E.startGame(s, { rng: AI.makeRng(1) });
  s.order = seats.slice();
  for (const p of s.players) p.lives = lives[p.id] ?? 3;
  const cards = Object.values(hands)[0].length + (trick.length && phase === 'playing' ? 0 : 0);
  const r = s.round;
  r.cards = Math.max(...Object.values(hands).map((h) => h.length)) + (trick.find(() => true) ? 0 : 0);
  r.dealerId = seats[seats.length - 1];
  r.seats = seats.slice();
  r.hands = JSON.parse(JSON.stringify(hands));
  r.calls = { ...calls };
  r.won = Object.fromEntries(seats.map((id) => [id, 0]));
  r.played = []; r.playedBy = {};
  r.trickNo = 1;
  r.trick = { leader: trick[0]?.pid ?? seats[0], plays: trick.map((t) => ({ ...t })) };
  // chi ha già giocato nella mano ha una carta in meno: la sua carta è sul tavolo
  const nextIdx = trick.length ? (seats.indexOf(trick[trick.length - 1].pid) + 1) % seats.length : 0;
  r.turnId = phase === 'calling' ? seats[Object.keys(calls).length] : seats[nextIdx];
  r.cards = Math.max(...seats.map((id) => r.hands[id].length + (trick.some((t) => t.pid === id) ? 1 : 0)));
  s.phase = phase;
  return s;
}

const persona = { risk: 0, cunning: 0.8 };
const runs = (n, f) => Array.from({ length: n }, (_, i) => f(AI.makeRng(1000 + i)));
const share = (arr, pred) => arr.filter(pred).length / arr.length;

test('in 8 con tutte le carte fuori non si apre col cavallo di denari', () => {
  const seats = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
  // distribuisco tutto il mazzo: p1 ha cavallo di denari + carte basse
  const mine = [C(9, 'denari'), C(1, 'bastoni'), C(2, 'bastoni'), C(1, 'spade'), C(2, 'spade')];
  const rest = [...Array(40).keys()].filter((c) => !mine.includes(c));
  const hands = { p1: mine };
  seats.slice(1).forEach((id, i) => (hands[id] = rest.slice(i * 5, i * 5 + 5)));
  const calls = { p1: 1, p2: 0, p3: 1, p4: 0, p5: 1, p6: 0, p7: 1, p8: 0 };
  for (const level of ['medio', 'difficile']) {
    const picks = runs(25, (rng) => AI.decidePlay(rig({ seats, hands, calls }), 'p1', { level, persona, rng }).card);
    assert.ok(share(picks, (c) => c === C(9, 'denari')) <= 0.1, `${level}: ha aperto col cavallo ${picks.filter((c) => c === 38).length} volte su 25`);
  }
});

test('col re di denari, primo di mano e chiamata 1, si apre basso', () => {
  const seats = ['p1', 'p2', 'p3', 'p4', 'p5'];
  const mine = [C(10, 'denari'), C(3, 'bastoni'), C(5, 'bastoni'), C(2, 'spade'), C(4, 'spade')];
  const rest = [...Array(40).keys()].filter((c) => !mine.includes(c));
  const hands = { p1: mine };
  seats.slice(1).forEach((id, i) => (hands[id] = rest.slice(i * 5, i * 5 + 5)));
  const calls = { p1: 1, p2: 1, p3: 0, p4: 1, p5: 1 };
  for (const level of ['medio', 'difficile']) {
    const picks = runs(25, (rng) => AI.decidePlay(rig({ seats, hands, calls }), 'p1', { level, persona, rng }).card);
    // la difficile ogni tanto rischia quando le sue simulazioni dicono che il re regge
    assert.ok(share(picks, (c) => c === C(10, 'denari')) <= (level === 'medio' ? 0.1 : 0.3), `${level}: ha aperto col re ${picks.filter((c) => c === 39).length} volte su 25`);
  }
});

test('da penultimo col 7 si prova a prendere se chi viene dopo non ha bisogno di prese', () => {
  const seats = ['p1', 'p2', 'p3', 'p4'];
  const hands = { p1: [C(6, 'spade')], p2: [C(3, 'bastoni')], p3: [C(7, 'coppe'), C(2, 'bastoni')], p4: [C(5, 'coppe'), C(9, 'denari')] };
  const trick = [{ pid: 'p1', card: C(4, 'bastoni') }, { pid: 'p2', card: C(5, 'bastoni') }];
  const calls = { p1: 0, p2: 0, p3: 1, p4: 0 };
  for (const level of ['medio', 'difficile']) {
    const picks = runs(25, (rng) => AI.decidePlay(rig({ seats, hands, calls, trick }), 'p3', { level, persona, rng }).card);
    assert.ok(share(picks, (c) => c === C(7, 'coppe')) >= 0.8, `${level}: ha tirato il 7 ${picks.filter((c) => c === C(7, 'coppe')).length} volte su 25`);
  }
});

test('la chiamata forzata del mazziere dice meno di una chiamata libera', () => {
  const m = AI.GENERIC;
  const strong = 1.2, weak = 0.1; // forza stimata di una mano forte e di una debole
  const free = AI.callLikelihood(m, strong, 3, 1, null) / AI.callLikelihood(m, weak, 3, 1, null);
  const forced = AI.callLikelihood(m, strong, 3, 1, 0) / AI.callLikelihood(m, weak, 3, 1, 0);
  assert.ok(forced < free, `rapporto forzata ${forced.toFixed(2)} contro libera ${free.toFixed(2)}`);
});

test('2 coppe nel giro da 2: si chiama più alto se gli altri hanno chiamato 0', () => {
  const seats = ['p1', 'p2', 'p3', 'p4', 'p5'];
  const mine = [C(9, 'coppe'), C(6, 'coppe')];
  const mean = (calls) => {
    const rest = [...Array(40).keys()].filter((c) => !mine.includes(c));
    const hands = { p4: mine };
    ['p1', 'p2', 'p3', 'p5'].forEach((id, i) => (hands[id] = rest.slice(i * 2, i * 2 + 2)));
    const xs = runs(30, (rng) => AI.decideCall(rig({ seats, hands, calls, phase: 'calling' }), 'p4', { level: 'difficile', persona, rng }));
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  };
  const low = mean({ p1: 0, p2: 0, p3: 0 });
  const high = mean({ p1: 1, p2: 1, p3: 1 });
  assert.ok(low > high, `media con chiamate basse ${low.toFixed(2)}, con chiamate alte ${high.toFixed(2)}`);
});

test('se uno chiama 0 ma di solito ha i denari, la CPU con le coppe chiama più basso', () => {
  const seats = ['p1', 'p2', 'p3', 'p4'];
  const mine = [C(10, 'coppe'), C(2, 'bastoni')];
  const rest = [...Array(40).keys()].filter((c) => !mine.includes(c));
  const hands = { p3: mine };
  ['p1', 'p2', 'p4'].forEach((id, i) => (hands[id] = rest.slice(i * 2, i * 2 + 2)));
  const calls = { p1: 0, p2: 0 };
  const mean = (models) => {
    const xs = runs(40, (rng) => AI.decideCall(rig({ seats, hands, calls, phase: 'calling' }), 'p3', { level: 'difficile', persona: { risk: 0, cunning: 1 }, rng, models }));
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  };
  const sly = { callBias: -1.0, callStd: 0.45, firstLow: null };
  const plain = mean({});
  const knowing = mean({ p1: sly, p2: sly });
  assert.ok(knowing < plain, `con il profilo ${knowing.toFixed(2)}, senza ${plain.toFixed(2)}`);
});

test('profili: ogni giocatore parte dal gruppo e se ne stacca con i suoi dati', () => {
  const hand = [C(10, 'denari'), C(9, 'denari')];
  const recs = [
    { player: 'Bepi', calls: Array.from({ length: 20 }, () => ({ cards: 2, n: 4, hand, call: 0 })), plays: [] },
    { player: 'Anna', calls: Array.from({ length: 20 }, () => ({ cards: 2, n: 4, hand, call: 2 })), plays: [] },
  ];
  const pr = AI.learnProfiles(recs);
  assert.ok(AI.profileFor(pr, 'bepi').callBias < pr.group.callBias);
  assert.ok(AI.profileFor(pr, 'Anna').callBias > pr.group.callBias);
  assert.equal(AI.profileFor(pr, 'Sconosciuto'), pr.group);
});

test('chi deve fare 0 ed è ultimo con tutte carte che prendono prende con la più alta', () => {
  const seats = ['p1', 'p2', 'p3'];
  const hands = { p1: [C(5, 'bastoni')], p2: [C(6, 'bastoni')], p3: [C(2, 'spade'), C(3, 'denari')] };
  const trick = [{ pid: 'p1', card: C(3, 'bastoni') }, { pid: 'p2', card: C(4, 'bastoni') }];
  const calls = { p1: 1, p2: 1, p3: 0 };
  for (const level of ['medio', 'difficile']) {
    const picks = runs(20, (rng) => AI.decidePlay(rig({ seats, hands, calls, trick }), 'p3', { level, persona, rng }).card);
    assert.ok(share(picks, (c) => c === C(3, 'denari')) >= 0.8, `${level}: ha preso col 3 di denari ${picks.filter((c) => c === C(3, 'denari')).length} volte su 20`);
  }
});

test("l'asso di denari: lo usa sul re se il resto è basso, lo tiene se ha altre carte alte", () => {
  const seats = ['p1', 'p2', 'p3', 'p4'];
  const useRate = (mine) => {
    const rest = [...Array(40).keys()].filter((c) => !mine.includes(c) && c !== C(10, 'denari'));
    const hands = { p2: mine, p1: rest.slice(0, 4), p3: rest.slice(4, 9), p4: rest.slice(9, 14) };
    const trick = [{ pid: 'p1', card: C(10, 'denari') }];
    const calls = { p1: 1, p2: 1, p3: 1, p4: 1 };
    const picks = runs(30, (rng) => AI.decidePlay(rig({ seats, hands, calls, trick }), 'p2', { level: 'difficile', persona, rng }));
    return share(picks, (d) => d.card === E.JOLLY && d.jolly === 'high');
  };
  // resto della mano che non può prendere in nessun caso: l'asso subito è lecito
  const garbage = useRate([E.JOLLY, C(1, 'bastoni'), C(2, 'bastoni'), C(3, 'bastoni'), C(4, 'bastoni')]);
  const strong = useRate([E.JOLLY, C(10, 'coppe'), C(9, 'coppe'), C(3, 'bastoni'), C(2, 'spade')]);
  // resto basso ma non perdente al 100% (il 2 di spade potrebbe prendere l'ultima): si tiene
  const notSure = useRate([E.JOLLY, C(2, 'bastoni'), C(3, 'bastoni'), C(4, 'bastoni'), C(2, 'spade')]);
  assert.equal(notSure, 0, `con una carta che può ancora prendere lo usa ${Math.round(notSure * 100)}%`);
  assert.ok(garbage >= 0.15, `con carte basse lo usa ${Math.round(garbage * 100)}% delle volte`);
  assert.ok(garbage >= strong + 0.15, `carte basse ${Math.round(garbage * 100)}%, carte alte ${Math.round(strong * 100)}%`);
});

test('fante di denari in 8: la chiamata dipende dalle chiamate prima e dalla posizione', () => {
  const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
  const mine = [C(8, 'denari'), C(2, 'bastoni'), C(5, 'spade'), C(7, 'bastoni'), C(3, 'coppe')];
  const mean = (pos, before) => {
    const rest = [...Array(40).keys()].filter((c) => !mine.includes(c));
    const hands = {};
    let k = 0;
    ids.forEach((id, i) => (hands[id] = i === pos ? mine : rest.slice(k * 5, (k++ + 1) * 5)));
    const calls = {};
    before.forEach((c, i) => (calls[ids[i]] = c));
    const xs = runs(30, (rng) => AI.decideCall(rig({ seats: ids, hands, calls, phase: 'calling' }), ids[pos], { level: 'difficile', persona, rng }));
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  };
  const first = mean(0, []);
  const afterLow = mean(5, [0, 0, 0, 0, 0]);
  const afterHigh = mean(5, [1, 2, 1, 1, 1]);
  assert.ok(Math.max(first, afterLow, afterHigh) - Math.min(first, afterLow, afterHigh) >= 0.2,
    `primo ${first.toFixed(2)}, dopo chiamate basse ${afterLow.toFixed(2)}, dopo chiamate alte ${afterHigh.toFixed(2)}`);
  assert.ok(afterLow > afterHigh, `dopo chiamate basse ${afterLow.toFixed(2)} deve superare dopo chiamate alte ${afterHigh.toFixed(2)}`);
});

test("l'asso alto non si usa in seconda mano se resta una carta che può prendere l'ultima", () => {
  // Anna ha chiamato 1, ha asso di denari e 3 di coppe; seconda mano di tre, sul tavolo un re di bastoni
  const seats = ['p1', 'p2', 'p3', 'p4'];
  const hands = { p1: [C(2, 'bastoni')], p2: [E.JOLLY, C(3, 'coppe')], p3: [C(5, 'bastoni'), C(6, 'spade')], p4: [C(4, 'bastoni'), C(1, 'spade')] };
  const trick = [{ pid: 'p1', card: C(10, 'bastoni') }];
  const calls = { p1: 1, p2: 1, p3: 0, p4: 0 };
  const build = () => {
    const s = rig({ seats, hands, calls, trick });
    s.round.cards = 3; s.round.trickNo = 2;
    s.round.played = [C(7, 'bastoni'), C(8, 'bastoni'), C(9, 'bastoni'), C(6, 'bastoni')];
    s.round.won.p1 = 0;
    return s;
  };
  for (const level of ['medio', 'difficile']) {
    const picks = runs(20, (rng) => AI.decidePlay(build(), 'p2', { level, persona, rng }));
    const bad = picks.filter((d) => d.card === E.JOLLY && d.jolly === 'high').length;
    assert.equal(bad, 0, `${level}: ha usato l'asso alto ${bad} volte su 20`);
  }
});

test('perdente sicura: solo se in giro non ci sono abbastanza carte più basse', () => {
  const gone = new Uint8Array(40);
  assert.equal(AI.certainLoser(C(1, 'bastoni'), [C(1, 'bastoni')], gone, 4), true); // sotto c'è solo l'asso di denari basso
  assert.equal(AI.certainLoser(C(3, 'coppe'), [C(3, 'coppe')], gone, 4), false);
  assert.equal(AI.certainLoser(C(4, 'bastoni'), [C(4, 'bastoni')], gone, 4), false); // sotto ci sono asso, 2, 3 di bastoni e asso di denari
  for (let x = 0; x < 2; x++) gone[x] = 1; // asso e 2 di bastoni usciti
  assert.equal(AI.certainLoser(C(4, 'bastoni'), [C(4, 'bastoni')], gone, 4), true);
});
