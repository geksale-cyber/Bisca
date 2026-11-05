// Tasti rapidi: i casi discussi con Thomas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { situation, parkPick, takePick } from '../public/lib/quick.js';

// carte: seme*10 + valore-1. bastoni 0-9, spade 10-19, coppe 20-29, denari 30-39 (30 = asso di denari)
const B = (v) => v - 1, S = (v) => 9 + v, C = (v) => 19 + v, D = (v) => 29 + v;

function round({ hand, plays = [], calls, won = {}, cards = 5, seats = ['me', 'a', 'b', 'c'], played = [] }) {
  return {
    cards, seats, played,
    hands: { me: hand },
    calls: { me: 1, ...calls },
    won: { me: 0, ...won },
    trick: { plays: plays.map(([pid, card, jolly]) => ({ pid, card, jolly })) },
  };
}

test('parcheggio: con 6 chiamate su 5 e chiamata 1 tengo il re di coppe, non lo sacrifico', () => {
  const r = round({ hand: [D(6), C(10), B(2), B(3)], plays: [['a', S(8)]], calls: { me: 1, a: 2, b: 2, c: 1 } });
  const p = parkPick(situation(r, 'me'));
  assert.equal(p.card, B(2));
});

test('parcheggio: disattivato se nessuna carta resta sotto (asso non in mano)', () => {
  const r = round({ hand: [D(5), D(7)], plays: [['a', B(4)]], calls: { a: 1, b: 1, c: 1 } });
  assert.ok(parkPick(situation(r, 'me')).none);
});

test('parcheggio: apro io, carta più bassa', () => {
  const r = round({ hand: [D(5), B(6), C(2)], calls: { a: 1, b: 1, c: 1 } });
  assert.equal(parkPick(situation(r, 'me')).card, B(6));
});

test('parcheggio: a posto, butto la sicura più alta', () => {
  const r = round({ hand: [B(2), C(5), S(3)], plays: [['a', D(9)]], calls: { me: 0, a: 1, b: 1, c: 1 } });
  assert.equal(parkPick(situation(r, 'me')).card, C(5));
});

test('presa: tutti bastoni, sono ultimo, chiamata 2 → prendo con la spada e tengo i denari', () => {
  const r = round({ hand: [S(4), D(5), D(7)], plays: [['a', B(9)], ['b', B(10)], ['c', B(3)]], calls: { me: 2, a: 1, b: 2, c: 1 } });
  const t = takePick(situation(r, 'me'));
  assert.equal(t.card, S(4));
  assert.equal(t.sure, true);
});

test('presa: tutti bastoni, sono ultimo, mi manca solo questa → prendo con la più alta', () => {
  const r = round({ hand: [S(4), D(5), D(7)], plays: [['a', B(9)], ['b', B(10)], ['c', B(3)]], calls: { me: 1, a: 1, b: 2, c: 1 } });
  assert.equal(takePick(situation(r, 'me')).card, D(7));
});

test('presa: mai l\'asso di denari in automatico', () => {
  const r = round({ hand: [30, B(2)], plays: [['a', D(10)]], calls: { a: 1, b: 1, c: 1 } });
  const t = takePick(situation(r, 'me'));
  assert.ok(t.none);
  assert.match(t.none, /asso/);
});

test('presa: disattivata quando sono a posto', () => {
  const r = round({ hand: [D(9)], calls: { me: 1, a: 1, b: 1, c: 1 }, won: { me: 1 } });
  assert.equal(takePick(situation(r, 'me')).warn, true);
});

test('presa: non ultimo, con l\'asso ancora in giro nessuna carta è sicura', () => {
  const r = round({ hand: [D(10), B(2)], plays: [['a', C(3)]], calls: { me: 2, a: 1, b: 1, c: 1 } });
  const t = takePick(situation(r, 'me'));
  assert.equal(t.card, D(10));
  assert.equal(t.sure, false);
});
