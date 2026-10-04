/* Delad kod för Bänkgrannens telefontjänst. Privat: nås inte över HTTP.
   Laddas i de andra funktionerna med
   require(Runtime.getFunctions()['delat'].path) */
const crypto = require('crypto');

const DEFAULT_ORIGINS = 'https://lellehubo.github.io';
const NUMMER = /^\+[1-9]\d{7,14}$/;

// Telefonlistan ur miljövariabeln CONTACTS. Bara personer med giltigt nummer
// och ett samtyckesdatum kommer med (SPEC 17.9).
function contacts(context) {
  let list;
  try { list = JSON.parse(context.CONTACTS || '[]'); } catch (e) { console.error('CONTACTS är inte giltig JSON'); return []; }
  if (!Array.isArray(list)) return [];
  return list.filter((c) => c && typeof c.id === 'string' && c.id && typeof c.namn === 'string' && c.namn
    && typeof c.nummer === 'string' && NUMMER.test(c.nummer.replace(/[\s-]/g, ''))
    && typeof c.samtycke === 'string' && c.samtycke.trim());
}

// Jämför telefonnyckeln utan att läcka något via tidsåtgång.
function keyOk(context, given) {
  const want = String(context.BANK_KEY || '');
  if (want.length < 16) { console.error('BANK_KEY saknas eller är kortare än 16 tecken'); return false; }
  const a = crypto.createHash('sha256').update(String(given || '')).digest();
  const b = crypto.createHash('sha256').update(want).digest();
  return crypto.timingSafeEqual(a, b);
}

function origins(context) {
  return String(context.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
}

// Svar med CORS bara för tillåtna ursprung. Anropen från appen är vanliga
// formulär-POST, så webbläsaren skickar ingen förfrågan i förväg (preflight).
function response(context, event) {
  const res = new Twilio.Response();
  const allowed = origins(context);
  const headers = (event && event.request && event.request.headers) || {};
  const origin = String(headers.origin || '').replace(/\/+$/, '');
  if (origin && allowed.includes(origin)) {
    res.appendHeader('Access-Control-Allow-Origin', origin);
    res.appendHeader('Vary', 'Origin');
  }
  res.appendHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.appendHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.appendHeader('Content-Type', 'application/json');
  res.appendHeader('Cache-Control', 'no-store');
  return { res, originOk: !origin || allowed.includes(origin) };
}

function fail(res, code, text) {
  res.setStatusCode(code);
  res.setBody({ fel: text });
  return res;
}

module.exports = { contacts, keyOk, response, fail, NUMMER };
