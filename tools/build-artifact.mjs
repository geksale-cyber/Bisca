// Prepara la versione per la pagina su Claude (solo single player): CSS dentro la pagina,
// nessun manifest né service worker. Uscita in build/artifact/.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'build/artifact');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'lib'), { recursive: true });
fs.mkdirSync(path.join(out, 'carte'), { recursive: true });
const css = fs.readFileSync(path.join(root, 'public/style.css'), 'utf8');
fs.writeFileSync(path.join(out, 'index.html'), `<title>Bisca</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap">
<style>
${css}
</style>
<div id="app"></div>
<div id="sheet" class="sheet" hidden></div>
<div id="toast" role="status" aria-live="polite" hidden></div>
<script type="module" src="app.js"></script>
`);
for (const f of ['app.js', 'lib/engine.js', 'lib/ai.js', 'lib/quick.js', 'lib/tutorial.js']) fs.copyFileSync(path.join(root, 'public', f), path.join(out, f));
for (const f of fs.readdirSync(path.join(root, 'public/carte'))) fs.copyFileSync(path.join(root, 'public/carte', f), path.join(out, 'carte', f));
fs.cpSync(path.join(root, 'public/icons'), path.join(out, 'icons'), { recursive: true });
// i personaggi stanno fuori dal progetto (online li gestisce il pannello admin)
const pack = process.env.AVATAR_PACK || path.join(root, '../avatar-pack');
if (fs.existsSync(pack)) fs.cpSync(pack, path.join(out, 'avatar'), { recursive: true });
console.log('pronto:', out);
