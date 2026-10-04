/* ============================================================
   BÄNKGRANNEN – den smala versionen
   specs/bankgrannen/SPEC.md avsnitt 15.1, promptarna i PROMPTER.md
   (genererade till bankgrannen-prompter.js).

   Birgitta i en roll (Skeptikern eller Dramaturgen). Hon hör bara det
   som sägs till henne när någon håller i talknappen, svarar med röst
   och kan ringa någon på telefonlistan. Lyssnandet på hela seminariet
   (öronen, minnet, snabbkollen, handen, ratten, Bänken) kommer i den
   fulla versionen.

   Använder från index.html: activeId, els, getKey, wsUrl, MODEL_NAME,
   LANGUAGE_CODE, workletSrc, int16ToBase64, base64ToInt16,
   openKeySheet, closeSettings.
   ============================================================ */
(function () {
  'use strict';

  const P = window.BANK_PROMPTER;
  if (!P) { console.error('[bank] bankgrannen-prompter.js saknas'); return; }

  /* ---------------- Konstanter ---------------- */
  const PERSONA_NAME = 'Birgitta';
  const TEXT_MODEL = 'gemini-3.6-flash';
  const OUT_RATE = 24000;
  const IN_RATE = 16000;
  const SEND_EVERY_FRAMES = 12;            // 12 × 128 samplingar ≈ 96 ms per meddelande
  const PENDING_MAX_FRAMES = 1900;         // ≈ 15 s ljud medan sessionen kopplas upp
  const IDLE_CLOSE_MS = 40000;             // sessionen stängs efter 40 s tystnad
  const FLOOR_WARN_MS = 7 * 60000;
  const FLOOR_MAX_MS = 8 * 60000;
  const CALL_WARN_MS = 6 * 60000;
  const SILENT_START_MS = 3000;            // tystnad efter svar: hon börjar själv
  const ANNOUNCE_NO_AUDIO_MS = 6000;       // säger hon inget före samtalet, ring ändå
  const ANNOUNCE_MAX_MS = 15000;
  const LOG_MAX_WORDS = 2000;
  const TOKEN_WARN = 40000;
  const TOKEN_STOP = 70000;
  const PDF_MAX_BYTES = 19 * 1024 * 1024;
  const LS_TEL_URL = 'bank_tel_url';
  const LS_TEL_KEY = 'bank_tel_key';
  const SS_KEY = 'bank_session';
  const TWILIO_SDK = 'vendor/twilio.min.js';
  const TWILIO_EDGES = ['frankfurt', 'dublin'];

  const ROLES = {
    skeptikern: {
      label: 'Skeptikern', hint: 'AI-föredrag: den skeptiska kollegan på publikens sida.',
      voice: 'Gacrux', roll: P.ROLL_SKEPTIKERN, kort: P.ROLL_KORT_SKEPTIKERN,
      presentation: P.PRESENTATION_SKEPTIKERN, startmanus: P.STARTMANUS_TILLTAL,
    },
    dramaturgen: {
      label: 'Dramaturgen', hint: 'Programutveckling: dramaturg och tv-producent, sparringpartner kring Robinson.',
      voice: 'Gacrux', roll: P.ROLL_DRAMATURGEN, kort: P.ROLL_KORT_DRAMATURGEN,
      presentation: P.PRESENTATION_DRAMATURGEN, startmanus: P.STARTMANUS_DRAMATURGEN,
    },
  };
  const VOICES = ['Gacrux', 'Kore', 'Pulcherrima', 'Sulafat', 'Schedar', 'Orus', 'Charon'];

  /* ---------------- Tillstånd ---------------- */
  const defaultSeminar = () => ({
    title: '', audience: '', speaker: 'Lelle', role: 'skeptikern', scope: 'tilltal', voice: '',
    sourceText: '', sourceFiles: [], pasted: '', updatedAt: 0,
  });

  const bank = {
    mounted: false,
    seminar: defaultSeminar(),
    started: false,
    t0: 0,
    log: [],
    firstSpoken: false,
    called: [],
    logOpen: false,
    modal: null,
    usage: { voice: 0, call: 0, text: 0, callMs: 0 },
    audio: {
      outCtx: null, inCtx: null, micStream: null, micSrc: null, worklet: null,
      lineOut: null, lineMicSrc: null, lineMicGain: null,
      playhead: 0, sources: new Set(), queue: [], micLvl: 0,
    },
    voice: {
      ws: null, state: 'closed', ptt: false, pendingAudio: [], pendingEnd: false, batch: [],
      curIn: '', curOut: '', speaking: false, setupAt: 0, openedAt: 0, sessionTokens: 0,
      timers: {}, afterTurn: [], pendingTrigger: null, closeAfterTurn: false, gotAudio: false,
    },
    phone: null,
  };

  function freshPhone(mode, contacts) {
    return {
      mode, contacts: contacts || [], state: 'idle',
      device: null, call: null, ws: null, setupDone: false, pending: [], batch: [],
      ctx: null, worklet: null, remoteSrc: null, micGain: null, sessionTokens: 0,
      contact: null, arende: '', initiativ: '', grund: '', answered: false, answeredAt: 0,
      outcomeHint: '', heardRemote: false, callSpoke: false, curIn: '', curOut: '',
      remoteLvl: 0, ptt: false, timers: {}, announceDone: false,
    };
  }
  bank.phone = freshPhone('fraga');

  /* ---------------- Små hjälpare ---------------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const secs = () => (bank.t0 ? (Date.now() - bank.t0) / 1000 : 0);
  const mmss = (s) => { s = Math.max(0, Math.floor(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  const speaker = () => bank.seminar.speaker || 'Lelle';
  const roleObj = () => ROLES[bank.seminar.role] || ROLES.skeptikern;
  const voiceName = () => bank.seminar.voice || roleObj().voice;
  const telUrl = () => { try { return (localStorage.getItem(LS_TEL_URL) || '').trim().replace(/\/+$/, ''); } catch (e) { return ''; } };
  const telKey = () => { try { return (localStorage.getItem(LS_TEL_KEY) || '').trim(); } catch (e) { return ''; } };
  const phoneConfigured = () => !!(telUrl() && telKey());
  const phoneOn = () => bank.phone.mode !== 'av' && phoneConfigured() && bank.phone.contacts.length > 0;
  const estTokens = (s) => Math.round((s || '').length / 4);

  function fill(tpl, vars) {
    let s = tpl;
    for (let i = 0; i < 4; i++) {
      const before = s;
      for (const [k, v] of Object.entries(vars)) s = s.split('{{' + k + '}}').join(v == null ? '' : String(v));
      if (s === before) break;
    }
    return s;
  }

  function concatInt16(chunks) {
    let n = 0; for (const c of chunks) n += c.length;
    const out = new Int16Array(n); let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  // Funktionsdeklarationerna i PROMPTER.md är skrivna som vanligt JSON Schema.
  // Gemini vill ha typerna i versaler och inga tomma objekt.
  function toGeminiDecl(d) {
    const c = JSON.parse(JSON.stringify(d));
    (function up(o) {
      if (o && typeof o === 'object') {
        if (typeof o.type === 'string') o.type = o.type.toUpperCase();
        for (const v of Object.values(o)) up(v);
      }
    })(c.parameters);
    if (c.parameters && c.parameters.properties && !Object.keys(c.parameters.properties).length) delete c.parameters;
    return c;
  }

  async function parseMsg(raw) {
    let t = raw;
    if (raw instanceof Blob) t = await raw.text();
    else if (raw instanceof ArrayBuffer) t = new TextDecoder().decode(raw);
    try { return JSON.parse(t); } catch (e) { return null; }
  }

  /* ---------------- Lagring ---------------- */
  const idb = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((res, rej) => {
        const r = indexedDB.open('bankgrannen', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => { this.db = r.result; res(r.result); };
        r.onerror = () => rej(r.error);
      });
    },
    async get(k) {
      const db = await this.open();
      return new Promise((res, rej) => { const t = db.transaction('kv').objectStore('kv').get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); });
    },
    async set(k, v) {
      const db = await this.open();
      return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite').objectStore('kv').put(v, k); t.onsuccess = () => res(); t.onerror = () => rej(t.error); });
    },
  };

  async function loadSeminar() {
    try { const s = await idb.get('seminar'); if (s) bank.seminar = Object.assign(defaultSeminar(), s); }
    catch (e) { console.warn('[bank] kunde inte läsa IndexedDB', e); }
  }
  async function saveSeminar() {
    bank.seminar.updatedAt = Date.now();
    try { await idb.set('seminar', bank.seminar); } catch (e) { console.warn('[bank] kunde inte spara i IndexedDB', e); }
  }

  // Samtalsloggen lever bara under seminariet: i minnet och i sessionStorage,
  // så att en omladdning inte tömmer allt. Raderas vid Avsluta och när fliken stängs.
  function saveSession() {
    if (!bank.started) return;
    try {
      sessionStorage.setItem(SS_KEY, JSON.stringify({
        t0: bank.t0, log: bank.log, firstSpoken: bank.firstSpoken, called: bank.called, phoneMode: bank.phone.mode, usage: bank.usage,
      }));
    } catch (e) { /* privat läge */ }
  }
  function readSession() { try { const s = sessionStorage.getItem(SS_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function clearSession() { try { sessionStorage.removeItem(SS_KEY); } catch (e) { /* inget */ } }

  /* ---------------- Samtalsloggen ---------------- */
  function addLog(src, text) {
    bank.log.push({ t: Math.round(secs()), src, text });
    saveSession();
    renderLog();
  }

  function logLine(e) {
    const t = '[' + mmss(e.t) + '] ';
    if (e.src === 'fraga') return t + 'TILL AI-DELTAGAREN: ' + e.text;
    if (e.src === 'bank') return t + 'AI-DELTAGAREN: ' + e.text;
    if (e.src === 'luren') return t + 'I LUREN (' + (e.namn || 'personen') + '): ' + e.text;
    if (e.src === 'bank-luren') return t + 'AI-DELTAGAREN (i luren): ' + e.text;
    return t + '(' + e.text + ')';
  }

  function transcriptForPrompt() {
    const out = []; let words = 0;
    for (let i = bank.log.length - 1; i >= 0; i--) {
      const line = logLine(bank.log[i]);
      words += line.split(/\s+/).length;
      if (words > LOG_MAX_WORDS && out.length) break;
      out.unshift(line);
    }
    return out.length ? out.join('\n') : '(inget ännu)';
  }

  function ownLines() {
    const own = bank.log.filter((e) => e.src === 'bank').slice(-6).map(logLine);
    return own.length ? own.join('\n') : '(inget ännu)';
  }

  function contactsText() {
    return bank.phone.contacts.map((c) =>
      [c.id, c.namn, c.roll, c.arende].filter(Boolean).join(' · ') + (bank.called.includes(c.id) ? ' (redan ringd)' : '')).join('\n');
  }

  /* ---------------- Personan ---------------- */
  function buildPersona() {
    const s = bank.seminar; const r = roleObj();
    const vars = {
      NAMN: PERSONA_NAME,
      FORELASARE: speaker(),
      TITEL: s.title || 'utan titel',
      MALGRUPP: s.audience || 'deltagarna',
      SITUATION: P.SITUATION_TILLTAL,
      ROLL: r.roll,
      TELEFON: phoneOn() ? P.TELEFON_PA : P.TELEFON_AV,
      KONTAKTER: contactsText(),
      FORSTA_GANGEN: bank.firstSpoken ? P.FORSTA_GANGEN_SENARE : P.FORSTA_GANGEN_FORSTA,
      PRESENTATION: r.presentation,
      MINUTER: String(Math.round(secs() / 60)),
      MINNE: '(Inga anteckningar. Du lyssnar inte på seminariet, du hör bara det som sägs till dig.)',
      TRANSKRIPT: transcriptForPrompt(),
      EGNA_REPLIKER: ownLines(),
    };
    // Underlaget läggs in sist, så att inget i det tolkas som platshållare.
    return fill(P.PERSONA, vars).split('{{UNDERLAG}}').join(s.sourceText || '(inget underlag uppladdat)');
  }

  function buildCallPersona() {
    const Ph = bank.phone; const s = bank.seminar;
    const recent = bank.log.slice(-6).map(logLine).join('\n');
    return fill(P.CALL_PERSONA, {
      NAMN: PERSONA_NAME,
      FORELASARE: speaker(),
      ROLL_KORT: roleObj().kort,
      TITEL: s.title || 'utan titel',
      MALGRUPP: s.audience || 'deltagarna',
      KONTAKT_NAMN: Ph.contact.namn,
      KONTAKT_ROLL: Ph.contact.roll || '',
      ARENDE: Ph.arende,
      BAKGRUND: Ph.initiativ === 'lelle'
        ? speaker() + ' bad dig ringa om det här.'
        : 'Det kom upp när du pratade med deltagarna, och ' + speaker() + ' godkände samtalet.',
      MINNE_KORT: recent ? 'Det senaste som sagts till dig och av dig i rummet:\n' + recent : '(inget ännu)',
    });
  }

  const T = {
    ordet: () => '[Läge: ORDET. ' + speaker() + ' ger dig ordet.]',
    sammanfatta: () => '[Läge: SAMMANFATTA. ' + speaker() + ' ber dig sammanfatta hittills för rummet.]',
    ringer: (c, arende, initiativ) => '[Läge: RINGER. Du ska nu ringa ' + c.namn + (c.roll ? ' (' + c.roll + ')' : '') + ' om: "' + arende + '". ' + initiativ + ' Säg kort till rummet vem du ringer och varför, och att de kommer att höra samtalet.]',
    efter: (c, utfall) => '[Läge: EFTER SAMTALET. Samtalet med ' + c.namn + ' är slut. Utfall: ' + utfall + '. Berätta kort för rummet vad du fick veta.]',
  };

  /* ---------------- Ljud ---------------- */
  async function addWorklet(ctx) {
    const url = URL.createObjectURL(new Blob([workletSrc], { type: 'application/javascript' }));
    try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
  }

  async function ensureAudio() {
    const A = bank.audio;
    if (A.outCtx) { if (A.outCtx.state === 'suspended') await A.outCtx.resume(); return; }
    A.outCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (A.outCtx.state === 'suspended') await A.outCtx.resume();
    A.lineOut = A.outCtx.createMediaStreamDestination();
    A.lineMicGain = A.outCtx.createGain(); A.lineMicGain.gain.value = 0; A.lineMicGain.connect(A.lineOut);
    A.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    A.inCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: IN_RATE });
    await addWorklet(A.inCtx);
    A.micSrc = A.inCtx.createMediaStreamSource(A.micStream);
    A.worklet = new AudioWorkletNode(A.inCtx, 'pcm-processor');
    A.worklet.port.onmessage = (e) => onMicFrame(new Int16Array(e.data.buf), e.data.rms);
    A.micSrc.connect(A.worklet);
    const sink = A.inCtx.createGain(); sink.gain.value = 0; A.worklet.connect(sink); sink.connect(A.inCtx.destination);
    // Rummets mikrofon ut på telefonlinjen, bara medan Lelle håller i knappen under ett samtal
    A.lineMicSrc = A.outCtx.createMediaStreamSource(A.micStream); A.lineMicSrc.connect(A.lineMicGain);
  }

  function closeAudio() {
    const A = bank.audio;
    stopPlayback();
    try { A.micStream && A.micStream.getTracks().forEach((t) => t.stop()); } catch (e) { /* inget */ }
    try { A.inCtx && A.inCtx.close(); } catch (e) { /* inget */ }
    try { A.outCtx && A.outCtx.close(); } catch (e) { /* inget */ }
    Object.assign(A, { outCtx: null, inCtx: null, micStream: null, micSrc: null, worklet: null, lineOut: null, lineMicSrc: null, lineMicGain: null, playhead: 0, micLvl: 0 });
    A.sources = new Set(); A.queue = [];
  }

  function playPcm(int16, toLine) {
    const A = bank.audio; if (!A.outCtx) return;
    const f32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768;
    const buf = A.outCtx.createBuffer(1, f32.length, OUT_RATE);
    buf.getChannelData(0).set(f32);
    const src = A.outCtx.createBufferSource();
    src.buffer = buf;
    src.connect(A.outCtx.destination);
    if (toLine && A.lineOut) src.connect(A.lineOut);
    const now = A.outCtx.currentTime;
    if (A.playhead < now) A.playhead = now + 0.03;
    src.start(A.playhead);
    let sum = 0; for (let i = 0; i < f32.length; i += 4) sum += f32[i] * f32[i];
    A.queue.push({ start: A.playhead, end: A.playhead + buf.duration, rms: Math.min(1, Math.sqrt(sum / Math.max(1, f32.length / 4)) * 4) });
    A.playhead += buf.duration;
    A.sources.add(src);
    src.onended = () => A.sources.delete(src);
  }

  function stopPlayback() {
    const A = bank.audio;
    A.sources.forEach((s) => { try { s.stop(); } catch (e) { /* inget */ } });
    A.sources.clear(); A.queue = [];
    A.playhead = A.outCtx ? A.outCtx.currentTime : 0;
  }

  const playing = () => { const A = bank.audio; return !!A.outCtx && (A.sources.size > 0 || A.playhead > A.outCtx.currentTime + 0.02); };
  function whenPlaybackDone(cb) { const tick = () => { if (!playing()) cb(); else setTimeout(tick, 120); }; tick(); }

  function onMicFrame(int16, rms) {
    bank.audio.micLvl = Math.min(1, rms * 4);
    if (bank.phone.state === 'live') return;     // under samtal går mikrofonen via samtalets egen ljudkedja
    const V = bank.voice;
    if (!V.ptt) return;
    V.batch.push(int16);
    if (V.batch.length >= SEND_EVERY_FRAMES) flushVoiceBatch();
  }

  /* ---------------- Rösten i rummet ---------------- */
  function sendVoice(obj) { const ws = bank.voice.ws; if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }
  function sendVoiceAudio(int16) { sendVoice({ realtimeInput: { audio: { data: int16ToBase64(int16), mimeType: 'audio/pcm;rate=' + IN_RATE } } }); }

  function flushVoiceBatch() {
    const V = bank.voice; if (!V.batch.length) return;
    const merged = concatInt16(V.batch); V.batch = [];
    if (V.state === 'open') sendVoiceAudio(merged);
    else {
      V.pendingAudio.push(merged);
      let frames = 0; for (const a of V.pendingAudio) frames += a.length / 128;
      while (frames > PENDING_MAX_FRAMES && V.pendingAudio.length > 1) frames -= V.pendingAudio.shift().length / 128;
    }
  }

  function voiceSetup() {
    const setup = {
      model: 'models/' + MODEL_NAME,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName() } }, languageCode: LANGUAGE_CODE },
      },
      systemInstruction: { parts: [{ text: buildPersona() }] },
      realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    };
    if (phoneOn()) setup.tools = [{ functionDeclarations: [toGeminiDecl(P.FUNC_BEGAR_SAMTAL)] }];
    return { setup };
  }

  function openVoice(trigger) {
    const V = bank.voice;
    if (trigger) V.pendingTrigger = trigger;
    if (V.state === 'open') { if (V.pendingTrigger) { sendTrigger(V.pendingTrigger); V.pendingTrigger = null; } return; }
    if (V.state === 'opening') return;
    const key = getKey();
    if (!key) { status('Ingen Gemini-nyckel', 'Öppna kugghjulet och lägg in nyckeln', 'error'); V.pendingTrigger = null; return; }
    V.state = 'opening'; V.setupAt = performance.now(); V.sessionTokens = 0; V.closeAfterTurn = false;
    status(PERSONA_NAME + ' harklar sig …', '');
    const ws = new WebSocket(wsUrl(key));
    V.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify(voiceSetup()));
    ws.onmessage = (ev) => onVoiceMessage(ev.data, ws);
    ws.onerror = () => { if (V.ws === ws) status('Anslutningsfel', 'Kontrollera nyckeln och nätverket', 'error'); };
    ws.onclose = (ev) => { if (V.ws === ws) voiceClosed(ev); };
    render();
  }

  function sendTrigger(text) {
    clearTimeout(bank.voice.timers.idle);
    sendVoice({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } });
  }

  async function onVoiceMessage(raw, ws) {
    const msg = await parseMsg(raw);
    const V = bank.voice;
    if (!msg || V.ws !== ws) return;

    if (msg.usageMetadata && msg.usageMetadata.totalTokenCount) V.sessionTokens = Math.max(V.sessionTokens, msg.usageMetadata.totalTokenCount);

    if (msg.setupComplete) {
      V.state = 'open'; V.openedAt = Date.now();
      console.info('[bank] röst uppkopplad efter', Math.round(performance.now() - V.setupAt), 'ms');
      startFloorTimers();
      if (V.ptt || V.pendingAudio.length || V.pendingEnd) {
        sendVoice({ realtimeInput: { activityStart: {} } });
        for (const a of V.pendingAudio) sendVoiceAudio(a);
        V.pendingAudio = [];
        if (V.pendingEnd) { sendVoice({ realtimeInput: { activityEnd: {} } }); V.pendingEnd = false; }
      }
      if (V.pendingTrigger) { sendTrigger(V.pendingTrigger); V.pendingTrigger = null; }
      status('', '');
      render();
      return;
    }

    const sc = msg.serverContent;
    if (sc) {
      if (sc.interrupted) stopPlayback();
      const parts = (sc.modelTurn && sc.modelTurn.parts) || [];
      for (const p of parts) {
        const d = p.inlineData || p.inline_data;
        if (d && d.data && !V.ptt) { playPcm(base64ToInt16(d.data), false); markVoiceSpoke(); }
      }
      const it = sc.inputTranscription || sc.input_transcription;
      if (it && it.text) V.curIn += it.text;
      const ot = sc.outputTranscription || sc.output_transcription;
      if (ot && ot.text) { V.curOut += ot.text; markVoiceSpoke(); }
      if (sc.turnComplete || sc.turn_complete) voiceTurnComplete();
    }
    if (msg.toolCall) onVoiceToolCall(msg.toolCall);
    if (msg.goAway) { V.closeAfterTurn = true; if (!V.speaking && !V.ptt) closeVoice(false); }
    if (msg.error) status('Fel från Google', msg.error.message || 'Okänt fel', 'error');
  }

  function markVoiceSpoke() {
    const V = bank.voice;
    V.gotAudio = true;
    if (!V.speaking) { V.speaking = true; render(); }
    if (!bank.firstSpoken) { bank.firstSpoken = true; saveSession(); }
  }

  function voiceTurnComplete() {
    const V = bank.voice;
    if (V.curIn.trim()) addLog('fraga', V.curIn.trim());
    if (V.curOut.trim()) addLog('bank', V.curOut.trim());
    V.curIn = ''; V.curOut = '';
    whenPlaybackDone(() => {
      V.speaking = false;
      const cbs = V.afterTurn; V.afterTurn = [];
      cbs.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
      if (V.closeAfterTurn && V.state === 'open' && !V.ptt) { closeVoice(false); return; }
      armIdleClose();
      render();
    });
  }

  function armIdleClose() {
    const V = bank.voice;
    clearTimeout(V.timers.idle);
    if (V.state !== 'open' || V.ptt || bank.phone.state !== 'idle' || bank.modal) return;
    V.timers.idle = setTimeout(() => { if (!V.ptt && !V.speaking && !bank.modal && bank.phone.state === 'idle') closeVoice(false); }, IDLE_CLOSE_MS);
  }

  function startFloorTimers() {
    const V = bank.voice;
    clearTimeout(V.timers.warn); clearTimeout(V.timers.max);
    V.timers.warn = setTimeout(() => status('Samtalet med ' + PERSONA_NAME + ' närmar sig åtta minuter', 'Hon kopplar upp sig på nytt när det behövs, och minns det som sagts', 'warn'), FLOOR_WARN_MS);
    V.timers.max = setTimeout(() => { V.closeAfterTurn = true; if (!V.speaking && !V.ptt) closeVoice(false); }, FLOOR_MAX_MS);
  }

  function closeVoice(stop) {
    const V = bank.voice;
    if (stop) stopPlayback();
    Object.values(V.timers).forEach((t) => clearTimeout(t)); V.timers = {};
    if (V.curIn.trim()) addLog('fraga', V.curIn.trim());
    if (V.curOut.trim()) addLog('bank', V.curOut.trim());
    V.curIn = ''; V.curOut = '';
    const ws = V.ws; V.ws = null;
    if (ws) { try { ws.close(1000, 'klar'); } catch (e) { /* inget */ } }
    bank.usage.voice += V.sessionTokens; V.sessionTokens = 0;
    Object.assign(V, { state: 'closed', speaking: false, pendingAudio: [], pendingEnd: false, batch: [], pendingTrigger: null, closeAfterTurn: false });
    saveSession();
    render();
  }

  function voiceClosed(ev) {
    const V = bank.voice;
    const wasOpening = V.state === 'opening';
    V.ws = null;
    closeVoice(false);
    if (ev && ev.code !== 1000 && ev.code !== 1005) {
      status(wasOpening ? 'Kunde inte koppla upp ' + PERSONA_NAME : 'Rösten kopplades ned',
        ev.code === 1008 || ev.code === 1011 ? 'Nyckeln nekades eller modellen finns inte' : 'Försök igen', 'error');
    }
    if (bank.phone.state === 'announcing') finishAnnouncement();
  }

  /* ---------------- Håll för att prata ---------------- */
  function pttDown() {
    if (!bank.started || bank.modal) return;
    const Ph = bank.phone;
    if (Ph.state === 'live') { callPtt(true); return; }
    if (Ph.state !== 'idle') return;
    const V = bank.voice;
    if (V.ptt) return;
    V.ptt = true; V.batch = [];
    clearTimeout(V.timers.idle);
    stopPlayback();
    if (V.state === 'open') sendVoice({ realtimeInput: { activityStart: {} } });
    else { V.pendingAudio = []; V.pendingEnd = false; openVoice(null); }
    render();
  }

  function pttUp() {
    const Ph = bank.phone;
    if (Ph.ptt) { callPtt(false); return; }
    const V = bank.voice;
    if (!V.ptt) return;
    V.ptt = false;
    flushVoiceBatch();
    if (V.state === 'open') sendVoice({ realtimeInput: { activityEnd: {} } });
    else V.pendingEnd = true;
    render();
  }

  function giveFloor(trigger) {
    if (!bank.started || bank.phone.state !== 'idle' || bank.voice.ptt) return;
    openVoice(trigger);
  }

  function escAction() {
    const Ph = bank.phone;
    if (Ph.state === 'announcing') { cancelAnnouncement(); return; }
    if (Ph.state === 'dialing' || Ph.state === 'ringing' || Ph.state === 'live') { hangUp('avbrutet av ' + speaker()); return; }
    const V = bank.voice;
    if (playing()) { stopPlayback(); return; }
    if (V.state !== 'closed') closeVoice(true);
  }

  /* ---------------- Telefonen: tjänsten hos Twilio ---------------- */
  async function telPost(path) {
    const res = await fetch(telUrl() + '/' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ key: telKey() }).toString(),
    });
    if (!res.ok) throw new Error(path + ' svarade ' + res.status);
    return res.json();
  }

  async function loadContacts() {
    if (!phoneConfigured()) { bank.phone.contacts = []; return 0; }
    const data = await telPost('kontakter');
    bank.phone.contacts = Array.isArray(data) ? data.filter((c) => c && c.id && c.namn) : [];
    render();
    return bank.phone.contacts.length;
  }

  let twilioLoading = null;
  function ensureTwilio() {
    if (window.Twilio && window.Twilio.Device) return Promise.resolve();
    if (twilioLoading) return twilioLoading;
    twilioLoading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = TWILIO_SDK;
      s.onload = () => (window.Twilio && window.Twilio.Device ? res() : rej(new Error('Twilios SDK laddades men saknar Device')));
      s.onerror = () => { twilioLoading = null; rej(new Error('Twilios SDK saknas (' + TWILIO_SDK + '). Kör node tools/hamta-twilio-sdk.mjs')); };
      document.head.appendChild(s);
    });
    return twilioLoading;
  }

  /* ---------------- Telefonen: samtalets gång ---------------- */
  function startCallFlow(opts) {
    const Ph = bank.phone;
    if (Ph.state !== 'idle') return;
    Object.assign(Ph, {
      state: 'announcing', contact: opts.contact, arende: opts.arende || opts.contact.arende || '',
      initiativ: opts.initiativ, grund: opts.grund || '', announceDone: false, answered: false,
      outcomeHint: '', heardRemote: false, callSpoke: false, curIn: '', curOut: '', pending: [], batch: [],
    });
    const V = bank.voice;
    V.gotAudio = false;
    V.afterTurn.push(finishAnnouncement);
    Ph.timers.noAudio = setTimeout(() => { if (!V.gotAudio) finishAnnouncement(); }, ANNOUNCE_NO_AUDIO_MS);
    Ph.timers.maxAnnounce = setTimeout(finishAnnouncement, ANNOUNCE_MAX_MS);
    if (opts.fc && V.ws && V.ws.readyState === WebSocket.OPEN) {
      respondTool(V.ws, opts.fc, { status: 'godkänt', scheduling: 'WHEN_IDLE' });
    } else {
      // Lelle bad om samtalet, eller rösten hann stängas medan kortet visades
      const initiativText = opts.fc ? speaker() + ' har godkänt ditt förslag.' : speaker() + ' har bett dig ringa.';
      openVoice(T.ringer(Ph.contact, Ph.arende, initiativText));
    }
    render();
  }

  function finishAnnouncement() {
    const Ph = bank.phone;
    if (Ph.state !== 'announcing' || Ph.announceDone) return;
    Ph.announceDone = true;
    clearTimeout(Ph.timers.noAudio); clearTimeout(Ph.timers.maxAnnounce);
    bank.voice.afterTurn = bank.voice.afterTurn.filter((f) => f !== finishAnnouncement);
    whenPlaybackDone(() => { closeVoice(false); dial(); });
  }

  function cancelAnnouncement() {
    const Ph = bank.phone;
    clearTimeout(Ph.timers.noAudio); clearTimeout(Ph.timers.maxAnnounce);
    bank.voice.afterTurn = bank.voice.afterTurn.filter((f) => f !== finishAnnouncement);
    stopPlayback();
    addLog('system', 'Samtalet till ' + Ph.contact.namn + ' stoppades innan det ringdes');
    resetPhone();
    render();
  }

  function resetPhone() {
    Object.values(bank.phone.timers).forEach((t) => clearTimeout(t));
    bank.phone = freshPhone(bank.phone.mode, bank.phone.contacts);
  }

  const lineProcessor = {
    async createProcessedStream() { return bank.audio.lineOut.stream; },
    async destroyProcessedStream() { /* lineOut ägs av Bänkgrannen */ },
  };

  async function dial() {
    const Ph = bank.phone;
    if (Ph.state !== 'announcing') return;
    Ph.state = 'dialing'; render();
    status('Ringer ' + Ph.contact.namn + ' …', '');
    try {
      await ensureTwilio();
      const tok = await telPost('token');
      if (!tok || !tok.token) throw new Error('Ingen nyckel från telefontjänsten');
      openCallSession();
      Ph.device = new window.Twilio.Device(tok.token, { edge: TWILIO_EDGES, closeProtection: false, logLevel: 'warn' });
      await Ph.device.audio.addProcessor(lineProcessor);
      Ph.call = await Ph.device.connect({ params: { kontakt: Ph.contact.id } });
      wireCall(Ph.call);
    } catch (e) {
      console.error('[bank] samtalet kunde inte ringas', e);
      endCall('tekniskt fel', String((e && e.message) || e));
    }
  }

  function wireCall(call) {
    const Ph = bank.phone;
    call.on('ringing', () => { if (Ph.call === call && Ph.state === 'dialing') { Ph.state = 'ringing'; render(); status('Det ringer hos ' + Ph.contact.namn, ''); } });
    // I Twilios SDK kommer 'accept' först när den uppringda har svarat (answerOnBridge).
    call.on('accept', () => { if (Ph.call === call) onAnswered(); });
    call.on('disconnect', () => { if (Ph.call === call) endCall(Ph.answered ? (Ph.outcomeHint || 'genomfört') : (Ph.outcomeHint || 'inget svar')); });
    call.on('cancel', () => { if (Ph.call === call) endCall(Ph.outcomeHint || 'inget svar'); });
    call.on('reject', () => { if (Ph.call === call) endCall('avböjde'); });
    call.on('error', (err) => { if (Ph.call === call) endCall('tekniskt fel', (err && err.message) || ''); });
  }

  async function onAnswered() {
    const Ph = bank.phone;
    if (Ph.answered) return;
    Ph.answered = true; Ph.answeredAt = Date.now(); Ph.state = 'live';
    status('I luren med ' + Ph.contact.namn, 'Håll mellanslag för att prata i luren. Esc lägger på.');
    render();
    try { await startRemotePipeline(); }
    catch (e) { console.error('[bank] ljudet från linjen', e); status('Ljudet från linjen kunde inte kopplas in', String(e.message || e), 'error'); }
    Ph.timers.silent = setTimeout(() => {
      if (!Ph.heardRemote && !Ph.callSpoke && Ph.state === 'live') sendCall({ clientContent: { turns: [{ role: 'user', parts: [{ text: P.SAMTAL_START }] }], turnComplete: true } });
    }, SILENT_START_MS);
    Ph.timers.warn = setTimeout(() => status('Samtalet har pågått i sex minuter', 'Tidsgränsen är åtta minuter', 'warn'), CALL_WARN_MS);
  }

  async function startRemotePipeline() {
    const Ph = bank.phone;
    const remote = Ph.call && Ph.call.getRemoteStream();
    if (!remote) throw new Error('Ingen ljudström från linjen');
    Ph.ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: IN_RATE });
    await addWorklet(Ph.ctx);
    Ph.worklet = new AudioWorkletNode(Ph.ctx, 'pcm-processor');
    Ph.remoteSrc = Ph.ctx.createMediaStreamSource(remote);
    Ph.remoteSrc.connect(Ph.worklet);
    Ph.micGain = Ph.ctx.createGain(); Ph.micGain.gain.value = 0;
    if (bank.audio.micStream) { Ph.ctx.createMediaStreamSource(bank.audio.micStream).connect(Ph.micGain); Ph.micGain.connect(Ph.worklet); }
    const sink = Ph.ctx.createGain(); sink.gain.value = 0; Ph.worklet.connect(sink); sink.connect(Ph.ctx.destination);
    Ph.worklet.port.onmessage = (e) => onRemoteFrame(new Int16Array(e.data.buf), e.data.rms);
  }

  function onRemoteFrame(int16, rms) {
    const Ph = bank.phone;
    Ph.remoteLvl = Math.min(1, rms * 4);
    if (rms > 0.02) Ph.heardRemote = true;
    Ph.batch.push(int16);
    if (Ph.batch.length < SEND_EVERY_FRAMES) return;
    const merged = concatInt16(Ph.batch); Ph.batch = [];
    if (Ph.setupDone) sendCallAudio(merged);
    else { Ph.pending.push(merged); if (Ph.pending.length > 150) Ph.pending.shift(); }
  }

  function callPtt(on) {
    const Ph = bank.phone;
    Ph.ptt = on;
    if (Ph.micGain) Ph.micGain.gain.value = on ? 1 : 0;
    if (bank.audio.lineMicGain) bank.audio.lineMicGain.gain.value = on ? 1 : 0;
    render();
  }

  function sendCall(obj) { const ws = bank.phone.ws; if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }
  function sendCallAudio(int16) { sendCall({ realtimeInput: { audio: { data: int16ToBase64(int16), mimeType: 'audio/pcm;rate=' + IN_RATE } } }); }

  function callSetup() {
    return {
      setup: {
        model: 'models/' + MODEL_NAME,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName() } }, languageCode: LANGUAGE_CODE },
        },
        systemInstruction: { parts: [{ text: buildCallPersona() }] },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        tools: [{ functionDeclarations: [toGeminiDecl(P.FUNC_LAGG_PA)] }],
      },
    };
  }

  function openCallSession() {
    const Ph = bank.phone;
    const ws = new WebSocket(wsUrl(getKey()));
    Ph.ws = ws; Ph.setupDone = false; Ph.sessionTokens = 0;
    ws.onopen = () => ws.send(JSON.stringify(callSetup()));
    ws.onmessage = (ev) => onCallMessage(ev.data, ws);
    ws.onclose = () => {
      if (Ph.ws !== ws) return;
      Ph.ws = null; Ph.setupDone = false;
      if (Ph.state === 'live') status('Samtalsrösten tappade anslutningen', 'Lägg på med Esc', 'error');
    };
  }

  async function onCallMessage(raw, ws) {
    const msg = await parseMsg(raw);
    const Ph = bank.phone;
    if (!msg || Ph.ws !== ws) return;
    if (msg.usageMetadata && msg.usageMetadata.totalTokenCount) Ph.sessionTokens = Math.max(Ph.sessionTokens, msg.usageMetadata.totalTokenCount);
    if (msg.setupComplete) {
      Ph.setupDone = true;
      for (const a of Ph.pending) sendCallAudio(a);
      Ph.pending = [];
      return;
    }
    const sc = msg.serverContent;
    if (sc) {
      if (sc.interrupted) stopPlayback();
      const parts = (sc.modelTurn && sc.modelTurn.parts) || [];
      for (const p of parts) {
        const d = p.inlineData || p.inline_data;
        if (d && d.data) { playPcm(base64ToInt16(d.data), true); Ph.callSpoke = true; }
      }
      const it = sc.inputTranscription || sc.input_transcription;
      if (it && it.text) Ph.curIn += it.text;
      const ot = sc.outputTranscription || sc.output_transcription;
      if (ot && ot.text) { Ph.curOut += ot.text; Ph.callSpoke = true; }
      if (sc.turnComplete || sc.turn_complete) flushCallTranscript();
    }
    if (msg.toolCall) {
      for (const fc of msg.toolCall.functionCalls || []) {
        respondTool(ws, fc, { status: 'ok' });
        if (fc.name === 'lagg_pa') { Ph.outcomeHint = 'genomfört'; whenPlaybackDone(() => hangUp('genomfört')); }
      }
    }
    if (msg.error) status('Fel från Google i samtalet', msg.error.message || '', 'error');
  }

  function flushCallTranscript() {
    const Ph = bank.phone;
    const namn = Ph.contact ? Ph.contact.namn : 'personen';
    if (Ph.curIn.trim()) { bank.log.push({ t: Math.round(secs()), src: 'luren', namn, text: Ph.curIn.trim() }); }
    if (Ph.curOut.trim()) { bank.log.push({ t: Math.round(secs()), src: 'bank-luren', text: Ph.curOut.trim() }); }
    Ph.curIn = ''; Ph.curOut = '';
    saveSession(); renderLog();
  }

  function hangUp(hint) {
    const Ph = bank.phone;
    if (hint && !Ph.outcomeHint) Ph.outcomeHint = hint;
    if (hint && hint.indexOf('avbrutet') === 0) Ph.outcomeHint = hint;
    if (Ph.call) { try { Ph.call.disconnect(); } catch (e) { endCall(Ph.outcomeHint || 'avbrutet'); } }
    else endCall(Ph.outcomeHint || 'avbrutet');
  }

  function endCall(outcome, detail) {
    const Ph = bank.phone;
    if (Ph.state === 'idle' || Ph.state === 'ending') return;
    Ph.state = 'ending';
    Object.values(Ph.timers).forEach((t) => clearTimeout(t));
    flushCallTranscript();
    const ws = Ph.ws; Ph.ws = null;
    if (ws) { try { ws.close(1000, 'samtalet slut'); } catch (e) { /* inget */ } }
    try { Ph.worklet && (Ph.worklet.port.onmessage = null); } catch (e) { /* inget */ }
    try { Ph.ctx && Ph.ctx.close(); } catch (e) { /* inget */ }
    try { Ph.device && Ph.device.destroy(); } catch (e) { /* inget */ }
    if (bank.audio.lineMicGain) bank.audio.lineMicGain.gain.value = 0;
    if (Ph.answeredAt) bank.usage.callMs += Date.now() - Ph.answeredAt;
    bank.usage.call += Ph.sessionTokens;
    const c = Ph.contact;
    if (c && !bank.called.includes(c.id)) bank.called.push(c.id);
    if (c) addLog('system', 'Samtal till ' + c.namn + ': ' + outcome + (detail ? ' (' + detail + ')' : ''));
    resetPhone();
    status(outcome === 'tekniskt fel' ? 'Samtalet kunde inte genomföras' : 'Samtalet är slut', detail || '', outcome === 'tekniskt fel' ? 'error' : null);
    render();
    if (c) whenPlaybackDone(() => giveFloor(T.efter(c, outcome)));
  }

  function respondTool(ws, fc, response) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ toolResponse: { functionResponses: [{ id: fc.id, name: fc.name, response }] } }));
  }

  function onVoiceToolCall(tc) {
    const ws = bank.voice.ws;
    for (const fc of tc.functionCalls || []) {
      if (fc.name !== 'begar_samtal') { respondTool(ws, fc, { status: 'inte möjligt', skal: 'Okänd funktion.' }); continue; }
      const a = fc.args || {};
      const c = bank.phone.contacts.find((x) => x.id === a.kontakt_id);
      if (!phoneOn()) respondTool(ws, fc, { status: 'inte möjligt', skal: 'Telefonen är avstängd.' });
      else if (!c) respondTool(ws, fc, { status: 'inte möjligt', skal: 'Personen finns inte på telefonlistan.' });
      else if (bank.called.includes(c.id)) respondTool(ws, fc, { status: 'inte möjligt', skal: 'Personen har redan ringts under seminariet.' });
      else if (bank.phone.state !== 'idle' || bank.modal) respondTool(ws, fc, { status: 'inte möjligt', skal: 'Det går inte att ringa just nu.' });
      else showCallCard({ contact: c, arende: a.arende || c.arende || '', grund: a.grund || '', fc });
    }
  }

  /* ---------------- Gränssnittet ---------------- */
  const CSS = `
  body.sect-bankgrannen{
    --g1:#1f4a52; --g2:#143238; --g3:#0b2126; --g4:#071519; --g5:#030a0c;
    --glow:rgba(120,200,210,.22);
    --accent-1:#f6b955; --accent-2:#e0001c;
    --ink:#eef7f8; --muted:rgba(230,245,248,.62);
    font-family:"Jost","Century Gothic","Futura",system-ui,sans-serif;
    overflow-y:auto;
  }
  body.sect-bankgrannen .callhead, body.sect-bankgrannen .caller, body.sect-bankgrannen .hint, body.sect-bankgrannen #status{display:none}
  body.sect-bankgrannen #viewCall{justify-content:flex-start;padding-top:max(76px,calc(env(safe-area-inset-top) + 60px));padding-bottom:calc(84px + env(safe-area-inset-bottom))}
  .bank{display:none;flex-direction:column;align-items:center;gap:18px;width:min(720px,100%)}
  body.sect-bankgrannen .bank{display:flex}
  .bank h1{margin:0;font-weight:600;font-size:clamp(40px,9vw,72px);line-height:1;letter-spacing:-.02em}
  .bank .bank-sub{margin:0;color:var(--muted);letter-spacing:.2em;text-transform:uppercase;font-size:13px}
  .bank-kort{width:100%;border:1px solid var(--glass-line);background:var(--glass);border-radius:18px;padding:18px 20px;text-align:left;display:grid;gap:6px;font-size:15px}
  .bank-kort b{font-weight:600}
  .bank-kort .rad{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid rgba(255,255,255,.07);padding:6px 0}
  .bank-kort .rad:last-child{border-bottom:0}
  .bank-kort .rad span:first-child{color:var(--muted)}
  .bank-knappar{display:flex;flex-wrap:wrap;gap:10px;justify-content:center}
  .bank-btn{appearance:none;cursor:pointer;font-family:inherit;font-weight:500;font-size:16px;letter-spacing:.02em;padding:13px 20px;border-radius:999px;border:1px solid var(--glass-line);background:var(--glass);color:var(--ink);min-height:44px}
  .bank-btn:hover{background:rgba(255,255,255,.14)}
  .bank-btn:focus-visible{outline:3px solid var(--ink);outline-offset:3px}
  .bank-btn.primar{border:0;color:#2a0e06;font-weight:600;background:linear-gradient(180deg,#ffe9b0,#f6b955 55%,#e09a33);box-shadow:0 10px 30px rgba(224,140,40,.35)}
  .bank-btn.fara{border-color:rgba(255,77,94,.6);color:#ffd5da}
  .bank-btn[hidden]{display:none}
  .bank-topp{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:14px;color:var(--muted)}
  .bank-topp b{color:var(--ink);font-weight:600;letter-spacing:.12em;text-transform:uppercase;font-size:13px}
  .bank-klocka{font-variant-numeric:tabular-nums;letter-spacing:.06em}
  .bank-lampa{min-width:220px;text-align:center;padding:12px 22px;border-radius:10px;font-weight:600;letter-spacing:.24em;font-size:18px;
    background:#160f0d;color:rgba(255,255,255,.28);border:2px solid #2a1e1a;box-shadow:inset 0 0 18px rgba(0,0,0,.6);transition:all .25s ease}
  .bank-lampa.lyssnar{background:#5a0008;color:#ffe4e6;border-color:#e0001c;box-shadow:0 0 28px rgba(224,0,28,.6),inset 0 0 14px rgba(255,120,120,.35)}
  .bank-lampa.ordet,.bank-lampa.luren{background:#4a2a05;color:#fff2d6;border-color:#f6b955;box-shadow:0 0 26px rgba(246,185,85,.5),inset 0 0 14px rgba(255,220,150,.3)}
  .bank-lampa.ringer{background:#4a2a05;color:#fff2d6;border-color:#f6b955;animation:bankpuls 1s ease-in-out infinite}
  @keyframes bankpuls{50%{box-shadow:0 0 34px rgba(246,185,85,.75);opacity:.75}}
  @media (prefers-reduced-motion: reduce){ .bank-lampa.ringer{animation:none} }
  .bank-vu{position:relative;width:min(420px,100%,40vh);aspect-ratio:1.9/1;border-radius:16px;padding:12px;background:linear-gradient(180deg,#14262a,#081215);box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 20px 50px rgba(0,0,0,.5)}
  .bank-vu svg{width:100%;height:100%;display:block;border-radius:9px}
  .bank-ptt{appearance:none;border:0;cursor:pointer;font-family:inherit;font-weight:600;font-size:22px;letter-spacing:.03em;padding:22px 42px;border-radius:999px;min-width:min(360px,100%);color:#2a0e06;
    background:linear-gradient(180deg,#ffe9b0,#f6b955 55%,#e09a33);box-shadow:0 14px 40px rgba(224,140,40,.4),inset 0 1px 0 rgba(255,255,255,.7);touch-action:none;user-select:none}
  .bank-ptt.nere{color:#fff;background:linear-gradient(180deg,#ff4d5e,#e0001c 60%,#a30014);box-shadow:0 10px 30px rgba(224,0,28,.5)}
  .bank-ptt:disabled{opacity:.45;cursor:default}
  .bank-telefon{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted)}
  .bank-telefon button{appearance:none;cursor:pointer;font:inherit;padding:7px 12px;border-radius:999px;border:1px solid var(--glass-line);background:transparent;color:var(--muted)}
  .bank-telefon button.vald{background:rgba(246,185,85,.18);border-color:#f6b955;color:var(--ink)}
  .bank-status{min-height:44px;text-align:center}
  .bank-status .l{font-size:17px;font-weight:500}
  .bank-status .s{font-size:13px;color:var(--muted)}
  .bank-status.error .l{color:#ff6b78}
  .bank-status.warn .l{color:#f6b955}
  .bank-logg{width:100%;font-size:13px;color:var(--muted);text-align:left;border-top:1px solid rgba(255,255,255,.08);padding-top:10px;display:grid;gap:4px}
  .bank-logg[hidden]{display:none}
  .bank-hjalp{font-size:12px;color:var(--muted);text-align:center;max-width:56ch;line-height:1.5}
  .bank-modal{position:fixed;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(3,8,10,.66);backdrop-filter:blur(6px)}
  .bank-ark{width:min(620px,100%);max-height:calc(100dvh - 32px);overflow:auto;border-radius:20px;padding:24px;background:linear-gradient(180deg,rgba(20,44,50,.98),rgba(8,18,21,.99));border:1px solid var(--glass-line);color:var(--ink);text-align:left;box-shadow:0 30px 80px rgba(0,0,0,.55)}
  .bank-ark h2{margin:0 0 8px;font-size:22px;font-weight:600}
  .bank-ark h3{margin:18px 0 8px;font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:500}
  .bank-ark p{margin:0 0 10px;line-height:1.55;font-size:15px}
  .bank-ark .liten{font-size:13px;color:var(--muted)}
  .bank-ark label{display:block;font-size:12px;color:var(--muted);margin:10px 0 6px;text-transform:uppercase;letter-spacing:.06em}
  .bank-ark input[type=text],.bank-ark input[type=password],.bank-ark input[type=url],.bank-ark select,.bank-ark textarea{width:100%;box-sizing:border-box;background:rgba(0,0,0,.28);border:1px solid var(--glass-line);color:var(--ink);border-radius:12px;padding:11px 12px;font:15px/1.4 inherit;font-family:inherit}
  .bank-ark textarea{min-height:90px;resize:vertical}
  .bank-ark .val{display:flex;gap:16px;flex-wrap:wrap;font-size:15px}
  .bank-ark .val label{display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font-size:15px;color:var(--ink);margin:4px 0}
  .bank-ark .val label.av{color:var(--muted)}
  .bank-ark .knappar{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:20px}
  .bank-ark .manus{white-space:pre-wrap;background:rgba(0,0,0,.22);border-radius:12px;padding:14px 16px;font-size:16px;line-height:1.6}
  .bank-ark .varning{color:#f6b955}
  .bank-ark .fel{color:#ff6b78}
  .bank-ark .kostnad{font-variant-numeric:tabular-nums;font-size:14px}
  @media (max-width:480px){
    .bank .bank-vu,.bank .bank-logg,.bank .bank-hjalp,.bank .bank-sek{display:none}
    .bank-ptt{padding:18px 24px;font-size:19px}
  }`;

  const ui = {};

  function mount() {
    if (bank.mounted) return;
    const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
    const wrap = document.createElement('div');
    wrap.className = 'bank'; wrap.id = 'bank';
    wrap.innerHTML = `
      <div class="bank-prep" id="bankPrep" style="display:flex;flex-direction:column;align-items:center;gap:18px;width:100%">
        <h1>Bänkgrannen</h1>
        <p class="bank-sub">En AI på seminariet</p>
        <div class="bank-kort" id="bankKort"></div>
        <div class="bank-knappar">
          <button class="bank-btn" type="button" id="bankOppnaPanel">Seminariet</button>
          <button class="bank-btn primar" type="button" id="bankBorja">Börja</button>
        </div>
        <p class="bank-hjalp">${esc(PERSONA_NAME)} hör bara det som sägs till henne när någon håller i talknappen. Lägg aldrig in eller säg något som kan röja en källa.</p>
      </div>
      <div class="bank-live" id="bankLive" style="display:none;flex-direction:column;align-items:center;gap:16px;width:100%">
        <div class="bank-topp">
          <span><b>Bänkgrannen</b> <span id="bankTitel"></span></span>
          <span class="bank-klocka" id="bankKlocka">00:00</span>
          <button class="bank-btn" type="button" id="bankAvsluta" style="padding:8px 14px;font-size:13px;min-height:36px">Avsluta</button>
        </div>
        <div class="bank-lampa" id="bankLampa" role="status" aria-live="polite">REDO</div>
        <div class="bank-telefon" id="bankTelefon" hidden>
          <span>Telefon</span>
          <button type="button" data-mode="av">Av</button>
          <button type="button" data-mode="fraga">Fråga först</button>
        </div>
        <div class="bank-vu"><svg id="bankVu" viewBox="0 0 400 210" aria-hidden="true"></svg></div>
        <button class="bank-ptt" type="button" id="bankPtt">Håll för att prata</button>
        <div class="bank-knappar">
          <button class="bank-btn" type="button" id="bankTack">Tack, ${esc(PERSONA_NAME)}</button>
          <button class="bank-btn" type="button" id="bankRing" hidden>Ring</button>
          <button class="bank-btn fara" type="button" id="bankLaggPa" hidden>Lägg på</button>
        </div>
        <div class="bank-status" id="bankStatus" aria-live="polite"><div class="l"></div><div class="s"></div></div>
        <div class="bank-logg" id="bankLogg" hidden></div>
        <p class="bank-hjalp bank-sek">Mellanslag: håll för att prata · Enter: ge henne ordet · S: sammanfatta · R: ring · Esc: tyst, lägg på eller sätt dig · T: visa samtalen</p>
      </div>`;
    els.viewCall.appendChild(wrap);
    Object.assign(ui, {
      prep: $('#bankPrep'), live: $('#bankLive'), kort: $('#bankKort'), titel: $('#bankTitel'), klocka: $('#bankKlocka'),
      lampa: $('#bankLampa'), telefon: $('#bankTelefon'), vu: $('#bankVu'), ptt: $('#bankPtt'), tack: $('#bankTack'),
      ring: $('#bankRing'), laggPa: $('#bankLaggPa'), status: $('#bankStatus'), logg: $('#bankLogg'),
    });
    $('#bankOppnaPanel').addEventListener('click', openPanel);
    $('#bankBorja').addEventListener('click', openStart);
    $('#bankAvsluta').addEventListener('click', openEnd);
    ui.tack.addEventListener('click', () => { if (bank.phone.state === 'idle') closeVoice(true); });
    ui.ring.addEventListener('click', openRingDialog);
    ui.laggPa.addEventListener('click', () => escAction());
    ui.telefon.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => setPhoneMode(b.dataset.mode)));
    ui.ptt.addEventListener('pointerdown', (e) => { e.preventDefault(); try { ui.ptt.setPointerCapture(e.pointerId); } catch (x) { /* inget */ } pttDown(); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => ui.ptt.addEventListener(ev, () => pttUp()));
    buildVu(ui.vu);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    setInterval(() => { if (bank.started && ui.klocka) ui.klocka.textContent = mmss(secs()); }, 1000);
    requestAnimationFrame(vuLoop);
    bank.mounted = true;
  }

  function status(line, sub, kind) {
    if (!ui.status) return;
    ui.status.className = 'bank-status' + (kind ? ' ' + kind : '');
    ui.status.querySelector('.l').textContent = line || '';
    ui.status.querySelector('.s').textContent = sub || '';
  }

  function render() {
    if (!bank.mounted) return;
    const s = bank.seminar; const r = roleObj();
    ui.prep.style.display = bank.started ? 'none' : 'flex';
    ui.live.style.display = bank.started ? 'flex' : 'none';
    const tokens = estTokens(s.sourceText);
    ui.kort.innerHTML = [
      ['Seminarium', s.title || '(ingen titel)'],
      ['Roll', r.label + ' · röst ' + voiceName()],
      ['Underlag', s.sourceText ? (s.sourceFiles.length ? s.sourceFiles.join(', ') + ' · ' : '') + 'cirka ' + tokens.toLocaleString('sv-SE') + ' tokens' : 'inget ännu'],
      ['Telefon', phoneConfigured() ? 'inställd' : 'inte inställd'],
      ['Gemini-nyckel', getKey() ? 'finns' : 'saknas'],
    ].map(([a, b]) => '<div class="rad"><span>' + esc(a) + '</span><span>' + esc(b) + '</span></div>').join('');
    ui.titel.textContent = s.title ? '· ' + s.title : '';
    const Ph = bank.phone; const V = bank.voice;
    let lamp = 'REDO'; let cls = '';
    if (Ph.state === 'live') { lamp = Ph.ptt ? 'LYSSNAR · I LUREN' : 'I LUREN'; cls = Ph.ptt ? 'lyssnar' : 'luren'; }
    else if (Ph.state === 'dialing' || Ph.state === 'ringing') { lamp = 'RINGER'; cls = 'ringer'; }
    else if (V.ptt) { lamp = 'LYSSNAR'; cls = 'lyssnar'; }
    else if (V.speaking || Ph.state === 'announcing') { lamp = 'HAR ORDET'; cls = 'ordet'; }
    else if (V.state === 'opening') { lamp = 'KOPPLAR'; cls = 'ringer'; }
    ui.lampa.textContent = lamp; ui.lampa.className = 'bank-lampa' + (cls ? ' ' + cls : '');
    const showPhone = phoneConfigured() && Ph.contacts.length > 0;
    ui.telefon.hidden = !showPhone;
    ui.telefon.querySelectorAll('button').forEach((b) => b.classList.toggle('vald', b.dataset.mode === Ph.mode));
    const inCall = Ph.state === 'dialing' || Ph.state === 'ringing' || Ph.state === 'live';
    ui.ring.hidden = !(showPhone && Ph.mode !== 'av') || Ph.state !== 'idle';
    ui.laggPa.hidden = !(inCall || Ph.state === 'announcing');
    ui.laggPa.textContent = Ph.state === 'announcing' ? 'Ring inte' : 'Lägg på';
    ui.tack.hidden = inCall || Ph.state === 'announcing';
    ui.ptt.textContent = Ph.state === 'live' ? (Ph.ptt ? 'Du pratar i luren' : 'Håll för att prata i luren') : (V.ptt ? 'Släpp när du pratat klart' : 'Håll för att prata');
    ui.ptt.classList.toggle('nere', V.ptt || Ph.ptt);
    ui.ptt.disabled = !(Ph.state === 'idle' || Ph.state === 'live');
    if (bank.started) ui.klocka.textContent = mmss(secs());
    renderLog();
  }

  function renderLog() {
    if (!ui.logg) return;
    ui.logg.hidden = !bank.logOpen;
    if (!bank.logOpen) return;
    const last = bank.log.slice(-6);
    ui.logg.innerHTML = last.length ? last.map((e) => '<div>' + esc(logLine(e)) + '</div>').join('') : '<div>(inget ännu)</div>';
  }

  function setPhoneMode(mode) {
    if (mode !== 'av' && mode !== 'fraga') return;
    bank.phone.mode = mode;
    saveSession();
    // Rösten får telefonen i sin systeminstruktion när den kopplas upp. Ny session vid nästa tilltal.
    if (bank.voice.state === 'open' && !bank.voice.speaking && !bank.voice.ptt) closeVoice(false);
    render();
  }

  /* ---------------- VU-mätaren ---------------- */
  const vu = { pos: 0, vel: 0, fas: Math.random() * 100, puls: 0, nasta: 0, forra: 0, nal: null, ljus: null };
  function buildVu(svg) {
    const cx = 200, cy = 196, MIN = -50, MAX = 50;
    const pt = (v, r) => { const a = (MIN + v * (MAX - MIN)) * Math.PI / 180; return [cx + r * Math.sin(a), cy - r * Math.cos(a)]; };
    const arc = (v1, v2, r) => { const a = pt(v1, r), b = pt(v2, r); return 'M' + a[0].toFixed(1) + ' ' + a[1].toFixed(1) + ' A' + r + ' ' + r + ' 0 0 1 ' + b[0].toFixed(1) + ' ' + b[1].toFixed(1); };
    let ticks = '', siffror = '';
    const skala = ['-20', '-10', '-7', '-5', '-3', '0', '+3'];
    for (let i = 0; i <= 30; i++) {
      const v = i / 30, stor = i % 5 === 0, a = pt(v, 150), b = pt(v, stor ? 132 : 140);
      ticks += '<line x1="' + a[0].toFixed(1) + '" y1="' + a[1].toFixed(1) + '" x2="' + b[0].toFixed(1) + '" y2="' + b[1].toFixed(1) + '" stroke="' + (v > .8 ? '#e0001c' : '#10282c') + '" stroke-width="' + (stor ? 2.4 : 1.3) + '"/>';
      if (stor) { const t = pt(v, 118); siffror += '<text x="' + t[0].toFixed(1) + '" y="' + (t[1] + 5).toFixed(1) + '" text-anchor="middle" font-family="Jost,system-ui,sans-serif" font-size="13" font-weight="500" fill="' + (v > .8 ? '#e0001c' : '#10282c') + '">' + skala[i / 5] + '</text>'; }
    }
    svg.innerHTML = '<defs><radialGradient id="bankVuYta" cx="200" cy="210" r="260" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#f2fbf9"/><stop offset=".45" stop-color="#cfece6"/><stop offset=".8" stop-color="#8fc3bd"/><stop offset="1" stop-color="#3f6f6c"/></radialGradient></defs>' +
      '<rect width="400" height="210" fill="#0c1a1c"/><rect id="bankVuLjus" width="400" height="210" fill="url(#bankVuYta)" opacity=".4"/>' +
      '<path d="' + arc(0, .8, 150) + '" fill="none" stroke="#10282c" stroke-width="3"/><path d="' + arc(.8, 1, 150) + '" fill="none" stroke="#e0001c" stroke-width="9"/>' +
      ticks + siffror + '<text x="200" y="150" text-anchor="middle" font-family="Jost,system-ui,sans-serif" font-size="22" font-weight="600" letter-spacing="3" fill="#10282c">VU</text>' +
      '<g id="bankVuNal"><line x1="200" y1="196" x2="200" y2="40" stroke="#06100f" stroke-width="2.2" stroke-linecap="round"/></g>' +
      '<rect x="160" y="182" width="80" height="28" rx="4" fill="#0c1a1c"/><circle cx="200" cy="196" r="9" fill="#06100f"/>';
    vu.nal = svg.querySelector('#bankVuNal'); vu.ljus = svg.querySelector('#bankVuLjus');
    vu.MIN = MIN; vu.MAX = MAX;
  }

  function vuLoop(ts) {
    requestAnimationFrame(vuLoop);
    if (activeId !== 'bankgrannen' || !vu.nal) return;
    const t = ts / 1000, dt = Math.min(0.05, vu.forra ? t - vu.forra : 0.016); vu.forra = t;
    const A = bank.audio; const Ph = bank.phone; const V = bank.voice;
    let ut = 0;
    if (A.outCtx) { const nu = A.outCtx.currentTime; A.queue = A.queue.filter((q) => q.end > nu); const q = A.queue.find((x) => x.start <= nu); if (q) ut = q.rms; }
    const aktiv = V.ptt || V.speaking || Ph.state === 'live';
    let mal;
    if (aktiv) mal = Math.min(1.05, Math.max(V.ptt || Ph.ptt ? A.micLvl : 0, ut, Ph.state === 'live' ? Ph.remoteLvl : 0) * 1.1);
    else if (V.state === 'opening' || Ph.state === 'dialing' || Ph.state === 'ringing') mal = 0.45 + 0.35 * Math.sin(t * 3);
    else {
      if (t > vu.nasta) { vu.puls = Math.random() * 0.08; vu.nasta = t + 0.4 + Math.random() * 1.4; }
      vu.puls *= 0.94;
      mal = 0.1 + 0.03 * Math.sin(t * 1.3 + vu.fas) + 0.02 * Math.sin(t * 3.7) + vu.puls;
    }
    if (typeof stilla !== 'undefined' && stilla) vu.pos = mal;
    else { const acc = 55 * (mal - vu.pos) - 10 * vu.vel; vu.vel += acc * dt; vu.pos += vu.vel * dt; }
    const v = Math.max(-0.04, Math.min(1.06, vu.pos));
    vu.nal.setAttribute('transform', 'rotate(' + (vu.MIN + v * (vu.MAX - vu.MIN)).toFixed(2) + ' 200 196)');
    vu.ljus.setAttribute('opacity', aktiv ? (0.85 + 0.15 * Math.min(1, vu.pos)).toFixed(3) : '0.4');
  }

  /* ---------------- Rutor ---------------- */
  function openModal(html, handlers) {
    closeModal();
    const m = document.createElement('div');
    m.className = 'bank-modal';
    m.innerHTML = '<div class="bank-ark" role="dialog" aria-modal="true">' + html + '</div>';
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m && handlers.cancel) handlers.cancel(); });
    bank.modal = { el: m, confirm: handlers.confirm, cancel: handlers.cancel };
    const first = m.querySelector('[autofocus]') || m.querySelector('button.primar') || m.querySelector('button');
    if (first) setTimeout(() => first.focus(), 30);
    return m;
  }
  function closeModal() {
    if (!bank.modal) return;
    bank.modal.el.remove(); bank.modal = null;
    if (bank.started) armIdleClose();
  }

  // Panelen Seminariet
  function openPanel() {
    const s = bank.seminar;
    const roleOpts = Object.entries(ROLES).map(([k, r]) => '<option value="' + k + '"' + (s.role === k ? ' selected' : '') + '>' + esc(r.label) + '</option>').join('');
    const voiceOpts = ['<option value="">Rollens förval (' + esc(roleObj().voice) + ')</option>']
      .concat(VOICES.map((v) => '<option' + (s.voice === v ? ' selected' : '') + '>' + v + '</option>')).join('');
    const m = openModal(`
      <h2>Seminariet</h2>
      <label for="bpTitel">Titel</label><input id="bpTitel" type="text" value="${esc(s.title)}" autofocus>
      <label for="bpMal">Målgrupp</label><input id="bpMal" type="text" value="${esc(s.audience)}" placeholder="till exempel TV4:s programavdelning">
      <label for="bpTalare">Föreläsare</label><input id="bpTalare" type="text" value="${esc(s.speaker)}">
      <h3>Roll</h3>
      <select id="bpRoll">${roleOpts}</select>
      <p class="liten" id="bpRollHint">${esc(roleObj().hint)}</p>
      <label for="bpRost">Röst</label><select id="bpRost">${voiceOpts}</select>
      <h3>Omfång</h3>
      <div class="val">
        <label><input type="radio" name="bpScope" checked> Bara på tilltal</label>
        <label class="av"><input type="radio" name="bpScope" disabled> Lyssnar på hela seminariet (kommer i den fulla versionen)</label>
      </div>
      <h3>Underlag</h3>
      <p class="liten">Kunskapsbasen och annat underlag hon ska ha läst. Filer (.md, .txt, .pdf) eller inklistrad text. <b>Lägg aldrig in material som kan röja en källa.</b></p>
      <input id="bpFiler" type="file" accept=".md,.txt,.pdf,text/markdown,text/plain,application/pdf" multiple>
      <label for="bpText">Klistra in text</label><textarea id="bpText">${esc(s.pasted)}</textarea>
      <p id="bpUnderlag" class="liten"></p>
      <div class="knappar" style="justify-content:flex-start;margin-top:8px">
        <button class="bank-btn" type="button" id="bpForbered">Förbered underlaget</button>
        <button class="bank-btn" type="button" id="bpRensa">Rensa underlag</button>
      </div>
      <h3>Telefon</h3>
      <p class="liten">Telefontjänsten är funktionerna hos Twilio (se twilio/README.md). Numren finns bara där. Bara personer som sagt ja i förväg. <b>Lägg aldrig in källor, uppgiftslämnare eller personer i pågående granskningar.</b></p>
      <label for="bpTelUrl">Telefontjänstens adress</label><input id="bpTelUrl" type="url" value="${esc(telUrl())}" placeholder="https://…twil.io">
      <label for="bpTelKey">Telefonnyckel</label><input id="bpTelKey" type="password" value="${esc(telKey())}" autocomplete="off">
      <div class="knappar" style="justify-content:flex-start;margin-top:8px">
        <button class="bank-btn" type="button" id="bpTelTest">Testa och hämta listan</button>
        <span id="bpTelSvar" class="liten" style="align-self:center"></span>
      </div>
      <h3>Gemini</h3>
      <div class="knappar" style="justify-content:flex-start;margin-top:0">
        <button class="bank-btn" type="button" id="bpNyckel">Gemini-nyckel</button>
        <span class="liten" style="align-self:center">${getKey() ? 'Nyckel finns' : 'Nyckel saknas'}</span>
      </div>
      <h3>Kostnad hittills, ungefär</h3>
      <p class="kostnad" id="bpKostnad"></p>
      <div class="knappar">
        <button class="bank-btn" type="button" id="bpStang">Stäng</button>
        <button class="bank-btn primar" type="button" id="bpSpara">Spara</button>
      </div>`, { confirm: () => savePanel(), cancel: () => closeModal() });
    const upd = () => {
      const t = estTokens(bank.seminar.sourceText);
      const el = $('#bpUnderlag', m);
      el.className = 'liten' + (t > TOKEN_WARN ? ' varning' : '');
      el.textContent = bank.seminar.sourceText
        ? 'Förberett: ' + (bank.seminar.sourceFiles.join(', ') || 'inklistrad text') + ', cirka ' + t.toLocaleString('sv-SE') + ' tokens.' + (t > TOKEN_WARN ? ' Det är mycket: varje gång hon kopplas upp skickas hela underlaget.' : '')
        : 'Inget underlag förberett ännu.';
      const U = bank.usage;
      $('#bpKostnad', m).textContent = 'Röst i rummet ' + U.voice.toLocaleString('sv-SE') + ' tokens · telefonsamtal ' + U.call.toLocaleString('sv-SE') + ' tokens, ' + Math.round(U.callMs / 60000) + ' min · PDF ' + U.text.toLocaleString('sv-SE') + ' tokens';
    };
    upd();
    $('#bpRoll', m).addEventListener('change', (e) => { $('#bpRollHint', m).textContent = (ROLES[e.target.value] || ROLES.skeptikern).hint; });
    $('#bpForbered', m).addEventListener('click', async (e) => {
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Förbereder …';
      try { await prepareSource($('#bpFiler', m).files, $('#bpText', m).value); upd(); }
      catch (err) { const el = $('#bpUnderlag', m); el.className = 'liten fel'; el.textContent = String(err.message || err); }
      finally { btn.disabled = false; btn.textContent = 'Förbered underlaget'; }
    });
    $('#bpRensa', m).addEventListener('click', async () => { Object.assign(bank.seminar, { sourceText: '', sourceFiles: [], pasted: '' }); $('#bpText', m).value = ''; await saveSeminar(); upd(); render(); });
    $('#bpTelTest', m).addEventListener('click', async () => {
      const out = $('#bpTelSvar', m);
      storeTel($('#bpTelUrl', m).value, $('#bpTelKey', m).value);
      out.className = 'liten'; out.textContent = 'Testar …';
      try { const n = await loadContacts(); out.textContent = n + ' personer på listan.'; }
      catch (err) { out.className = 'liten fel'; out.textContent = 'Fungerade inte: ' + String(err.message || err); }
    });
    $('#bpNyckel', m).addEventListener('click', () => { savePanel(true); openKeySheet(); });
    $('#bpStang', m).addEventListener('click', closeModal);
    $('#bpSpara', m).addEventListener('click', () => savePanel());
  }

  function storeTel(url, key) {
    try {
      localStorage.setItem(LS_TEL_URL, (url || '').trim());
      localStorage.setItem(LS_TEL_KEY, (key || '').trim());
    } catch (e) { /* inget */ }
  }

  async function savePanel(keepOpen) {
    const m = bank.modal && bank.modal.el; if (!m) return;
    const s = bank.seminar;
    s.title = $('#bpTitel', m).value.trim();
    s.audience = $('#bpMal', m).value.trim();
    s.speaker = $('#bpTalare', m).value.trim() || 'Lelle';
    s.role = $('#bpRoll', m).value;
    s.voice = $('#bpRost', m).value;
    s.pasted = $('#bpText', m).value;
    storeTel($('#bpTelUrl', m).value, $('#bpTelKey', m).value);
    await saveSeminar();
    if (!keepOpen) closeModal(); else closeModal();
    if (bank.started && phoneConfigured() && !bank.phone.contacts.length) loadContacts().catch(() => {});
    render();
  }

  async function prepareSource(fileList, pasted) {
    const files = Array.from(fileList || []);
    const parts = []; const names = [];
    for (const f of files) {
      const lower = f.name.toLowerCase();
      let text;
      if (lower.endsWith('.pdf') || f.type === 'application/pdf') text = await pdfToText(f);
      else text = await f.text();
      parts.push('### Fil: ' + f.name + '\n\n' + text.trim());
      names.push(f.name);
    }
    if (pasted && pasted.trim()) { parts.push('### Inklistrat\n\n' + pasted.trim()); }
    if (!parts.length) throw new Error('Välj en fil eller klistra in text först.');
    const all = parts.join('\n\n');
    const t = estTokens(all);
    if (t > TOKEN_STOP) throw new Error('Underlaget är cirka ' + t.toLocaleString('sv-SE') + ' tokens. Kortare än ' + TOKEN_STOP.toLocaleString('sv-SE') + ' krävs, eftersom hela underlaget skickas varje gång hon kopplas upp.');
    Object.assign(bank.seminar, { sourceText: all, sourceFiles: names, pasted: pasted || '' });
    await saveSeminar();
    render();
  }

  async function pdfToText(file) {
    if (file.size > PDF_MAX_BYTES) throw new Error(file.name + ' är större än 19 MB.');
    const key = getKey(); if (!key) throw new Error('En Gemini-nyckel behövs för att läsa PDF.');
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + TEXT_MODEL + ':generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: P.PDF_PROMPT }, { inlineData: { mimeType: 'application/pdf', data: btoa(bin) } }] }],
        generationConfig: { temperature: 0 },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('PDF:en kunde inte läsas: ' + ((data.error && data.error.message) || res.status));
    if (data.usageMetadata && data.usageMetadata.totalTokenCount) bank.usage.text += data.usageMetadata.totalTokenCount;
    const text = (((data.candidates || [])[0] || {}).content || {}).parts || [];
    const out = text.map((p) => p.text || '').join('').trim();
    if (!out) throw new Error('PDF:en gav ingen text: ' + file.name);
    return out;
  }

  // Startrutan
  function openStart() {
    if (!getKey()) { openKeySheet(); return; }
    let manus = roleObj().startmanus;
    if (phoneConfigured()) {
      const paras = manus.split('\n\n');
      paras.splice(Math.max(1, paras.length - 1), 0, P.STARTMANUS_TELEFON);
      manus = paras.join('\n\n');
    }
    manus = fill(manus, { NAMN: PERSONA_NAME, FORELASARE: speaker() });
    openModal(`
      <h2>Innan ni börjar</h2>
      <p class="liten">Säg det här till rummet, med egna ord.</p>
      <div class="manus">${esc(manus)}</div>
      ${bank.seminar.sourceText ? '' : '<p class="varning" style="margin-top:12px">Inget underlag är förberett. Hon har då bara sin roll att gå på.</p>'}
      <p id="bsFel" class="fel"></p>
      <div class="knappar">
        <button class="bank-btn" type="button" id="bsAvbryt">Avbryt</button>
        <button class="bank-btn primar" type="button" id="bsKor">Nu kör vi</button>
      </div>`, { confirm: () => startSeminar(), cancel: () => closeModal() });
    $('#bsAvbryt').addEventListener('click', closeModal);
    $('#bsKor').addEventListener('click', () => startSeminar());
  }

  async function startSeminar(resume) {
    try { await ensureAudio(); }
    catch (e) { const el = $('#bsFel'); if (el) el.textContent = 'Mikrofonen nekades. Tillåt mikrofon i webbläsaren och försök igen.'; return; }
    closeModal();
    bank.started = true;
    if (resume) {
      bank.t0 = resume.t0 || Date.now(); bank.log = resume.log || []; bank.firstSpoken = !!resume.firstSpoken;
      bank.called = resume.called || []; bank.phone.mode = resume.phoneMode || 'fraga';
      if (resume.usage) Object.assign(bank.usage, resume.usage);
    } else {
      bank.t0 = Date.now(); bank.log = []; bank.firstSpoken = false; bank.called = [];
      bank.phone.mode = 'fraga';
      bank.usage = { voice: 0, call: 0, text: bank.usage.text, callMs: 0 };
    }
    saveSession();
    status('Redo', 'Håll i knappen, eller mellanslag, och prata med ' + PERSONA_NAME);
    render();
    if (phoneConfigured()) {
      loadContacts().then((n) => { if (n) ensureTwilio().catch((e) => status('Telefonen är inte redo', String(e.message || e), 'warn')); })
        .catch((e) => status('Telefonlistan kunde inte hämtas', String(e.message || e), 'warn'));
    }
  }

  // Ring
  function openRingDialog() {
    if (!bank.started || bank.phone.state !== 'idle' || bank.phone.mode === 'av' || !phoneConfigured()) return;
    const list = bank.phone.contacts;
    if (!list.length) { status('Telefonlistan är tom', 'Kontrollera telefontjänsten i Seminariet', 'warn'); return; }
    const opts = list.map((c) => '<option value="' + esc(c.id) + '">' + esc(c.namn) + (c.roll ? ', ' + esc(c.roll) : '') + (bank.called.includes(c.id) ? ' (redan ringd)' : '') + '</option>').join('');
    const m = openModal(`
      <h2>Ring</h2>
      <p class="liten">${esc(PERSONA_NAME)} säger först till rummet vem hon ringer och varför. Hon kan bara ringa personer på listan, som har sagt ja i förväg.</p>
      <label for="brVem">Vem</label><select id="brVem">${opts}</select>
      <label for="brArende">Ärende</label><input id="brArende" type="text" autofocus>
      <div class="knappar">
        <button class="bank-btn" type="button" id="brAvbryt">Avbryt</button>
        <button class="bank-btn primar" type="button" id="brRing">Ring (Enter)</button>
      </div>`, {
      confirm: () => {
        const c = list.find((x) => x.id === $('#brVem', m).value);
        const arende = $('#brArende', m).value.trim() || (c && c.arende) || '';
        closeModal();
        if (c) startCallFlow({ contact: c, arende, initiativ: 'lelle' });
      },
      cancel: () => closeModal(),
    });
    const fillArende = () => { const c = list.find((x) => x.id === $('#brVem', m).value); $('#brArende', m).value = (c && c.arende) || ''; };
    $('#brVem', m).addEventListener('change', fillArende); fillArende();
    $('#brAvbryt', m).addEventListener('click', () => bank.modal.cancel());
    $('#brRing', m).addEventListener('click', () => bank.modal.confirm());
  }

  // Samtalskortet när hon själv vill ringa
  function showCallCard(o) {
    const fc = o.fc;
    clearTimeout(bank.voice.timers.idle);   // rösten ska vara kvar när Lelle svarar
    openModal(`
      <h2>${esc(PERSONA_NAME)} vill ringa</h2>
      <p style="font-size:20px"><b>${esc(o.contact.namn)}</b>${o.contact.roll ? ', ' + esc(o.contact.roll) : ''}</p>
      <p>Om: ${esc(o.arende)}</p>
      <div class="knappar">
        <button class="bank-btn" type="button" id="bkNej">Inte nu (Esc)</button>
        <button class="bank-btn primar" type="button" id="bkJa">Ring (Enter)</button>
      </div>`, {
      confirm: () => { closeModal(); startCallFlow({ contact: o.contact, arende: o.arende, initiativ: 'birgitta', grund: o.grund, fc }); },
      cancel: () => { closeModal(); respondTool(bank.voice.ws, fc, { status: 'nej', scheduling: 'WHEN_IDLE' }); },
    });
    $('#bkNej').addEventListener('click', () => bank.modal.cancel());
    $('#bkJa').addEventListener('click', () => bank.modal.confirm());
  }

  // Avsluta
  function openEnd() {
    openModal(`
      <h2>Avsluta seminariet</h2>
      <p>Allt som har sagts till och av ${esc(PERSONA_NAME)} raderas, liksom samtalen. Underlaget finns kvar.</p>
      <div class="val"><label><input type="checkbox" id="beExport" checked> Exportera samtalen som fil (.md) först</label></div>
      <div class="knappar">
        <button class="bank-btn" type="button" id="beAvbryt">Avbryt</button>
        <button class="bank-btn fara" type="button" id="beRadera">Radera allt och avsluta</button>
      </div>`, { confirm: () => endSeminar($('#beExport').checked), cancel: () => closeModal() });
    $('#beAvbryt').addEventListener('click', closeModal);
    $('#beRadera').addEventListener('click', () => endSeminar($('#beExport').checked));
  }

  function exportLog() {
    const s = bank.seminar;
    const md = ['# ' + (s.title || 'Seminarium med ' + PERSONA_NAME), '',
      new Date().toLocaleString('sv-SE') + ' · roll: ' + roleObj().label + ' · ' + bank.log.length + ' rader', '',
      '## Samtalen', '', ...bank.log.map(logLine)].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }));
    a.download = 'bankgrannen-' + new Date().toISOString().slice(0, 10) + '.md';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function endSeminar(doExport) {
    if (doExport && bank.log.length) exportLog();
    closeModal();
    if (bank.phone.state !== 'idle') { bank.phone.outcomeHint = 'avbrutet'; hangUp('avbrutet'); }
    closeVoice(true);
    closeAudio();
    bank.started = false; bank.log = []; bank.firstSpoken = false; bank.called = []; bank.t0 = 0;
    clearSession();
    status('', '');
    render();
  }

  function offerResume(saved) {
    openModal(`
      <h2>Fortsätta seminariet?</h2>
      <p>Sidan laddades om mitt i. Det finns ${saved.log.length} rader från samtalen med ${esc(PERSONA_NAME)}.</p>
      <p id="bsFel" class="fel"></p>
      <div class="knappar">
        <button class="bank-btn fara" type="button" id="bfNej">Börja om</button>
        <button class="bank-btn primar" type="button" id="bfJa">Fortsätt</button>
      </div>`, { confirm: () => startSeminar(saved), cancel: () => { clearSession(); closeModal(); } });
    $('#bfNej').addEventListener('click', () => { clearSession(); closeModal(); });
    $('#bfJa').addEventListener('click', () => startSeminar(saved));
  }

  /* ---------------- Tangenter ---------------- */
  function typing(e) { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }

  function onKeyDown(e) {
    if (activeId !== 'bankgrannen') return;
    if (els.overlay && els.overlay.classList.contains('open')) { if (e.key === 'Escape') { closeSettings(); render(); } return; }
    if (bank.modal) {
      if (e.key === 'Escape') { e.preventDefault(); bank.modal.cancel && bank.modal.cancel(); return; }
      if (e.key === 'Enter' && !(e.target && e.target.tagName === 'TEXTAREA') && !(e.target && e.target.tagName === 'BUTTON')) { e.preventDefault(); bank.modal.confirm && bank.modal.confirm(); }
      return;
    }
    if (typing(e)) return;
    if (!bank.started) return;
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) pttDown(); return; }
    if (e.repeat) return;
    if (e.shiftKey && e.code === 'Digit1') { e.preventDefault(); setPhoneMode('av'); return; }
    if (e.shiftKey && e.code === 'Digit2') { e.preventDefault(); setPhoneMode('fraga'); return; }
    switch (e.key) {
      case 'Enter': e.preventDefault(); giveFloor(T.ordet()); break;
      case 's': case 'S': e.preventDefault(); giveFloor(T.sammanfatta()); break;
      case 'r': case 'R': e.preventDefault(); openRingDialog(); break;
      case 't': case 'T': e.preventDefault(); bank.logOpen = !bank.logOpen; renderLog(); break;
      case 'Escape': e.preventDefault(); escAction(); break;
      default: break;
    }
  }

  function onKeyUp(e) {
    if (activeId !== 'bankgrannen') return;
    if (e.code === 'Space' && !bank.modal && !typing(e)) { e.preventDefault(); pttUp(); }
  }

  /* ---------------- Krokar från index.html ---------------- */
  window.bankOpenSettings = function () { if (!bank.mounted) mount(); openPanel(); };

  window.onSectionOpen = async function (id) {
    if (id !== 'bankgrannen') return;
    mount();
    await loadSeminar();
    render();
    const saved = readSession();
    if (!bank.started && saved && saved.log) offerResume(saved);
  };

  window.onLeaveSection = function () {
    if (activeId === 'bankgrannen' && bank.started) { openEnd(); return false; }
    return true;
  };

  window.addEventListener('beforeunload', () => {
    try { bank.voice.ws && bank.voice.ws.close(1000); } catch (e) { /* inget */ }
    try { bank.phone.call && bank.phone.call.disconnect(); } catch (e) { /* inget */ }
  });

  // Direktlänk (#bankgrannen): huvudskriptet har redan öppnat sektionen.
  if (typeof activeId !== 'undefined' && activeId === 'bankgrannen') window.onSectionOpen('bankgrannen');

  // För testning i konsolen
  window.__bank = bank;
})();
