// Torneo CPU contro CPU: controlla che le partite finiscano, misura i tempi
// e verifica che i livelli abbiano senso (difficile > medio > facile).
// Uso: node test/ai-bench.mjs [partite]
import * as E from '../public/lib/engine.js';
import * as AI from '../public/lib/ai.js';

const GAMES = Number(process.argv[2] || 60);
const levels = ['facile', 'medio', 'difficile'];
const score = Object.fromEntries(levels.map((l) => [l, { pts: 0, n: 0, wins: 0 }]));
const exact = Object.fromEntries(levels.map((l) => [l, { hit: 0, n: 0 }]));
const tCall = [], tPlay = [];
const rng = AI.makeRng(42);

for (let g = 0; g < GAMES; g++) {
  const n = 3 + (g % 6); // 3..8 giocatori
  const s = E.createGame({ code: 'B', hostId: 'p0', hostName: 'P0' });
  for (let i = 1; i < n; i++) E.addPlayer(s, { id: 'p' + i, name: 'P' + i });
  const cfg = {};
  s.players.forEach((p, i) => {
    cfg[p.id] = { level: levels[(i + g) % 3], persona: AI.makePersona(rng), rng, group: AI.GENERIC_GROUP };
  });
  E.startGame(s, { rng });
  let guard = 0;
  while (s.phase !== 'finished') {
    if (++guard > 20000) throw new Error('loop');
    const r = s.round;
    if (s.phase === 'calling') {
      const t = performance.now();
      const c = AI.decideCall(s, r.turnId, cfg[r.turnId]);
      tCall.push(performance.now() - t);
      E.makeCall(s, r.turnId, c);
    } else if (s.phase === 'playing') {
      if (r.pendingJolly) { E.chooseJolly(s, r.pendingJolly, AI.decideJolly(s, r.pendingJolly)); continue; }
      const t = performance.now();
      const d = AI.decidePlay(s, r.turnId, cfg[r.turnId]);
      tPlay.push(performance.now() - t);
      E.playCard(s, r.turnId, d.card, d.jolly);
    } else if (s.phase === 'roundEnd') {
      for (const id of r.seats) {
        const x = r.results[id];
        const l = cfg[id].level;
        exact[l].n++; if (x.call === x.won) exact[l].hit++;
      }
      E.nextRound(s, { rng });
    }
  }
  // punti: ordine di uscita (chi esce prima prende meno)
  const order = s.players.slice().sort((a, b) => (a.eliminated ? a.outRound : 1e9) - (b.eliminated ? b.outRound : 1e9));
  order.forEach((p, i) => {
    const l = cfg[p.id].level;
    score[l].pts += i / (n - 1); score[l].n++;
    if (s.winners.includes(p.id)) score[l].wins++;
  });
}
const pct = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length * 0.95)].toFixed(1);
for (const l of levels) {
  console.log(`${l.padEnd(10)} piazzamento medio ${(score[l].pts / score[l].n).toFixed(2)}  vittorie ${score[l].wins}/${score[l].n}  chiamate centrate ${(100 * exact[l].hit / exact[l].n).toFixed(0)}%`);
}
console.log(`tempo chiamata p95 ${pct(tCall)} ms, giocata p95 ${pct(tPlay)} ms`);
