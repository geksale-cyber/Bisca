// Lezioni guidate. Una lezione è una mano preparata: carte decise, mosse delle CPU scritte,
// e i "momenti" in cui il maestro parla. Il motore delle regole è quello vero.
import * as E from './engine.js';

// carte: seme*10 + valore-1 (bastoni 0-9, spade 10-19, coppe 20-29, denari 30-39; 30 = asso di denari)
const B = (v) => v - 1, S = (v) => 9 + v, C = (v) => 19 + v, D = (v) => 29 + v;

export const MASTER = { id: 'fabrizio-corona', name: 'Fabrizio Corona' };

export const LEVELS = [
  { id: 'base', name: 'Principiante', lessons: [0, 1, 2, 3, 4] },
  { id: 'mid', name: 'Intermedio', lessons: [5, 6, 7, 8] },
  { id: 'pro', name: 'Avanzato', lessons: [9, 10, 11] },
];

export const LESSONS = [
  { n: 0, title: 'La tua prima mano', desc: 'Chiamate, prese, parcheggio e l\'asso di denari, giocando.', ready: true },
  { n: 1, title: 'Contare le prese', desc: 'Quali carte prendono da sole e quali quasi mai.', ready: true },
  { n: 2, title: 'Il mazziere e la somma', desc: 'Perché il mazziere ha un numero vietato e cosa ti dicono le chiamate.', ready: true },
  { n: 3, title: 'Prendere e lasciare', desc: 'Quando spendere una carta forte e quando scaricare.', ready: true },
  { n: 4, title: "L'asso di denari", desc: 'La carta che decidi tu: quando giocarla.', ready: true },
  { n: 5, title: 'La posizione al tavolo', desc: 'Chiamare per primo o per ultimo, giocare per primo o per ultimo.', ready: true },
  { n: 6, title: 'Leggere le chiamate', desc: 'Chiamate sopra o sotto le carte: battaglia o corsa a scaricare.', ready: true },
  { n: 7, title: 'Chi deve ancora prendere', desc: 'Durante la mano, cosa vuole chi gioca dopo di te.', ready: true },
  { n: 8, title: 'Il turno da 1 carta', desc: 'Vedi le carte degli altri ma non la tua.', ready: true },
  { n: 9, title: 'Le carte già uscite', desc: 'Ogni carta giocata cambia il valore di quelle che restano.', ready: true },
  { n: 10, title: 'Vite e finale', desc: 'Una vita sola, la vita bonus, il premio del tre su tre.', ready: true },
  { n: 11, title: 'Partita con il maestro', desc: 'Una partita vera: il maestro ti fa le domande giuste.', ready: true, maestro: true },
];

// ---------------------------------------------------------------- Lezione 0
const ME = 'me', A = 'cpuA', BB = 'cpuB', DL = 'cpuD';

export function lesson0(myName) {
  const s = E.createGame({ code: 'TUT', hostId: ME, hostName: myName || 'Tu' });
  E.addPlayer(s, { id: A, name: 'Lia', cpu: { level: 'medio' } });
  E.addPlayer(s, { id: BB, name: 'Bepi', cpu: { level: 'medio' } });
  E.addPlayer(s, { id: DL, name: 'Nico', cpu: { level: 'medio' } });
  E.startGame(s, { rng: () => 0.1 });
  // posti fissi: dopo il mazziere (Nico) chiamano Lia, tu, Bepi; il mazziere per ultimo
  s.order = [A, ME, BB, DL];
  s.firstDealer = DL;
  s.maxCards = 3;
  const r = s.round;
  Object.assign(r, {
    cards: 3, dealerId: DL, seats: [A, ME, BB, DL],
    hands: { [A]: [B(6), C(5), C(10)], [ME]: [S(3), D(1), D(8)], [BB]: [B(2), B(3), S(4)], [DL]: [B(4), C(7), D(9)] },
    calls: {}, won: { [A]: 0, [ME]: 0, [BB]: 0, [DL]: 0 },
    turnId: A, trick: { leader: A, plays: [] }, trickNo: 1,
  });
  for (const id of Object.keys(r.hands)) r.hands[id].sort((x, y) => x - y);
  return s;
}

// Mosse delle CPU, in ordine: chiamate e carte per ogni mano.
const SCRIPT0 = {
  calls: { [A]: 1, [BB]: 0, [DL]: 2 },
  plays: [
    { [A]: C(10), [BB]: B(2), [DL]: B(4) }, // 1ª: re di coppe, prende Lia
    { [A]: C(5), [BB]: B(3), [DL]: D(9) }, // 2ª: il cavallo di denari batte il tuo fante
    { [DL]: C(7), [A]: B(6), [BB]: S(4) }, // 3ª: tu prendi con l'asso alto
  ],
};

export function cpuMove(s, pid) {
  const r = s.round;
  if (s.phase === 'calling') return { call: SCRIPT0.calls[pid] };
  return { card: SCRIPT0.plays[r.trickNo - 1][pid] };
}

