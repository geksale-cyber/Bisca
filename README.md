# Bisca

Web app per giocare a Bisca con le carte trevigiane dal telefono: single player contro la CPU e multiplayer con gli amici, da 3 a 13 al tavolo.
Gira tutta su Cloudflare (piano gratuito): pagine statiche, una stanza di gioco per partita (Durable Object con WebSocket) e un archivio delle partite da cui la CPU impara.

## Pubblicarla online

Serve un account Cloudflare (gratuito). Due strade:

**Dal browser, con GitHub** (nessuna installazione)
1. Crea un repository su GitHub e carica tutto il contenuto di questa cartella (non la cartella stessa: `wrangler.toml` deve stare nella pagina principale del repository).
2. Su Cloudflare: Workers & Pages → Crea → Importa un repository → scegli il repository. Cloudflare trova `wrangler.toml` e pubblica.
3. Alla fine ti dà l'indirizzo, tipo `https://bisca.<tuo-nome>.workers.dev`.

**Dal computer**
```
npm install
npx wrangler login
npx wrangler deploy
```

## Installarla sul telefono

- iPhone (Safari): apri il link → Condividi → "Aggiungi alla schermata Home".
- Android (Chrome): apri il link → menu ⋮ → "Installa app".

## Come si usa

- **Home**: la tavolata animata (tocca un personaggio, quello nascosto o l'asso di denari), poi "Gioca con i tuoi amici", "Single player", "Spettatore" e "Come scaricare l'app". "Allenati e impara la Bisca" apre le lezioni di Fabrizio Corona su tre livelli (Principiante, Intermedio, Avanzato). La Lezione 0 è una mano guidata; le altre sono situazioni preparate: decidi, vedi a parole quanto è probabile che vada bene, leggi il ragionamento, poi Riprova, "E se…?" (una variante), "Guarda come va" (si gioca il resto della mano) o Avanti. I contatori (prese in palio, chiamate, differenza, carte più forti ancora in giro) ci sono solo nelle lezioni. L'ultima è una partita vera con il maestro che fa domande e, se vuoi, dà un consiglio a parole. Un livello si apre quando completi il precedente; i progressi restano sul telefono.
- **Single player**: nome e avatar, quanti avversari (2-12), difficoltà e vista. La CPU aspetta 5 secondi prima di ogni mossa (4 a difficile).
- **Crea / Accedi a una stanza**: nome e avatar si scelgono subito, prima di entrare. Un personaggio già preso nella stanza non si può scegliere. Dal link d'invito si sceglie se giocare o guardare.
- **Vista del tavolo**: "Tavolo" (ovale blu, giocatori attorno in senso antiorario, carte giocate accanto a chi le ha tirate) o "Classica" (fila dei giocatori in alto). Si cambia dal menu durante la partita o prima del single player.
- **Giocare**: si tocca la carta e parte subito (l'asso di denari chiede alta o bassa). Nel menu c'è l'opzione "Chiedi conferma prima di giocare".
- **Pulsanti rapidi** (accanto alla mano):
  - **Presa**: mai l'asso di denari. Se ti manca solo questa presa, la tua carta più alta. Se te ne servono altre, la più bassa che prende di sicuro; se nessuna è sicura, la più alta come consiglio (segnato con "?"). Disattivato se sei già a posto (bordo rosso) o se nessuna carta prende.
  - **Parcheggio**: quando apri tu, la carta più bassa. Altrimenti solo carte che restano sotto la migliore sul tavolo: tiene da parte le carte che servono per le prese mancanti (una in più se le chiamate superano le mani) e parcheggia la più scarsa; se sei a posto butta la più alta che resta sotto. L'asso basso solo come ultima scelta. Disattivato se nessuna carta resta sotto.
- **Tempo per giocare (multiplayer)**: chi è online ha 1 minuto per mossa (il conto alla rovescia compare negli ultimi 15 secondi). Chi va offline ha 30 secondi per rientrare; poi gioca la CPU al suo posto, e da lì in avanti ogni sua mossa parte dopo 7 secondi finché non rientra. Le CPU aggiunte dall'host giocano dopo 6 secondi.
- **Spettatori**: dalla home "Spettatore" mostra le partite in corso e le stanze in attesa. Chi guarda (anche chi è stato eliminato) vede solo le carte giocate: le mani non partono proprio dal server. Può chiedere a un giocatore di vedere le sue carte: se dice sì le vede fino alla fine della partita (tranne nel turno da 1 carta); se dice no può chiedere a un altro. I giocatori vedono l'occhio con il numero di spettatori.
- **Fine partita**: "Inizia una nuova partita, torna in lobby" oppure "torna al menù principale".
- **Chat** (solo multiplayer) con @tag, **espulsione** dal turno successivo, **cambio host** se l'host resta offline più di un minuto.

## Pannello admin

`https://<il-tuo-indirizzo>/admin.html` con la chiave `STATS_KEY` di `wrangler.toml`.
- **Statistiche**: persone, partite, grafici degli ultimi 30 giorni, chi gioca di più, ultime partite.
- **Avatar**: aggiungi (PNG o WebP già scontornati, anche tanti insieme; con un `index.json` accanto vengono letti nomi e pose), rinomina, posa (serve alla scena della home), frase della nuvoletta, visibile/nascosto, ordine, sostituisci immagine, elimina. Gli avatar stanno nell'archivio sul server, non nei file dell'app. Chi aveva un avatar nascosto o eliminato ne sceglie un altro.
- La prima volta l'elenco è vuoto: carica la cartella "avatar-iniziali" (i 40 personaggi con il loro index.json).

## La CPU

- Vede solo quello che vedrebbe un giocatore. Per chiamare e per giocare immagina centinaia di distribuzioni delle carte coerenti con le chiamate fatte e sceglie la mossa che più spesso le fa centrare la chiamata.
- Ogni CPU ha un carattere (più prudente o più spavalda) che la situazione sposta.
- Impara dalle partite: ogni chiamata e giocata delle persone viene salvata nell'archivio, con un profilo per ogni nome.
- Livelli: facile (sbaglia apposta ogni tanto), medio, difficile.

## Provarla sul computer

```
npm install
npm run dev                         # http://localhost:8787
npm test                            # regole e prove sulla CPU
npx wrangler dev --var CPU_DELAY_MS:60 --var PROXY_DELAY_MS:1500   # in un altro terminale
node test/e2e-extra.mjs             # timer, subentro, spettatori (vedi intestazione del file)
npm run e2e                         # partita multiplayer completa via WebSocket
npm run bench                       # torneo CPU contro CPU
```

## File

- `public/lib/engine.js` — tutte le regole (le usano sia l'app sia il server)
- `public/lib/ai.js` — la CPU
- `public/app.js`, `public/style.css`, `public/index.html` — l'app
- `public/carte/` — le 40 carte (dalle tue foto)
- `public/lib/quick.js` — i tasti rapidi Presa e Parcheggio
- `public/lib/tutorial.js` — le lezioni: carte preparate, scenari con varianti, mosse delle CPU e frasi del maestro (le probabilità vengono da `evaluateOptions` in `ai.js` e sono mostrate solo a parole)
- `public/admin.html` — pannello admin (statistiche e avatar)
- `public/icons/` — icone dell'app, titolo della home e dorso delle carte
- `src/worker.js` — server: stanze, CPU lato server, archivio partite e profili
- `tools/build-artifact.mjs` — prepara la versione single player per la pagina su Claude
- `wrangler.toml` — configurazione Cloudflare
