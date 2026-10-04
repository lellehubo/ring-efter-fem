// Playwright-test av Bänkgrannen (smala versionen) med låtsas-Gemini, låtsas-Twilio och falsk mikrofon.
// Kör från repots rot:  node tests/bankgrannen.cjs
// Kräver Playwright (npm i -g playwright && npx playwright install chromium).
// Skärmbilder och export hamnar i en tillfällig mapp som skrivs ut på slutet.
// Inget i testet når Google eller Twilio: WebSocket, fetch och Twilio.Device byts ut i sidan.
const { chromium } = require('playwright');
const os = require('os');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'bankgrannen-test-'));
fs.mkdirSync(OUT, { recursive: true });

const results = []; let fails = 0;
const check = (c, m) => { results.push((c ? 'OK   ' : 'FEL  ') + m); if (!c) { fails++; console.log('FEL  ' + m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve() {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.md': 'text/markdown' };
  const srv = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0].split('#')[0]).replace(/^\/$/, '/index.html'));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('nej'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((r) => srv.listen(0, () => r(srv)));
}

const INIT = () => {
  // Låtsas-WebSocket mot Gemini
  window.__ws = [];
  class FakeWS {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; window.__ws.push(this); setTimeout(() => { this.readyState = 1; this.onopen && this.onopen({}); }, 30); }
    send(d) { this.sent.push(JSON.parse(d)); }
    close(code) { if (this.readyState === 3) return; this.readyState = 3; this.closedWith = code; setTimeout(() => this.onclose && this.onclose({ code: code || 1000 }), 0); }
    serve(obj) { this.onmessage && this.onmessage({ data: JSON.stringify(obj) }); }
  }
  FakeWS.CONNECTING = 0; FakeWS.OPEN = 1; FakeWS.CLOSING = 2; FakeWS.CLOSED = 3;
  window.WebSocket = FakeWS;

  // Låtsas-telefontjänst och låtsas-Gemini för PDF
  window.__fetches = [];
  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith('https://tel.test/')) {
      const body = String((opts && opts.body) || '');
      window.__fetches.push({ u, body, ct: opts && opts.headers && opts.headers['Content-Type'] });
      if (!body.includes('key=hemlig-telefonnyckel')) return new Response('{"fel":"nyckel"}', { status: 401 });
      if (u.endsWith('/kontakter')) return new Response(JSON.stringify([
        { id: 'anna', namn: 'Anna', roll: 'producent på Robinson', arende: 'Hur ni testar nya moment' },
        { id: 'olle', namn: 'Olle', roll: 'formatexpert', arende: 'Internationella versioner' }]), { status: 200 });
      if (u.endsWith('/token')) return new Response(JSON.stringify({ token: 'JWT-TEST', ttl: 3600 }), { status: 200 });
      return new Response('{}', { status: 404 });
    }
    if (u.includes('generativelanguage.googleapis.com') && u.includes(':generateContent')) {
      window.__fetches.push({ u, gemini: true, body: String(opts.body).slice(0, 300) });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'PDF-TEXT: Robinson Sverige startade 1997.' }] } }], usageMetadata: { totalTokenCount: 1234 } }), { status: 200 });
    }
    return realFetch(url, opts);
  };

  // Låtsas-Twilio
  window.__tw = { devices: [], calls: [] };
  class FakeCall {
    constructor(params) { this.params = params; this.h = {}; window.__tw.calls.push(this); this.disconnected = false; }
    on(ev, f) { (this.h[ev] = this.h[ev] || []).push(f); return this; }
    emit(ev, ...a) { (this.h[ev] || []).forEach((f) => f(...a)); }
    getRemoteStream() {
      const ctx = new AudioContext(); const osc = ctx.createOscillator(); const g = ctx.createGain(); g.gain.value = window.__remoteGain || 0;
      const d = ctx.createMediaStreamDestination(); osc.connect(g); g.connect(d); osc.start(); return d.stream;
    }
    disconnect() { if (this.disconnected) return; this.disconnected = true; setTimeout(() => this.emit('disconnect', this), 10); }
  }
  class FakeDevice {
    constructor(token, opts) { this.token = token; this.opts = opts; this.destroyed = false; window.__tw.devices.push(this);
      this.audio = { addProcessor: async (p) => { this.processor = p; this.processed = await p.createProcessedStream(new MediaStream()); } }; }
    async connect(o) { this.connectOpts = o; return new FakeCall(o.params); }
    destroy() { this.destroyed = true; }
  }
  window.Twilio = { Device: FakeDevice };
  window.__downloads = [];
};