// Introduzione prima di giocare (si tocca "Avanti").
export const INTRO0 = [
  'Benvenuto a Bisca. Ognuno parte con <b>3 vite</b>: vince l\'ultimo che ne ha ancora.',
  'Ogni turno si danno carte: 5, poi 4, 3, 2, 1, e si ricomincia. Prima di giocare ognuno <b>chiama</b> quante mani pensa di prendere.',
  'Prende la carta più forte. I semi dal più debole al più forte: <b>bastoni, spade, coppe, denari</b>. In ogni seme l\'asso è la più bassa e il re la più alta.',
  'Se sbagli la chiamata perdi una vita per ogni mano di differenza. Indovinare è tutto. Proviamo con una mano da 3 carte.',
];

// I momenti della mano: quando `when` è vero il maestro parla.
// tap: aspetta "Avanti". gate: è il tuo turno e accetta solo la mossa giusta.
export const MOMENTS0 = [
  { id: 'dealer', tap: true, focus: `[data-pid="${DL}"]`, when: (s) => s.phase === 'calling' && !Object.keys(s.round.calls).length,
    say: 'Questo è il <b>mazziere</b>: dà le carte e chiama per ultimo. Si parte da chi gli sta dopo, Lia.' },
  { id: 'aCalled', tap: true, focus: `[data-pid="${A}"]`, when: (s) => s.round.calls[A] != null && s.round.calls[ME] == null,
    say: 'Lia ha chiamato <b>1</b>: pensa di prendere una mano.' },
  { id: 'myCall', gate: { call: 1 }, focus: '[data-act="call"][data-n="1"]', when: (s) => s.phase === 'calling' && s.round.turnId === ME,
    say: 'Tocca a te. Hai il <b>fante di denari</b>, una carta alta, e l\'<b>asso di denari</b>, la carta speciale: te la spiego quando servirà. Il consiglio è <b>chiamare 1</b>: il fante probabilmente prende, e l\'asso ti fa da assicurazione.',
    wrong: 'Con il fante di denari e l\'asso di denari una presa è molto probabile, due sono un rischio e zero quasi impossibile. Chiama <b>1</b>.' },
  { id: 'bCalled', tap: true, focus: `[data-pid="${BB}"]`, when: (s) => s.round.calls[BB] != null && s.round.calls[DL] == null && s.round.turnId === DL,
    say: 'Bepi ha chiamato <b>0</b>: non vuole prendere niente, butterà carte basse.' },
  { id: 'dealerRule', tap: true, focus: `[data-pid="${DL}"]`, when: (s) => s.phase === 'calling' && s.round.turnId === DL,
    say: 'Ora chiama il mazziere. Le chiamate fanno <b>2 su 3 mani</b>: il mazziere <b>non può chiamare 1</b>, sennò la somma farebbe esattamente 3. Così c\'è sempre qualcuno che sbaglia.' },
  { id: 'aLead', tap: true, when: (s) => s.phase === 'playing' && s.round.trickNo === 1 && s.round.trick.plays.length === 1,
    say: 'Nico ha chiamato 2. Si gioca: apre Lia con il <b>re di coppe</b>, una carta forte. Tu non hai bisogno di prenderla adesso: tieni il fante per dopo.' },
  { id: 'park', gate: { card: S(3) }, focus: '.qbtn.park', when: (s) => s.phase === 'playing' && s.round.trickNo === 1 && s.round.turnId === ME,
    say: '<b>Parcheggiare</b> vuol dire buttare una carta che non prende. Il pulsante Parcheggio ti propone il 3 di spade: toccalo.',
    wrong: 'Quella carta la sprecheresti. Qui conviene buttare la più bassa, il <b>3 di spade</b>: tocca il pulsante Parcheggio.' },
  { id: 'trick1', tap: true, focus: `[data-pid="${A}"]`, when: (s) => s.phase === 'playing' && s.round.trickNo === 2 && !s.round.trick.plays.length,
    say: 'Ha preso Lia con il re di coppe. <b>Chi prende apre la mano successiva.</b>' },
  { id: 'take', gate: { card: D(8) }, focus: '.qbtn.take', when: (s) => s.phase === 'playing' && s.round.trickNo === 2 && s.round.turnId === ME,
    say: 'Lia ha aperto con il 5 di coppe. Ora tocca prendere: il pulsante <b>Presa</b> ti suggerisce il fante di denari. Toccalo.',
    wrong: 'Ti serve una presa e il fante di denari batte il 5 di coppe: tocca il pulsante <b>Presa</b>.' },
  { id: 'beaten', tap: true, focus: `[data-pid="${DL}"]`, when: (s) => s.phase === 'playing' && s.round.trickNo === 3 && !s.round.trick.plays.length,
    say: 'Peccato: Nico aveva il <b>cavallo di denari</b>, più alto del tuo fante. Ma ti resta l\'assicurazione…' },
  { id: 'jolly', gate: { card: D(1), jolly: 'high' }, focus: `[data-act="sel"][data-c="${D(1)}"], [data-act="play"][data-v="high"]`, when: (s) => s.phase === 'playing' && s.round.trickNo === 3 && s.round.turnId === ME,
    say: 'Ti resta l\'<b>asso di denari</b>: è il jolly. Quando lo tiri decidi tu se vale <b>più di tutte</b> le carte o <b>meno di tutte</b>. Ti serve ancora una presa: toccalo e scegli <b>più alta di tutte</b>.',
    wrong: 'Ti serve ancora una presa: l\'asso di denari va giocato <b>alto</b>, così batte qualsiasi carta.' },
  { id: 'end1', tap: true, when: (s) => s.phase === 'roundEnd' || s.phase === 'finished',
    say: 'Hai chiamato 1 e preso 1: <b>nessuna vita persa</b>. Nico voleva 2 e ne ha preso 1: <b>perde una vita</b>. Lia e Bepi hanno centrato la chiamata.' },
  { id: 'end2', tap: true, when: (s) => s.phase === 'roundEnd' || s.phase === 'finished',
    say: 'Ultima cosa: il primo che arriva a zero vite riceve una <b>vita bonus</b>. Da lì in poi chi arriva a zero è fuori dal gioco.' },
  { id: 'end3', tap: true, last: true, when: (s) => s.phase === 'roundEnd' || s.phase === 'finished',
    say: 'Ora sai le basi. Le prossime lezioni ti insegnano a <b>chiamare bene</b> e a giocare d\'astuzia. Alla prossima!' },
];

