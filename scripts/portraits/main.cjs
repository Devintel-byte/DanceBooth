// Renders character-select portraits from the actual 3D characters.
//
// Usage: pnpm assets:portraits [--only <characterId>]
// Runs Electron (already installed for the app) with a hidden window, loads
// every FBX/GLB character in assets/characters/catalog.json, poses it in its
// idle clip and writes assets/characters/thumbs/<id>.png (320×320, transparent).
// Add "thumbnail": "characters/thumbs/<id>.png" to the catalog entry afterwards.
/* eslint-disable */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..', '..');
const assets = path.join(root, 'assets');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.whenReady().then(async () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(assets, 'characters', 'catalog.json'), 'utf-8'));
  const chars = catalog.characters
    .filter((c) => c.kind === 'glb' && (!only || c.id === only))
    .map((c) => ({ id: c.id, file: c.file, idle: c.rig.clips.idle, clipFiles: c.rig.clipFiles ?? [] }));
  if (!chars.length) throw new Error(only ? `no character "${only}" in the catalog` : 'no characters in the catalog');
  // Local developer tool: loads only files from this repository, so file:// module loading is allowed here.
  const win = new BrowserWindow({ show: false, width: 512, height: 512, webPreferences: { webSecurity: false, offscreen: false } });
  const page = pathToFileURL(path.join(__dirname, 'page.html'));
  page.searchParams.set('root', pathToFileURL(root + path.sep).href);
  await win.loadURL(page.href);
  const out = path.join(assets, 'characters', 'thumbs');
  fs.mkdirSync(out, { recursive: true });
  for (const c of chars) {
    const data = await win.webContents.executeJavaScript(`window.renderPortrait(${JSON.stringify(c)})`);
    fs.writeFileSync(path.join(out, `${c.id}.png`), Buffer.from(data.split(',')[1], 'base64'));
    console.info(`characters/thumbs/${c.id}.png`);
  }
  app.quit();
}).catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  app.exit(1);
});
