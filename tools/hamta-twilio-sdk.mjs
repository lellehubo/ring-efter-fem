#!/usr/bin/env node
/* Hämtar Twilios Voice JavaScript SDK (version 2.x) till vendor/twilio.min.js.
   Twilio har ingen CDN för version 2, så filen läggs i repot.

   Kör i repots rot:
     node tools/hamta-twilio-sdk.mjs
   eller, om du har laddat ned paketet själv:
     node tools/hamta-twilio-sdk.mjs --fran-fil voice-sdk-2.18.5.tgz

   Inget behöver installeras. Skriptet hämtar paketet från npm, kontrollerar
   kontrollsumman mot registret, packar ut dist/twilio.min.js och licensen. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '2.18.5';
const PKG = '@twilio/voice-sdk';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'vendor');

function fail(msg) { console.error('Fel: ' + msg); process.exit(1); }

// Minimal tar-läsare: 512-byteshuvuden, namn i byte 0–99, prefix i 345–499, storlek oktalt i 124–135.
function untar(buf) {
  const files = new Map();
  let off = 0;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const str = (a, b) => h.subarray(a, b).toString('utf8').replace(/\0.*$/s, '');
    const name = str(0, 100); const prefix = str(345, 500);
    const size = parseInt(str(124, 136).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    const full = prefix ? prefix + '/' + name : name;
    off += 512;
    if (type === '0' || type === '\0') files.set(full, buf.subarray(off, off + size));
    off += Math.ceil(size / 512) * 512;
  }
  return files;
}

async function fetchTarball() {
  const metaUrl = 'https://registry.npmjs.org/' + PKG + '/' + VERSION;
  const metaRes = await fetch(metaUrl);
  if (!metaRes.ok) fail('npm-registret svarade ' + metaRes.status + ' för ' + metaUrl);
  const meta = await metaRes.json();
  const { tarball, integrity } = meta.dist || {};
  if (!tarball || !integrity) fail('registret gav ingen tarball eller kontrollsumma');
  const res = await fetch(tarball);
  if (!res.ok) fail('hämtningen svarade ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  const [algo, want] = integrity.split('-');
  const got = createHash(algo).update(buf).digest('base64');
  if (got !== want) fail('kontrollsumman stämmer inte (' + algo + ')');
  console.log('Hämtade ' + PKG + '@' + VERSION + ', kontrollsumman stämmer.');
  return buf;
}

const i = process.argv.indexOf('--fran-fil');
const tgz = i > -1 ? readFileSync(process.argv[i + 1] || fail('ange en fil efter --fran-fil')) : await fetchTarball();
const files = untar(gunzipSync(tgz));

const js = files.get('package/dist/twilio.min.js');
if (!js) fail('paketet saknar package/dist/twilio.min.js');
const pkg = files.get('package/package.json');
if (pkg) {
  const v = JSON.parse(pkg.toString('utf8')).version;
  if (v !== VERSION) console.warn('Obs: paketet är version ' + v + ', skriptet väntade ' + VERSION);
}
if (!/addProcessor|AudioProcessor/.test(js.toString('utf8'))) fail('den här versionen verkar sakna AudioProcessor');

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'twilio.min.js'), js);
const lic = files.get('package/LICENSE.md') || files.get('package/LICENSE');
if (lic) writeFileSync(join(OUT_DIR, 'twilio-LICENSE.md'), lic);
writeFileSync(join(OUT_DIR, 'twilio-VERSION.txt'),
  PKG + '@' + VERSION + '\nsha256 ' + createHash('sha256').update(js).digest('hex') + '\n');
console.log('Skrev vendor/twilio.min.js (' + Math.round(js.length / 1024) + ' kB)');
console.log('Committa vendor/ så att GitHub Pages har filen.');