// ---------------------------------------------------------------- Lezioni a scenari
// Ogni scenario è una situazione preparata: tu decidi, poi si vede quanto è probabile che vada bene
// (a parole), il maestro spiega il ragionamento e puoi riprovare, vedere una variante o giocare il resto.
const MA = 'cpuE';
export const NAMES = { [A]: 'Lia', [BB]: 'Bepi', [DL]: 'Nico', [MA]: 'Mara' };

// Probabilità → parole (nel tutorial niente percentuali)
export function chanceWord(p) {
  return p >= 0.75 ? 'molto probabile' : p >= 0.55 ? 'probabile' : p >= 0.4 ? 'incerta' : p >= 0.2 ? 'rischiosa' : 'molto rischiosa';
}

export const INTROS = {
  1: ['Prima di ogni turno dici quante mani prendi. Non è fortuna: è <b>contare</b>.', 'Ti mostro delle mani. Tu decidi, poi guardiamo insieme come si ragiona. Puoi sempre riprovare o vedere come va a finire.'],
  2: ['Il mazziere chiama per ultimo e ha un vincolo: la somma delle chiamate <b>non può fare</b> il numero di carte.', 'Così alla fine qualcuno sbaglia per forza. Vediamo cosa ti dicono le chiamate, da mazziere e non.'],
  3: ['Chiamare è metà del lavoro. L\'altra metà è far arrivare le prese <b>quando servono</b>.', 'I pulsanti Presa e Parcheggio ti propongono una carta. Qui però conta capire il perché.'],
  4: ['L\'asso di denari è il jolly: quando lo giochi decidi se vale <b>più di tutte</b> o <b>meno di tutte</b>.', 'È la carta più flessibile del mazzo. Proprio per questo va usata con la testa.'],
  5: ['Chi chiama per primo sa poco. Chi chiama per ultimo ha sentito tutti.', 'Lo stesso vale nel gioco: chi gioca per ultimo in una mano ha già visto tutte le carte.'],
  6: ['Le chiamate degli altri sono informazioni: ti dicono cosa pensano di avere in mano.', 'La loro somma ti dice com\'è il tavolo: <b>battaglia</b> per prendere, o <b>corsa</b> a scaricare.'],
  7: ['Durante la mano guarda sempre chi ha già fatto le sue prese e chi no.', 'Chi deve ancora prendere gioca forte. Chi è a posto scarica. Questo cambia il valore delle tue carte.'],
  8: ['Nel turno da una carta vedi le carte di tutti, <b>tranne la tua</b>.', 'Chiami guardando gli altri. Poi le carte si scoprono tutte insieme.'],
  9: ['Le carte giocate non tornano. Ogni carta che esce cambia il valore di quelle che restano.', 'In questa lezione, quando tocchi una carta, ti dico quante carte più forti sono ancora in giro.'],
  10: ['Le vite cambiano il peso delle scelte. Con tre vite un errore si assorbe; con una sola può chiudere la partita.', 'E ricorda il premio: chi chiama <b>tre</b> e ne prende tre guadagna una vita.'],
  11: ['Ora una partita vera, contro la CPU. Le carte sono a caso, come sempre.', 'Quando tocca a te ti faccio una domanda per farti ragionare. Se vuoi, tocca <b>Un consiglio</b>: ti dico a parole come vedo le tue possibilità.'],
};

