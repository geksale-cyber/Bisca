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

- **Home**: "Gioca con i tuoi amici" oppure "Single player".
- **Single player**: scegli nome, quanti avversari (2-12), la difficoltà e la velocità della CPU.
- **Come scaricare l'app**: dalla home, le istruzioni per iPhone e Android per aggiungerla alla schermata Home.
- **Crea una stanza**: scegli il nome, entri nella sala d'attesa con il codice d'invito da mandare. Da host puoi aggiungere CPU (CPU1, CPU2…) scegliendo quante e il livello, cambiare il livello di ognuna, togliere giocatori e CPU, e avviare quando al tavolo siete almeno in 3.
- **Accedi a una stanza**: nome e codice (o apri il link d'invito). Se il nome è già usato nella stanza te lo dice prima di farti entrare. A partita iniziata puoi entrare come spettatore.
- In sala d'attesa ognuno può cambiarsi il nome (matita accanto al proprio nome).
- **Fine partita**: "Inizia una nuova partita, torna in lobby" (stessa stanza, stessi giocatori e CPU) oppure "Esci dalla stanza, torna al menù principale".
- **Tempo per giocare**: chi è online ha al massimo 1 minuto per ogni mossa; il conto alla rovescia compare negli ultimi 15 secondi. Chi va offline ha 30 secondi per rientrare (sempre dentro il minuto). Allo scadere gioca la CPU al suo posto. Al tavolo il pallino verde o rosso dice chi è online.
- **Espulsione**: toccando un giocatore l'host può espellerlo dal turno successivo. Se l'host resta offline più di un minuto, un altro giocatore può diventare host.
- **Chat** (solo multiplayer): pallino in basso a destra con i messaggi non letti. Scrivendo @ escono i nomi di chi è nella stanza; chi viene taggato vede il messaggio evidenziato, il telefono vibra e sul pallino compare la @.
- **Avatar**: toccando il proprio avatar in sala d'attesa si sceglie una foto (fotocamera o galleria, ritagliata tonda) o un personaggio. Il telefono lo ricorda per le stanze successive.
- Il telefono ricorda il posto di ognuno: se l'app si chiude si rientra nella stessa stanza.

## Statistiche

Apri `https://bisca.<tuo-nome>.workers.dev/stats.html` e inserisci la chiave che trovi in `wrangler.toml` alla voce `STATS_KEY`. La pagina non è collegata dall'app: la vede solo chi ha la chiave.
Mostra quante persone (telefoni) usano l'app, quante l'hanno messa in Home, le partite single player e multiplayer iniziate e finite, l'andamento degli ultimi 30 giorni, chi gioca di più e le ultime partite.
Ogni telefono è contato con un codice a caso salvato nell'app, senza dati personali. Per cambiare la chiave modifica `STATS_KEY` (tieni il repository GitHub privato).

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
npm run e2e                         # partita multiplayer completa via WebSocket
npm run bench                       # torneo CPU contro CPU
```

## File

- `public/lib/engine.js` — tutte le regole (le usano sia l'app sia il server)
- `public/lib/ai.js` — la CPU
- `public/app.js`, `public/style.css`, `public/index.html` — l'app
- `public/carte/` — le 40 carte (dalle tue foto)
- `public/avatar/` — i personaggi: un file `<id>.webp` per ognuno e l'elenco in `index.json` (`[{"id": "nonno", "name": "Il nonno"}]`)
- `src/worker.js` — server: stanze, CPU lato server, archivio partite e profili
- `tools/build-artifact.mjs` — prepara la versione single player per la pagina su Claude
- `wrangler.toml` — configurazione Cloudflare