// 0,25 s sinus som PCM16 i 24 kHz, base64
const PCM_JS = `(() => { const n = 6000; const a = new Int16Array(n); for (let i = 0; i < n; i++) a[i] = Math.round(8000 * Math.sin(i / 8)); return int16ToBase64(a); })()`;

(async () => {
  const srv = await serve();
  const base = 'http://localhost:' + srv.address().port + '/';
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['microphone'], acceptDownloads: true });
  await ctx.addInitScript(INIT);
  await ctx.addInitScript(() => { try { localStorage.setItem('gemini_api_key', 'AIza-TEST'); } catch (e) {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const netErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') { if (/Failed to load resource/.test(m.text())) netErrors.push(m.text() + ' ' + (m.location().url || '')); else errors.push('console: ' + m.text()); } });
  page.on('requestfailed', (r) => netErrors.push('requestfailed ' + r.url()));
  page.on('response', (r) => { if (r.status() >= 400) netErrors.push(r.status() + ' ' + r.url()); });

  const ws = (i) => page.evaluate((i) => { const w = window.__ws[i < 0 ? window.__ws.length + i : i]; return w ? { url: w.url, sent: w.sent, state: w.readyState } : null; }, i);
  const serveWs = (i, obj) => page.evaluate(([i, obj]) => window.__ws[i < 0 ? window.__ws.length + i : i].serve(obj), [i, obj]);
  const bankState = () => page.evaluate(() => ({ phone: window.__bank.phone.state, voice: window.__bank.voice.state, ptt: window.__bank.voice.ptt, started: window.__bank.started, log: window.__bank.log, lamp: document.getElementById('bankLampa') && document.getElementById('bankLampa').textContent, modal: !!window.__bank.modal }));
  const waitFor = async (fn, ms = 5000, what = '') => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(80); } console.log('timeout: ' + what); return false; };
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png') });

  /* ---------- Regression: de andra sektionerna ---------- */
  await page.goto(base);
  await sleep(600);
  check(await page.evaluate(() => activeId === 'drom'), 'startar på AI-snack (drom)');
  check(await page.locator('.snacka').isVisible(), 'AI-snack syns');
  check(!(await page.locator('#bank').count()) || !(await page.locator('#bank').isVisible()), 'Bänkgrannen syns inte på AI-snack');
  check(await page.locator('.andra [data-goto=bankgrannen]').isVisible(), 'knappen Bänkgrannen finns uppe till vänster');
  await shot('01-ai-snack');
  for (const id of ['efterfem', 'ai']) {
    await page.click('.andra [data-goto=' + id + ']');
    await sleep(300);
    check(await page.evaluate(() => activeId), 'sektion ' + id + ' öppnas');
    check(await page.locator('#micBtn').isVisible(), id + ': mikrofonknappen syns');
    await page.keyboard.press('Escape');
    await sleep(200);
    check(await page.evaluate(() => activeId === 'drom'), id + ': Esc går tillbaka till AI-snack');
  }
  // AI-snack ringer fortfarande upp med sin egen setup
  await page.click('#ringUpp');
  await waitFor(async () => (await page.evaluate(() => window.__ws.length)) > 0, 3000, 'drom ws');
  await sleep(200);
  const d0 = await ws(0);
  check(d0 && d0.sent[0] && d0.sent[0].setup && /gemini-3\.8-live/.test(d0.sent[0].setup.model), 'AI-snack skickar sin setup som förut');
  await page.click('#ringUpp'); await sleep(300);
  check(errors.length === 0, 'inga fel i de andra sektionerna ' + errors.join(' | '));

  /* ---------- Bänkgrannen: förberedelsen ---------- */
  const wsBefore = await page.evaluate(() => window.__ws.length);
  await page.click('.andra [data-goto=bankgrannen]');
  await sleep(500);
  check(await page.evaluate(() => activeId === 'bankgrannen'), 'Bänkgrannen öppnas');
  check(await page.locator('#bankPrep').isVisible(), 'förberedelsevyn syns');
  check(!(await page.locator('.snacka').isVisible()) && !(await page.locator('#micBtn').isVisible()), 'AI-snacks lur och mikrofon döljs');
  check(await page.locator('#synBadge').isVisible() && /behandlas av Google/.test(await page.locator('#synBadge').textContent()), 'märkningen om AI och Google syns');
  await shot('02-forberedelse');

  // Kugghjulet öppnar Seminariet
  await page.click('#gearBtn').catch(async () => { await page.evaluate(() => openSettings()); });
  await sleep(300);
  check(await page.locator('.bank-modal h2', { hasText: 'Seminariet' }).isVisible(), 'kugghjulet öppnar Seminariet i Bänkgrannen');
  await page.fill('#bpTitel', 'AI och programutveckling');
  await page.fill('#bpMal', 'TV4:s programavdelning');
  await page.selectOption('#bpRoll', 'dramaturgen');
  check(/Robinson/.test(await page.textContent('#bpRollHint')), 'rolltipset byts till Dramaturgen');
  await page.fill('#bpText', 'Kunskapsbas: Robinson är ett format där deltagare lever på en ö. {{FORELASARE}} ska inte ersättas här.');
  // En liten PDF läses via (låtsas-)Gemini
  await page.setInputFiles('#bpFiler', { name: 'robinson.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
  await page.click('#bpForbered');
  await waitFor(async () => /Förberett/.test(await page.textContent('#bpUnderlag')), 4000, 'underlag');
  check(/robinson\.pdf/.test(await page.textContent('#bpUnderlag')), 'underlaget förberett med PDF och inklistrad text');
  check(await page.evaluate(() => window.__fetches.some((f) => f.gemini && f.u.includes('gemini-3.6-flash'))), 'PDF:en skickas till gemini-3.6-flash');
  await page.fill('#bpTelUrl', 'https://tel.test/');
  await page.fill('#bpTelKey', 'fel');
  await page.click('#bpTelTest');
  await waitFor(async () => /Fungerade inte|personer/.test(await page.textContent('#bpTelSvar')), 3000, 'tel fel');
  check(/Fungerade inte/.test(await page.textContent('#bpTelSvar')), 'fel telefonnyckel ger tydligt fel');
  await page.fill('#bpTelKey', 'hemlig-telefonnyckel');
  await page.click('#bpTelTest');
  await waitFor(async () => /2 personer/.test(await page.textContent('#bpTelSvar')), 3000, 'tel ok');
  check(/2 personer på listan/.test(await page.textContent('#bpTelSvar')), 'telefonlistan hämtas: 2 personer');
  check(await page.evaluate(() => window.__fetches.filter((f) => f.u.startsWith('https://tel.test/')).every((f) => f.ct === 'application/x-www-form-urlencoded')), 'telefontjänsten anropas med formulär-POST (ingen preflight)');
  await shot('03-seminariet');
  await page.click('#bpSpara');
  await sleep(300);
  const kort = await page.textContent('#bankKort');
  check(/AI och programutveckling/.test(kort) && /Dramaturgen/.test(kort) && /inställd/.test(kort), 'kortet visar titel, roll och telefon');
  check(await page.evaluate(() => !localStorage.getItem('bank_tel_key') ? false : !JSON.stringify(window.__bank.seminar).includes('hemlig')), 'telefonnyckeln ligger i localStorage, inte i seminariet');

  /* ---------- Start ---------- */
  await page.click('#bankBorja');
  await sleep(300);
  const manus = await page.textContent('.bank-ark .manus');
  check(/ringa/.test(manus) && !/\{\{/.test(manus), 'startrutan har Dramaturgens manus med telefonstycket, inga platshållare kvar');
  check(manus.includes('Birgitta'), 'startmanuset nämner Birgitta');
  await shot('04-start');
  await page.click('#bsKor');
  await waitFor(async () => (await bankState()).started, 4000, 'start');
  let st = await bankState();
  check(st.started && st.lamp === 'REDO', 'seminariet startar, lampan visar REDO');
  check(await page.locator('#bankTelefon').isVisible(), 'telefonreglaget syns');
  check(await page.locator('#bankRing').isVisible(), 'knappen Ring syns');
  await shot('05-live-redo');

  /* ---------- Håll för att prata ---------- */
  await page.keyboard.down('Space');
  await sleep(150);
  st = await bankState();
  check(st.ptt && st.lamp === 'LYSSNAR', 'mellanslag: lampan visar LYSSNAR');
  await waitFor(async () => (await page.evaluate(() => window.__ws.length)) > wsBefore, 2000, 'voice ws');
  const vIdx = await page.evaluate(() => window.__ws.length - 1);
  await waitFor(async () => (await ws(vIdx)).sent.length > 0, 2000, 'setup');
  let v = await ws(vIdx);
  const setup = v.sent[0].setup;
  check(setup && setup.model === 'models/gemini-3.8-live', 'röstens setup: gemini-3.8-live');
  check(setup.realtimeInputConfig.automaticActivityDetection.disabled === true, 'röstens setup: manuell turtagning');
  check(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName === 'Gacrux' && setup.generationConfig.speechConfig.languageCode === 'sv-SE', 'röst Gacrux, sv-SE');
  const sys = setup.systemInstruction.parts[0].text;
  check(/dramaturg/i.test(sys) && /Robinson/.test(sys), 'systeminstruktionen har Dramaturgens roll');
  check(sys.includes('PDF-TEXT: Robinson Sverige startade 1997.') && sys.includes('{{FORELASARE}} ska inte ersättas här'), 'underlaget ligger med ordagrant, platshållare i underlaget orörda');
  check(sys.includes('Anna') && sys.includes('Olle') && !/\+46/.test(sys), 'telefonlistan (namn, inga nummer) finns i personan');
  const unfilled = (sys.replace(/Kunskapsbas:[^\n]*/g, '').match(/\{\{[A-Z_]+\}\}/g) || []);
  check(unfilled.length === 0, 'inga ifyllda platshållare kvar i personan ' + unfilled.join(','));
  check(sys.includes('AI och programutveckling') && sys.includes('TV4:s programavdelning'), 'titel och målgrupp i personan');
  const decl = setup.tools && setup.tools[0].functionDeclarations[0];
  check(decl && decl.name === 'begar_samtal' && decl.parameters.type === 'OBJECT' && decl.parameters.properties.kontakt_id.type === 'STRING', 'begar_samtal med typer i versaler');
  check(!!setup.inputAudioTranscription && !!setup.outputAudioTranscription, 'in- och utskrift påslagna');
  // setupComplete: activityStart och väntande ljud skickas
  await sleep(500);
  await serveWs(vIdx, { setupComplete: {} });
  await sleep(500);
  v = await ws(vIdx);
  const iStart = v.sent.findIndex((m) => m.realtimeInput && m.realtimeInput.activityStart);
  const audioMsgs = v.sent.filter((m) => m.realtimeInput && m.realtimeInput.audio);
  check(iStart > 0, 'activityStart skickas efter setupComplete');
  check(audioMsgs.length > 2 && audioMsgs[0].realtimeInput.audio.mimeType === 'audio/pcm;rate=16000', 'mikrofonljud skickas som 16 kHz PCM (' + audioMsgs.length + ' paket)');
  await page.keyboard.up('Space');
  await sleep(200);
  v = await ws(vIdx);
  check(v.sent.some((m) => m.realtimeInput && m.realtimeInput.activityEnd), 'släppt mellanslag ger activityEnd');
  // Svar från Birgitta
  const pcm = await page.evaluate(PCM_JS);
  await serveWs(vIdx, { serverContent: { inputTranscription: { text: 'Birgitta, vad tycker du om idén?' } } });
  await serveWs(vIdx, { serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: pcm } }] }, outputTranscription: { text: 'Den håller om rättvisan i spelet håller.' } } });
  await sleep(80);
  st = await bankState();
  check(st.lamp === 'HAR ORDET', 'lampan visar HAR ORDET när hon pratar');
  await serveWs(vIdx, { serverContent: { turnComplete: true }, usageMetadata: { totalTokenCount: 5000 } });
  await waitFor(async () => (await bankState()).lamp === 'REDO', 3000, 'redo efter tur');
  st = await bankState();
  check(st.lamp === 'REDO', 'lampan tillbaka på REDO efter uppspelningen');
  check(st.log.length === 2 && st.log[0].src === 'fraga' && st.log[1].src === 'bank', 'loggen har frågan och svaret');

  // Enter = ordet, S = sammanfatta (sessionen är öppen)
  await page.keyboard.press('Enter'); await sleep(100);
  await page.keyboard.press('s'); await sleep(100);
  v = await ws(vIdx);
  const texts = v.sent.filter((m) => m.clientContent).map((m) => m.clientContent.turns[0].parts[0].text);
  check(texts.some((t) => /Läge: ORDET/.test(t)), 'Enter skickar ORDET');
  check(texts.some((t) => /Läge: SAMMANFATTA/.test(t)), 'S skickar SAMMANFATTA');

  /* ---------- Hon vill ringa: kortet, Esc = nej ---------- */
  await serveWs(vIdx, { toolCall: { functionCalls: [{ id: 'fc1', name: 'begar_samtal', args: { kontakt_id: 'anna', arende: 'Hur ni testar nya moment', grund: 'frågan om tävlingsmoment' } }] } });
  await sleep(200);
  check(await page.locator('.bank-modal h2', { hasText: 'Birgitta vill ringa' }).isVisible(), 'samtalskortet visas när hon vill ringa');
  check(/Anna/.test(await page.textContent('.bank-modal')), 'kortet visar vem');
  await shot('06-samtalskortet');
  await page.keyboard.press('Escape'); await sleep(150);
  v = await ws(vIdx);
  let tr = v.sent.filter((m) => m.toolResponse).map((m) => m.toolResponse.functionResponses[0]);
  check(tr.length === 1 && tr[0].id === 'fc1' && tr[0].response.status === 'nej', 'Esc på kortet ger svaret nej');
  check((await bankState()).phone === 'idle', 'inget samtal efter nej');

  // Okänd kontakt
  await serveWs(vIdx, { toolCall: { functionCalls: [{ id: 'fc2', name: 'begar_samtal', args: { kontakt_id: 'okand', arende: 'x' } }] } });
  await sleep(100);
  v = await ws(vIdx);
  tr = v.sent.filter((m) => m.toolResponse).map((m) => m.toolResponse.functionResponses[0]);
  check(tr[1] && tr[1].response.status === 'inte möjligt' && !(await bankState()).modal, 'okänd kontakt: inte möjligt, inget kort');

  /* ---------- Hon vill ringa: Enter = ring ---------- */
  await serveWs(vIdx, { toolCall: { functionCalls: [{ id: 'fc3', name: 'begar_samtal', args: { kontakt_id: 'anna', arende: 'Hur ni testar nya moment', grund: 'frågan om tävlingsmoment' } }] } });
  await sleep(200);
  await page.keyboard.press('Enter'); await sleep(150);
  v = await ws(vIdx);
  tr = v.sent.filter((m) => m.toolResponse).map((m) => m.toolResponse.functionResponses[0]);
  check(tr[2] && tr[2].id === 'fc3' && tr[2].response.status === 'godkänt' && tr[2].response.scheduling === 'WHEN_IDLE', 'Enter på kortet ger godkänt (WHEN_IDLE)');
  st = await bankState();
  check(st.phone === 'announcing' && st.lamp === 'HAR ORDET', 'annonsering: lampan visar HAR ORDET');
  check((await page.textContent('#bankLaggPa')) === 'Ring inte', 'knappen Ring inte syns under annonseringen');
  await serveWs(vIdx, { serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: pcm } }] }, outputTranscription: { text: 'Jag ringer Anna nu, ni kommer att höra samtalet.' } } });
  await serveWs(vIdx, { serverContent: { turnComplete: true } });
  await waitFor(async () => (await page.evaluate(() => window.__tw.calls.length)) > 0, 4000, 'uppringning');
  await sleep(200);
  const tw = await page.evaluate(() => { const d = window.__tw.devices[0]; return { token: d.token, edge: d.opts.edge, params: d.connectOpts.params, processed: d.processed instanceof MediaStream && d.processed.getAudioTracks().length > 0 }; });
  check(tw.token === 'JWT-TEST' && JSON.stringify(tw.edge) === '["frankfurt","dublin"]', 'Twilio Device med nyckel från /token och europeiska kantnoder');
  check(tw.params.kontakt === 'anna', 'bara kontaktens id skickas till Twilio');
  check(tw.processed, 'AudioProcessor ger linjeströmmen (Birgittas röst ut på linjen)');
  check((await ws(vIdx)).state === 3, 'rummets röstsession stängs inför samtalet');
  const cIdx = await page.evaluate(() => window.__ws.length - 1);
  const cs = (await ws(cIdx)).sent[0].setup;
  check(cs && !cs.realtimeInputConfig && cs.tools[0].functionDeclarations[0].name === 'lagg_pa', 'samtalssessionen: automatisk turtagning och lagg_pa');
  const csys = cs.systemInstruction.parts[0].text;
  check(csys.includes('Anna') && csys.includes('Hur ni testar nya moment') && !/\{\{[A-Z_]+\}\}/.test(csys), 'CALL_PERSONA ifylld med kontakt och ärende');
  check(/godkände samtalet/.test(csys), 'bakgrunden säger att föreläsaren godkände');
  st = await bankState();
  check(st.lamp === 'RINGER', 'lampan visar RINGER');
  await page.evaluate(() => window.__tw.calls[0].emit('ringing', false));
  await sleep(100);
  await shot('07-ringer');
  await serveWs(cIdx, { setupComplete: {} });
  await page.evaluate(() => window.__tw.calls[0].emit('accept'));
  await waitFor(async () => (await bankState()).phone === 'live', 2000, 'live');
  st = await bankState();
  check(st.phone === 'live' && st.lamp === 'I LUREN', 'svar: lampan visar I LUREN');
  // Tyst i 3 sekunder: SAMTAL_START
  await sleep(3400);
  let c = await ws(cIdx);
  check(c.sent.some((m) => m.clientContent && /svarat men säger ingenting/.test(m.clientContent.turns[0].parts[0].text)), 'tystnad i 3 s ger SAMTAL_START');
  check(c.sent.some((m) => m.realtimeInput && m.realtimeInput.audio), 'linjens ljud skickas till samtalssessionen');
  // Prata i luren
  await page.keyboard.down('Space'); await sleep(100);
  st = await bankState();
  const gains = await page.evaluate(() => [window.__bank.audio.lineMicGain.gain.value, window.__bank.phone.micGain && window.__bank.phone.micGain.gain.value]);
  check(st.lamp === 'LYSSNAR · I LUREN' && gains[0] === 1 && gains[1] === 1, 'mellanslag under samtal: mikrofonen ut på linjen');
  await shot('08-i-luren');
  await page.keyboard.up('Space'); await sleep(100);
  check((await page.evaluate(() => window.__bank.audio.lineMicGain.gain.value)) === 0, 'släppt: mikrofonen av från linjen');
  // Samtalet i text
  await serveWs(cIdx, { serverContent: { inputTranscription: { text: 'Hallå, det är Anna.' } } });
  await serveWs(cIdx, { serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: pcm } }] }, outputTranscription: { text: 'Hej Anna, jag är en AI och ringer från Lelles föredrag.' } } });
  await serveWs(cIdx, { serverContent: { turnComplete: true } });
  await serveWs(cIdx, { toolCall: { functionCalls: [{ id: 'lp1', name: 'lagg_pa', args: {} }] } });
  await waitFor(async () => (await bankState()).phone === 'idle', 4000, 'lagt på');
  c = await ws(cIdx);
  check(c.sent.some((m) => m.toolResponse && m.toolResponse.functionResponses[0].id === 'lp1'), 'lagg_pa besvaras');
  check(await page.evaluate(() => window.__tw.calls[0].disconnected && window.__tw.devices[0].destroyed), 'lagg_pa lägger på och stänger Twilio');
  st = await bankState();
  check(st.log.some((e) => e.src === 'luren' && e.namn === 'Anna') && st.log.some((e) => e.src === 'bank-luren'), 'samtalet i loggen: I LUREN och AI-DELTAGAREN (i luren)');
  check(st.log.some((e) => e.src === 'system' && /Anna: genomfört/.test(e.text)), 'utfallet genomfört i loggen');
  // EFTER SAMTALET
  await waitFor(async () => (await page.evaluate(() => window.__ws.length)) > cIdx + 1, 3000, 'efter-ws');
  const eIdx = await page.evaluate(() => window.__ws.length - 1);
  await sleep(150);
  const esys = (await ws(eIdx)).sent[0].setup.systemInstruction.parts[0].text;
  check(esys.includes('I LUREN (Anna): Hallå, det är Anna.'), 'nya personan har samtalet i transkriptet');
  await serveWs(eIdx, { setupComplete: {} }); await sleep(100);
  const et = (await ws(eIdx)).sent.filter((m) => m.clientContent).map((m) => m.clientContent.turns[0].parts[0].text);
  check(et.some((t) => /EFTER SAMTALET/.test(t) && /Utfall: genomfört/.test(t)), 'EFTER SAMTALET skickas med utfallet');
  await serveWs(eIdx, { serverContent: { turnComplete: true } });
  await sleep(300);

  /* ---------- R: Lelle ringer, Esc under ringning ---------- */
  await page.keyboard.press('r'); await sleep(200);
  check(await page.locator('.bank-modal h2', { hasText: 'Ring' }).isVisible(), 'R öppnar Ring');
  check(/Anna, producent på Robinson \(redan ringd\)/.test(await page.textContent('#brVem')), 'redan ringd kontakt märks');
  await page.selectOption('#brVem', 'olle');
  check((await page.inputValue('#brArende')) === 'Internationella versioner', 'ärendet förifylls');
  await shot('09-ring');
  await page.keyboard.press('Enter'); await sleep(150);
  check((await bankState()).phone === 'announcing', 'Ring: annonsering startar');
  const rIdx = await page.evaluate(() => window.__ws.length - 1);
  await sleep(100);
  await serveWs(rIdx, { setupComplete: {} }); await sleep(100);
  const rt = (await ws(rIdx)).sent.filter((m) => m.clientContent).map((m) => m.clientContent.turns[0].parts[0].text);
  check(rt.some((t) => /Läge: RINGER/.test(t) && /Olle/.test(t) && /har bett dig ringa/.test(t)), 'rösten får RINGER med Olle');
  // Säger hon inget ringer det ändå efter 6 s
  await waitFor(async () => (await page.evaluate(() => window.__tw.calls.length)) > 1, 8000, 'ring utan ljud');
  check((await page.evaluate(() => window.__tw.calls.length)) === 2, 'utan ljud från henne rings samtalet ändå efter 6 s');
  await page.evaluate(() => window.__tw.calls[1].emit('ringing', false)); await sleep(100);
  await page.keyboard.press('Escape');
  await waitFor(async () => (await bankState()).phone === 'idle', 3000, 'avbrutet');
  st = await bankState();
  check(st.log.some((e) => e.src === 'system' && /Olle: avbrutet av Lelle/.test(e.text)), 'Esc under ringning: avbrutet');
  await waitFor(async () => (await page.evaluate(() => window.__ws.length)) > rIdx + 2, 3000, 'efter2');
  const e2 = await page.evaluate(() => window.__ws.length - 1);
  await sleep(100); await serveWs(e2, { setupComplete: {} }); await sleep(100);
  check((await ws(e2)).sent.some((m) => m.clientContent && /Utfall: avbrutet av Lelle/.test(m.clientContent.turns[0].parts[0].text)), 'EFTER SAMTALET med avbrutet');
  await serveWs(e2, { serverContent: { turnComplete: true } }); await sleep(200);

  // Ring inte: Esc under annonseringen
  await page.keyboard.press('r'); await sleep(150);
  await page.selectOption('#brVem', 'olle');
  await page.keyboard.press('Enter'); await sleep(150);
  await page.keyboard.press('Escape'); await sleep(200);
  st = await bankState();
  check(st.phone === 'idle' && st.log.some((e) => /stoppades innan det ringdes/.test(e.text)), 'Esc under annonseringen stoppar samtalet');
  await sleep(6500);
  check((await page.evaluate(() => window.__tw.calls.length)) === 2, 'inget samtal rings efter Ring inte');

  /* ---------- Telefonen av ---------- */
  await page.keyboard.press('Shift+Digit1'); await sleep(150);
  check(!(await page.locator('#bankRing').isVisible()), 'Skift+1: telefonen av, Ring döljs');
  await page.keyboard.down('Space'); await sleep(200); await page.keyboard.up('Space');
  const aIdx = await page.evaluate(() => window.__ws.length - 1);
  await waitFor(async () => (await ws(aIdx)).sent.length > 0, 2000, 'av-setup');
  check(!(await ws(aIdx)).sent[0].setup.tools, 'telefon av: inget begar_samtal i setup');
  await serveWs(aIdx, { setupComplete: {} }); await sleep(100);
  await serveWs(aIdx, { toolCall: { functionCalls: [{ id: 'fc9', name: 'begar_samtal', args: { kontakt_id: 'olle', arende: 'x' } }] } });
  await sleep(100);
  const tr9 = (await ws(aIdx)).sent.filter((m) => m.toolResponse).map((m) => m.toolResponse.functionResponses[0]);
  check(tr9[0] && tr9[0].response.status === 'inte möjligt', 'telefon av: begäran nekas');
  await page.keyboard.press('Shift+Digit2'); await sleep(100);

  /* ---------- T, mini-läge ---------- */
  await page.keyboard.press('t'); await sleep(100);
  check(await page.locator('#bankLogg').isVisible() && /AI-DELTAGAREN/.test(await page.textContent('#bankLogg')), 'T visar de senaste replikerna');
  await shot('10-live-logg');
  await page.setViewportSize({ width: 420, height: 800 }); await sleep(200);
  check(!(await page.locator('.bank-vu').isVisible()) && await page.locator('#bankPtt').isVisible(), 'mini-läget: VU dold, talknappen kvar');
  await shot('11-mini');
  await page.setViewportSize({ width: 1280, height: 900 }); await sleep(100);

  /* ---------- Omladdning och fortsätt ---------- */
  const logLen = (await bankState()).log.length;
  await page.reload(); await sleep(400);
  await page.click('.andra [data-goto=bankgrannen]'); await sleep(400);
  check(await page.locator('.bank-modal h2', { hasText: 'Fortsätta' }).isVisible(), 'efter omladdning erbjuds Fortsätt');
  await page.click('#bfJa');
  await waitFor(async () => (await bankState()).started, 3000, 'resume');
  st = await bankState();
  check(st.started && st.log.length === logLen, 'Fortsätt återställer loggen (' + st.log.length + ' rader)');
  check(await page.evaluate(() => window.__bank.seminar.role === 'dramaturgen' && window.__bank.seminar.sourceText.includes('PDF-TEXT')), 'seminariet och underlaget finns kvar i IndexedDB');

  /* ---------- Tillbaka-knappen och Avsluta ---------- */
  await page.click('#backBtn').catch(() => page.evaluate(() => goHome()));
  await sleep(200);
  check(await page.locator('.bank-modal h2', { hasText: 'Avsluta' }).isVisible() && (await page.evaluate(() => activeId)) === 'bankgrannen', 'tillbaka under seminariet öppnar Avsluta i stället för att lämna');
  await shot('12-avsluta');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 3000 }).catch(() => null), page.click('#beRadera')]);
  check(!!dl, 'exporten laddas ned');
  if (dl) { const p = path.join(OUT, 'export.md'); await dl.saveAs(p); const md = fs.readFileSync(p, 'utf8'); check(/I LUREN \(Anna\)/.test(md) && /TILL AI-DELTAGAREN/.test(md), 'exporten innehåller samtalen'); }
  await sleep(200);
  st = await bankState();
  check(!st.started && st.log.length === 0 && await page.locator('#bankPrep').isVisible(), 'Avsluta raderar och visar förberedelsen');
  check(await page.evaluate(() => sessionStorage.getItem('bank_session') === null), 'sessionStorage tömd');

  /* ---------- Skeptikern ---------- */
  await page.evaluate(() => { window.__bank.seminar.role = 'skeptikern'; });
  await page.click('#bankBorja'); await sleep(200);
  const m2 = await page.textContent('.bank-ark .manus');
  check(m2.length > 50 && !/\{\{/.test(m2), 'Skeptikerns startmanus (tilltal) utan platshållare');
  await page.click('#bsAvbryt');

  await page.click('#backBtn').catch(() => page.evaluate(() => goHome()));
  await sleep(200);
  check(await page.evaluate(() => activeId === 'drom'), 'utan pågående seminarium går tillbaka till AI-snack');

  check(errors.length === 0, 'inga JavaScript-fel: ' + errors.join(' | '));
  console.log(results.join('\n'));
  console.log('Nätverksfel (väntade i testmiljön utan internet):\n  ' + [...new Set(netErrors)].join('\n  '));
  console.log('\n' + (results.length - fails) + ' av ' + results.length + ' OK. Skärmbilder: ' + OUT);
  await browser.close(); srv.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