// seats: ordine di gioco, il mazziere è l'ultimo. calls: chiamate delle CPU (e la tua, se lo scenario parte dopo).
// pre: giocate già fatte prima della tua decisione. ask: 'call' o 'play'.
export const SCENARIOS = {
  1: [
    { seats: [A, ME, BB, DL], cards: 5, ask: 'call',
      hands: { [ME]: [D(10), D(9), C(3), B(2), S(5)], [A]: [C(10), S(9), B(7), C(6), D(4)], [BB]: [D(8), S(10), B(10), C(2), S(1)], [DL]: [D(7), C(9), B(5), S(3), C(8)] },
      calls: { [A]: 1, [BB]: 2, [DL]: 1 },
      say: 'Cinque carte. Lia ha chiamato una mano. Guarda la tua: quali carte prendono da sole, e quali quasi mai?',
      why: 'Il <b>re di denari</b> lo batte solo l\'asso di denari giocato alto. Il <b>cavallo di denari</b> perde solo con il re e con l\'asso. Il 3 di coppe, il 2 di bastoni e il 5 di spade prendono solo se tutti gli altri buttano ancora più basso, e succede di rado. Per ogni carta chiediti <b>quante carte ci sono sopra</b> e quante persone potrebbero averle.',
      alt: { label: 'E se il cavallo fosse di bastoni?', hands: { [ME]: [D(10), B(9), C(3), B(2), S(5)] },
        say: 'Stessa mano, ma il cavallo ora è di <b>bastoni</b>. Cambia qualcosa?',
        why: 'Il cavallo di bastoni sembra una figura forte, ma i bastoni sono il seme più basso: lo batte qualunque carta di spade, coppe o denari. Una carta alta in un seme basso <b>vale poco</b>. Il seme conta prima del numero.' } },
    { seats: [A, BB, ME, DL], cards: 5, ask: 'call',
      hands: { [ME]: [B(1), B(3), S(2), C(1), S(6)], [A]: [D(10), C(9), S(8), B(6), D(3)], [BB]: [C(10), D(7), S(9), B(9), C(4)], [DL]: [D(9), C(8), B(8), S(4), D(2)] },
      calls: { [A]: 2, [BB]: 1, [DL]: 1 },
      say: 'Una mano tutta bassa. Lia ha chiamato due, Bepi una. Tu?',
      why: 'Niente denari, niente figure: qui il lavoro è <b>non prendere</b>. Però ogni mano qualcuno la deve vincere: se apri tu, o se gli altri buttano più basso di te, una presa ti può cadere addosso anche senza volerla. Più le tue carte sono basse, più è facile restarne fuori.',
      alt: { label: 'E se avessi l\'asso di denari?', hands: { [ME]: [B(1), B(3), S(2), C(1), D(1)] },
        say: 'Al posto del 6 di spade ora hai l\'<b>asso di denari</b>.',
        why: 'L\'asso di denari lo decidi tu quando lo giochi: alto prende sempre, basso non prende mai. Ti lascia una porta aperta, e puoi aspettare a decidere fino a quando lo giochi. È la carta più comoda del mazzo, finché non la sprechi.' } },
    { seats: [A, BB, ME, MA, DL], cards: 2, ask: 'call',
      hands: { [ME]: [C(10), S(2)], [A]: [B(4), D(6)], [BB]: [C(7), S(9)], [MA]: [B(10), C(3)], [DL]: [D(2), S(5)] },
      calls: { [A]: 1, [BB]: 0, [MA]: 0, [DL]: 1 },
      say: 'Due carte, cinque giocatori. Hai il <b>re di coppe</b>. Lia ha chiamato una, Bepi zero.',
      why: 'Il re di coppe è la carta più alta delle coppe, ma sopra ci sono <b>tutti i denari</b>. Con due carte a testa e cinque giocatori, intorno a te girano otto carte: non è strano che fra queste ci sia un denaro. Più giocatori ci sono, più le tue carte forti rischiano di trovare qualcosa sopra.',
      alt: { label: 'E se foste solo in tre?', seats: [A, ME, DL], hands: { [ME]: [C(10), S(2)], [A]: [B(4), C(6)], [DL]: [S(7), S(5)] }, calls: { [A]: 1, [DL]: 0 },
        say: 'Stessa mano, ma al tavolo siete in <b>tre</b>. Lia ha chiamato una.',
        why: 'Con meno giocatori girano meno carte, ed è meno facile che qualcuno abbia un denaro. La stessa carta <b>vale di più</b> in un tavolo piccolo.' } },
  ],
  2: [
    { seats: [A, BB, MA, ME], cards: 3, ask: 'call',
      hands: { [ME]: [D(8), C(9), B(4)], [A]: [D(10), S(3), B(1)], [BB]: [C(5), S(9), D(2)], [MA]: [B(7), C(2), S(6)] },
      calls: { [A]: 1, [BB]: 1, [MA]: 0 },
      say: 'Sei il <b>mazziere</b>. Hanno chiamato una, una e zero: due su tre. Non puoi chiamare una.',
      why: 'Se tutti hanno ragione resta una sola presa libera: proprio quella che non puoi chiamare. Quindi chiediti: è più facile che io <b>non prenda niente</b>, o che ne prenda <b>due</b>? Lia e Bepi una presa la vogliono, quindi giocheranno per prenderla: le tue carte dovranno passare sopra le loro.',
      alt: { label: 'E se avessero chiamato tutti zero?', calls: { [A]: 0, [BB]: 0, [MA]: 0 },
        say: 'Ora hanno chiamato tutti zero: nessuno vuole prendere. Non puoi chiamare tre.',
        why: 'Quando la somma è molto <b>sotto</b> le carte, le prese avanzano: qualcuno dovrà prenderle anche senza volerle. Gli altri cercheranno di scaricare, e chi ha le carte più forti è il primo candidato a prendere.' } },
    { seats: [A, BB, ME, DL], cards: 3, ask: 'call',
      hands: { [ME]: [B(5), S(7), C(2)], [A]: [D(10), D(9), C(8)], [BB]: [C(10), B(6), S(4)], [DL]: [D(3), S(1), B(9)] },
      calls: { [A]: 2, [BB]: 1, [DL]: 1 },
      say: 'Prima di te hanno chiamato due e una: <b>tre su tre</b>. Le prese sono già tutte prenotate.',
      why: 'Se Lia e Bepi hanno visto giusto, per te non resta niente. Non è detto che abbiano ragione, ma è un indizio forte: due persone con carte buone si contenderanno le prese. Le chiamate degli altri ti dicono <b>cosa hanno in mano</b>.',
      alt: { label: 'E se avessero chiamato zero?', calls: { [A]: 0, [BB]: 0, [DL]: 1 },
        say: 'Ora prima di te hanno chiamato zero e zero.',
        why: 'Nessuno vuole prendere e tre mani sono tutte da assegnare. Le tue carte sono basse, ma anche gli altri butteranno basso: qualcuno prenderà per forza. Più la somma è lontana dalle carte, più le prese finiscono a chi non le voleva.' } },
  ],
  3: [
    { seats: [A, ME, BB, DL], cards: 3, ask: 'play',
      hands: { [ME]: [D(6), C(4), B(2)], [A]: [S(9), C(10), B(3)], [BB]: [C(8), S(1), D(2)], [DL]: [D(10), B(7), S(6)] },
      calls: { [A]: 1, [ME]: 1, [BB]: 1, [DL]: 1 }, pre: [[A, S(9)]],
      say: 'Hai chiamato una. Lia apre con il <b>cavallo di spade</b>. Hai il 6 di denari, il 4 di coppe e il 2 di bastoni.',
      why: 'Il tuo 6 di denari batte il cavallo di spade, ma dopo di te giocano ancora Bepi e Nico: se uno dei due ha un denaro più alto, la tua carta migliore è sprecata. D\'altra parte il 4 di coppe e il 2 di bastoni da soli prendono di rado. La domanda è: <b>questa mano è l\'occasione migliore</b> che avrai, o ne arriverà una più facile?',
      alt: { label: 'E se giocassi per ultimo?', seats: [A, BB, DL, ME], calls: { [A]: 1, [BB]: 1, [DL]: 1, [ME]: 1 }, pre: [[A, S(9)], [BB, S(1)], [DL, S(6)]],
        say: 'Ora sei il mazziere e giochi <b>per ultimo</b>: sono usciti il cavallo di spade, l\'asso di spade e il 6 di spade.',
        why: 'Quando giochi per ultimo non c\'è niente da indovinare: sai esattamente cosa serve per prendere e cosa per lasciare. Qui anche il 4 di coppe batte tutte le spade sul tavolo. Ma guarda anche <b>cosa ti resta in mano dopo</b>: una carta forte tenuta per dopo può prendere quando non vuoi. Il posto in cui giochi conta quanto le carte che hai.' } },
    { seats: [ME, A, BB, DL], cards: 3, ask: 'play',
      hands: { [ME]: [B(1), C(6), D(7)], [A]: [S(3), C(9), B(8)], [BB]: [D(5), S(10), B(5)], [DL]: [D(10), C(2), S(4)] },
      calls: { [ME]: 0, [A]: 1, [BB]: 1, [DL]: 2 },
      say: 'Hai chiamato zero e tocca a te aprire. Hai l\'asso di bastoni, il 6 di coppe e il 7 di denari.',
      why: 'Chi apre gioca per primo e tutti rispondono dopo: con una carta bassa basta che qualcuno butti più alto e sei salvo. Il 7 di denari invece batte tutto ciò che non è denaro: è la tua carta più <b>pericolosa</b>. Chiediti in quale momento avrà più probabilità di trovare qualcosa sopra.' },
    { seats: [A, ME, BB, DL], cards: 4, ask: 'play',
      hands: { [ME]: [D(9), D(6), C(5), S(2)], [A]: [B(4), C(10), S(8), B(9)], [BB]: [B(3), S(1), C(1), D(3)], [DL]: [S(5), C(7), B(10), D(4)] },
      calls: { [A]: 1, [ME]: 1, [BB]: 0, [DL]: 1 }, pre: [[A, B(4)], [ME, D(9)], [BB, B(3)], [DL, S(5)]],
      say: 'Hai preso la tua mano con il cavallo di denari: sei <b>a posto</b>. Ora apri tu, con il 6 di denari, il 5 di coppe e il 2 di spade.',
      why: 'Da qui in poi ogni presa ti costa una vita. Il 6 di denari è la carta che più facilmente prende senza volerlo. Se la apri adesso qualcuno potrebbe coprirla; se la tieni, potresti doverla giocare quando nessuno può più batterla. Non c\'è una risposta unica: conta <b>quante carte sopra</b> ha ancora in giro.' },
  ],
  4: [
    { seats: [A, ME, BB, DL], cards: 3, ask: 'call',
      hands: { [ME]: [D(1), B(2), S(3)], [A]: [C(8), D(7), B(5)], [BB]: [S(10), C(4), B(9)], [DL]: [D(10), C(6), S(1)] },
      calls: { [A]: 1, [BB]: 1, [DL]: 0 },
      say: 'Hai l\'asso di denari, il 2 di bastoni e il 3 di spade. Lia ha chiamato una.',
      why: 'Le due carte basse quasi certamente non prendono. L\'asso di denari invece prende o lascia, <b>come vuoi tu</b>. Sia zero sia una sono chiamate che puoi difendere: a decidere sarà come lo giocherai. Due prese invece ti chiederebbero un regalo dalle carte basse.',
      alt: { label: 'E se avessi anche due re?', hands: { [ME]: [D(1), D(10), C(10)], [DL]: [D(9), C(6), S(1)] },
        say: 'Ora hai l\'asso di denari, il <b>re di denari</b> e il <b>re di coppe</b>.',
        why: 'Il re di denari perde solo con l\'asso alto, e l\'asso ce l\'hai tu. Il re di coppe ha sopra solo i denari. Con l\'asso puoi anche <b>scegliere</b> di non prendere, se le altre due bastano: il jolly ti serve ad aggiustare il conto alla fine.' } },
    { seats: [A, ME, BB, DL], cards: 3, ask: 'play',
      hands: { [ME]: [D(1), C(8), S(7)], [A]: [C(3), C(9), B(2)], [BB]: [D(8), S(4), B(10)], [DL]: [C(10), D(5), S(9)] },
      calls: { [A]: 1, [ME]: 1, [BB]: 1, [DL]: 1 }, pre: [[A, C(3)]],
      say: 'Hai chiamato una. Lia apre con il 3 di coppe. Hai l\'asso di denari, il fante di coppe e il 7 di spade.',
      why: 'Se giochi l\'asso alto adesso la tua presa è fatta, ma restano due carte e <b>nessuna protezione</b>: se il fante di coppe o il 7 di spade prendono per sbaglio, perdi una vita. Se aspetti, l\'asso resta lì e alla fine lo usi alto o basso secondo quello che serve. Il jolly vale tanto finché non lo giochi: chiediti se ti serve <b>adesso</b>.' },
  ],
  5: [
    { seats: [ME, A, BB, DL], cards: 4, ask: 'call',
      hands: { [ME]: [D(5), C(8), S(9), B(3)], [A]: [D(9), C(2), B(7), S(1)], [BB]: [C(10), D(3), S(5), B(8)], [DL]: [D(10), C(6), S(4), B(1)] },
      calls: { [A]: 1, [BB]: 2, [DL]: 0 },
      say: 'Quattro carte e chiami <b>per primo</b>: degli altri non sai ancora niente.',
      why: 'Per primo puoi solo contare le tue carte. Il 5 di denari batte tutto tranne i denari più alti; il fante di coppe e il cavallo di spade sono buone carte ma con parecchio sopra; il 3 di bastoni difficilmente prende. Chiamando per primo ogni carta di mezzo è un <b>punto interrogativo</b>: non sai ancora chi la coprirà.',
      alt: { label: 'E se fossi il mazziere?', seats: [A, BB, DL, ME], calls: { [A]: 1, [BB]: 0, [DL]: 1 },
        say: 'Stessa mano, ma ora sei il mazziere: hanno chiamato una, zero e una.',
        why: 'Ora sai che gli altri si aspettano poche prese: due su quattro. Le prese che avanzano finiranno a qualcuno, e le tue carte di mezzo avranno più occasioni. Il vincolo ti toglie il due: devi scegliere se stare sopra o sotto.' } },
    { seats: [A, BB, MA, ME], cards: 3, ask: 'play',
      hands: { [ME]: [C(6), D(2), S(3)], [A]: [B(9), C(1), S(8)], [BB]: [S(2), B(6), C(9)], [MA]: [C(4), B(1), D(7)] },
      calls: { [A]: 1, [BB]: 0, [MA]: 0, [ME]: 1 }, pre: [[A, B(9)], [BB, S(2)], [MA, C(4)]],
      say: 'Hai chiamato una e giochi <b>per ultimo</b>: sono usciti il cavallo di bastoni, il 2 di spade e il 4 di coppe.',
      why: 'Hai tutte le informazioni: il 6 di coppe batte tutto quello che c\'è sul tavolo, e anche il 2 di denari. Il 3 di spade no. Da ultimo non c\'è rischio nel prendere: c\'è solo da scegliere <b>quale carta spendere</b>. Una carta che prende qui potrebbe servirti di più in un\'altra mano, quando non sarai ultimo.' },
  ],
  6: [
    { seats: [A, BB, MA, ME], cards: 4, ask: 'call',
      hands: { [ME]: [D(8), C(2), B(5), S(4)], [A]: [D(10), D(9), C(10), B(1)], [BB]: [C(9), S(10), B(2), D(3)], [MA]: [D(7), C(8), S(9), B(10)] },
      calls: { [A]: 2, [BB]: 1, [MA]: 2 },
      say: 'Sei il mazziere. Hanno chiamato due, una e due: <b>cinque su quattro</b>.',
      why: 'Hanno chiamato più prese di quante ce ne siano: qualcuno sbaglierà di sicuro. Tutti giocheranno per prendere, buttando le carte forti, e in una mano così le tue carte medie vengono <b>coperte</b> facilmente. Il fante di denari è la tua carta migliore, e anche lui ha sopra tre denari e l\'asso.',
      alt: { label: 'E se avessero chiamato poco?', calls: { [A]: 0, [BB]: 1, [MA]: 0 },
        say: 'Ora hanno chiamato zero, una e zero: <b>una su quattro</b>. Non puoi chiamare tre.',
        why: 'Tre prese sono senza padrone. Gli altri cercheranno di scaricare: butteranno basso, e le tue carte medie, che prima venivano coperte, ora rischiano di <b>prendere</b>. Le stesse carte, con chiamate diverse, valgono in modo diverso.' } },
  ],
  7: [
    { seats: [A, ME, BB, DL], cards: 3, ask: 'play',
      hands: { [ME]: [D(10), C(9), B(6)], [A]: [B(2), S(1), C(3)], [BB]: [D(7), S(8), B(4)], [DL]: [B(1), S(2), C(4)] },
      calls: { [A]: 0, [ME]: 1, [BB]: 1, [DL]: 0 }, pre: [[A, B(2)], [ME, D(10)], [BB, B(4)], [DL, B(1)]],
      say: 'Hai preso con il re di denari: sei a posto. Ora apri tu. <b>Bepi</b> ha chiamato una e non ha ancora preso; Lia e Nico vogliono zero.',
      why: 'Bepi gioca dopo di te e ha bisogno di una presa: se può, prenderà. Lia e Nico invece cercheranno di non prendere. Una tua carta media può essere coperta da Bepi, oppure restare la più alta perché gli altri scaricano. Prima di aprire chiediti: <b>chi gioca dopo di me, e cosa vuole?</b>',
      alt: { label: 'E se Bepi fosse già a posto?', calls: { [A]: 0, [ME]: 1, [BB]: 0, [DL]: 1 },
        say: 'Stessa mano, ma ora <b>Bepi</b> ha chiamato zero e <b>Nico</b> una. Nico gioca per ultimo.',
        why: 'Ora chi deve prendere è Nico, che gioca dopo tutti: vede le carte di tutti prima di decidere. Se gli serve, coprirà la tua carta; se la tua è troppo alta per lui, la presa resta a te. Conta <b>chi ha ancora fame</b> e dove siede.' } },
  ],
  8: [
    { seats: [A, ME, BB, DL], cards: 1, ask: 'call',
      hands: { [ME]: [D(5)], [A]: [C(10)], [BB]: [B(3)], [DL]: [S(7)] },
      calls: { [A]: 0, [BB]: 0, [DL]: 0 },
      say: 'Vedi il re di coppe di Lia, il 3 di bastoni di Bepi e il 7 di spade di Nico. La tua carta è <b>coperta</b>. Lia, che la vede, ha chiamato zero.',
      why: 'Per batterle tutte la tua carta deve stare sopra il re di coppe, cioè essere un <b>denaro</b>. C\'è anche un indizio: Lia vede la tua carta e ha chiamato zero pur avendo un re di coppe. Le chiamate di chi vede la tua carta sono l\'unica finestra che hai su di lei.',
      alt: { label: 'E se Lia avesse il cavallo di denari?', hands: { [ME]: [C(2)], [A]: [D(9)] }, calls: { [A]: 1, [BB]: 0, [DL]: 0 },
        say: 'Ora Lia ha il <b>cavallo di denari</b> e ha chiamato una.',
        why: 'Sopra il cavallo di denari ci sono solo il re e l\'asso di denari: due carte in tutto il mazzo. E Lia, che vede la tua carta, pensa di prendere. Gli indizi vanno tutti nella stessa direzione.' } },
  ],
  9: [
    { seats: [A, ME, BB, DL], cards: 4, ask: 'play', above: true,
      hands: { [ME]: [C(10), C(2), B(5), S(6)], [A]: [D(10), D(9), B(3), S(2)], [BB]: [D(8), D(6), S(1), B(1)], [DL]: [D(7), C(5), B(8), S(3)] },
      calls: { [A]: 2, [ME]: 1, [BB]: 1, [DL]: 1 },
      pre: [[A, D(10)], [ME, B(5)], [BB, D(6)], [DL, D(7)], [A, D(9)], [ME, S(6)], [BB, D(8)], [DL, B(8)], [A, B(3)]],
      say: 'Terza mano. Sono usciti il re, il cavallo, il fante, il 7 e il 6 di denari. Hai il re di coppe e il 2 di coppe, e ti serve ancora una presa. Lia ha già le sue due prese e apre con il 3 di bastoni. <b>Tocca una carta</b> per vedere quante più forti sono ancora in giro.',
      why: 'Sopra il tuo re di coppe ci sono solo i denari. Molti sono già usciti: restano l\'asso e i denari piccoli, e in mano agli altri sono rimaste poche carte. All\'inizio il re di coppe aveva tanto sopra, ora molto meno. <b>Contare le carte uscite</b> ti dice quanto vale davvero una carta in questo momento.' },
  ],
  10: [
    { seats: [A, ME, BB, DL], cards: 2, ask: 'call', lives: { [ME]: 1 }, bonusUsed: true,
      hands: { [ME]: [C(7), B(9)], [A]: [D(4), S(2)], [BB]: [C(1), B(3)], [DL]: [S(10), C(5)] },
      calls: { [A]: 1, [BB]: 0, [DL]: 0 },
      say: 'Ti resta <b>una vita</b> e la vita bonus è già stata presa: se sbagli sei fuori. Hai il 7 di coppe e il cavallo di bastoni. Lia ha chiamato una.',
      why: 'Con una vita sola non conta solo cosa è più probabile, ma <b>quanto puoi aggiustare</b> durante il gioco. Il 7 di coppe può prendere o no, dipende da cosa esce. Il cavallo di bastoni prende solo se tutti buttano bastoni più bassi. Chiediti quale chiamata dipende meno dalla fortuna.' },
    { seats: [A, ME, BB, DL], cards: 3, ask: 'call', lives: { [ME]: 2 },
      hands: { [ME]: [D(10), D(9), D(8)], [A]: [C(10), S(4), B(1)], [BB]: [D(7), C(3), S(9)], [DL]: [B(10), C(6), S(1)] },
      calls: { [A]: 1, [BB]: 1, [DL]: 0 },
      say: 'Tre carte: re, cavallo e fante di denari. Hai <b>due vite</b>. Lia ha chiamato una.',
      why: 'Le tue tre carte sono in cima al mazzo: sopra hanno solo l\'asso di denari, che però può essere giocato alto. Se chiami tre e le prendi tutte <b>guadagni una vita</b>; se ne prendi due, ne perdi una. Il premio c\'è, ma va pesato: <b>chi può avere l\'asso</b>, e cosa ne farà?' },
  ],
};

