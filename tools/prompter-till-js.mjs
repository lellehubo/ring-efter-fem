// Skriver bankgrannen-prompter.js från specs/bankgrannen/PROMPTER.md.
// Varje kodblock med en markör <!-- js:NAMN --> på raden före blir en konstant.
// ```text-block blir strängar, ```json-block blir objekt.
// Kör: node tools/prompter-till-js.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'specs/bankgrannen/PROMPTER.md'), 'utf8').replace(/\r\n/g, '\n');
const lines = src.split('\n');
const out = {};
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^<!-- js:([A-Z0-9_]+) -->$/);
  if (!m) continue;
  const name = m[1];
  const fence = lines[i + 1] || '';
  const lang = (fence.match(/^```(\w+)/) || [])[1];
  if (!lang) throw new Error(`Markören ${name} följs inte av ett kodblock (rad ${i + 2})`);
  const body = [];
  let j = i + 2;
  while (j < lines.length && !lines[j].startsWith('```')) body.push(lines[j++]);
  if (j >= lines.length) throw new Error(`Kodblocket för ${name} slutar aldrig`);
  if (out[name] !== undefined) throw new Error(`Markören ${name} finns två gånger`);
  const text = body.join('\n');
  out[name] = lang === 'json' ? JSON.parse(text) : text;
  i = j;
}
const header = '// GENERERAD FIL. Ändra inte här: ändra i specs/bankgrannen/PROMPTER.md och kör node tools/prompter-till-js.mjs\n';
writeFileSync(join(root, 'bankgrannen-prompter.js'), header + 'window.BANK_PROMPTER = ' + JSON.stringify(out, null, 2) + ';\n');
console.log(`Skrev bankgrannen-prompter.js med ${Object.keys(out).length} konstanter: ${Object.keys(out).join(', ')}`);
