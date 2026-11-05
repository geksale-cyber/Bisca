import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/lib/tutorial.js';
import * as AI from '../public/lib/ai.js';
import * as E from '../public/lib/engine.js';

test('ogni scenario (e variante) arriva al tuo turno con carte valide', () => {
  for (const n of Object.keys(T.SCENARIOS)) {
    T.SCENARIOS[n].forEach((base, i) => {
      for (const v of [false, true]) {
        if (v && !base.alt) continue;
        const sc = T.scenarioOf(Number(n), i, v);
        const all = sc.seats.flatMap((id) => sc.hands[id]);
        assert.equal(new Set(all).size, all.length, `carte doppie ${n}/${i}`);
        for (const id of sc.seats) assert.equal(sc.hands[id].length, sc.cards);
        const s = T.buildScenario(sc, 'Tu');
        assert.equal(s.round.turnId, 'me');
        assert.equal(s.phase, sc.ask === 'call' ? 'calling' : 'playing');
        const opts = s.phase === 'calling' ? [{ call: 0 }] : [{ card: s.round.hands.me[0], jolly: s.round.hands.me[0] === 30 ? 'high' : undefined }];
        const ev = AI.evaluateOptions(s, 'me', opts, 40);
        assert.ok(ev[0] >= 0 && ev[0] <= 1);
      }
    });
  }
});

test('ogni lezione è in un livello e le parole coprono tutto', () => {
  const inLevels = T.LEVELS.flatMap((l) => l.lessons).sort((a, b) => a - b);
  assert.deepEqual(inLevels, T.LESSONS.map((l) => l.n));
  for (const l of T.LESSONS) if (l.n > 0) assert.ok(T.INTROS[l.n]?.length, `intro ${l.n}`);
  for (const p of [0, 0.1, 0.3, 0.5, 0.6, 0.9, 1]) assert.ok(T.chanceWord(p));
  assert.ok(!/%|\d/.test([0, 0.5, 1].map(T.chanceWord).join('')));
});

test('le domande del maestro esistono in chiamata e in gioco', () => {
  const s = E.createGame({ code: 'X', hostId: 'me', hostName: 'Tu' });
  E.addPlayer(s, { id: 'a', name: 'A', cpu: { level: 'medio' } });
  E.addPlayer(s, { id: 'b', name: 'B', cpu: { level: 'medio' } });
  E.startGame(s, { rng: () => 0.3 });
  assert.ok(T.maestroQuestion(s, 'me').length > 10);
});