// Prepara lo stato di uno scenario (variant = la versione "E se…?").
export function scenarioOf(n, i, variant) {
  const base = SCENARIOS[n][i];
  if (!variant || !base.alt) return base;
  const a = base.alt;
  return { ...base, ...a, hands: { ...base.hands, ...(a.hands || {}) }, calls: { ...base.calls, ...(a.calls || {}) }, alt: null };
}

export function buildScenario(sc, myName) {
  const s = E.createGame({ code: 'TUT', hostId: ME, hostName: myName || 'Tu' });
  for (const id of sc.seats) if (id !== ME) E.addPlayer(s, { id, name: NAMES[id], cpu: { level: 'medio' } });
  E.startGame(s, { rng: () => 0.1 });
  const seats = sc.seats.slice();
  const dealer = seats[seats.length - 1];
  s.order = seats.slice();
  s.firstDealer = dealer;
  for (const p of s.players) if (sc.lives?.[p.id]) p.lives = sc.lives[p.id];
  if (sc.bonusUsed) s.bonusZeroUsed = true;
  const r = s.round;
  Object.assign(r, {
    cards: sc.cards, dealerId: dealer, seats,
    hands: Object.fromEntries(seats.map((id) => [id, sc.hands[id].slice().sort((x, y) => x - y)])),
    calls: {}, won: Object.fromEntries(seats.map((id) => [id, 0])),
    turnId: seats[0], trick: { leader: seats[0], plays: [] }, trickNo: 1,
    lastTrick: null, played: [], playedBy: {}, tricks: [], pendingJolly: null, results: null,
  });
  for (const id of seats) {
    if (s.phase !== 'calling') break;
    if (id === ME && sc.ask === 'call') break;
    E.makeCall(s, id, sc.calls[id]);
  }
  for (const [pid, card, j] of sc.pre || []) E.playCard(s, pid, card, j);
  r.lastTrick = null;
  if (r.turnId !== ME) throw new Error('scenario: non tocca a te');
  return s;
}

// Domanda del maestro nella partita libera
export function maestroQuestion(s, me) {
  const r = s.round;
  if (s.phase === 'calling') {
    if (r.cards === 1) return 'Non vedi la tua carta: guarda quelle degli altri. Quali carte del mazzo le batterebbero tutte? E cosa ha chiamato chi vede la tua?';
    const sum = Object.values(r.calls).reduce((a, b) => a + b, 0);
    if (r.dealerId === me) {
      const f = E.forbiddenCall(s);
      return `Sei il mazziere: gli altri hanno chiamato ${sum} su ${r.cards}.${f != null ? ` Non puoi chiamare ${f}.` : ''} Le prese che restano, a chi andranno?`;
    }
    if (!Object.keys(r.calls).length) return 'Chiami per primo. Quali tue carte prendono da sole, e quali quasi mai?';
    return `Finora le chiamate fanno ${sum} su ${r.cards}. Quante carte forti hai, e quante carte ci sono sopra ognuna?`;
  }
  const need = (r.calls[me] ?? 0) - r.won[me];
  const lead = !r.trick.plays.length;
  if (need < 0) return 'Hai preso più di quanto avevi chiamato. Ogni presa in più ti costa un\'altra vita: come fai a non prenderne più?';
  if (need === 0) return lead ? 'Sei a posto e apri tu. Quale carta rischia di prendere senza che tu voglia? Quando avrà più probabilità di essere coperta?' : 'Sei a posto. Quale carta puoi buttare senza prendere, tenendo le più sicure per dopo?';
  const left = r.cards - r.trickNo + 1;
  if (need >= left) return `Ti servono tutte le mani che restano. Questa la puoi vincere?`;
  return lead ? `Ti mancano ${need === 1 ? 'una presa' : need + ' prese'} e apri tu: tutti giocheranno dopo di te. Cosa vuoi che succeda in questa mano?` : `Ti mancano ${need === 1 ? 'una presa' : need + ' prese'}. Questa mano puoi vincerla? Chi gioca dopo di te deve ancora prendere?`;
}
