# Bänkgrannen: nytt läge i AI-snack

Byggspec för Claude Code · version 2 · 30 september 2026
Arbetsnamn: **Bänkgrannen**. Direktlänk: `#bankgrannen`. Promptarna ligger i [`PROMPTER.md`](./PROMPTER.md).

---

## Startprompt (klistra in i Claude Code)

> Läs `specs/bankgrannen/SPEC.md` och `specs/bankgrannen/PROMPTER.md`, sedan `index.html` och `README.md`.
> Börja med steg 0 (labbet) i avsnitt 15 och redovisa resultaten i `specs/bankgrannen/LABB.md` innan du bygger något i appen.
> Bygg sedan läget i den ordning som står i avsnitt 15. Efter varje steg: stanna, beskriv exakt vad jag ska testa
> i webbläsaren och vänta på mitt klartecken innan du går vidare. De befintliga samtalen (AI-snack, Efter fem,
> von Essen) får inte ändra beteende. Kontrollera fältnamnen för Live API och generateContent mot Googles aktuella
> dokumentation innan du skriver anropen. Inga långa tankstreck i texter som syns i gränssnittet.

---

## 1. Vad det är

Bänkgrannen sitter med som deltagare när Lelle håller föredrag eller workshop. Den lyssnar på hela seminariet i
realtid och har läst underlaget i förväg. Den kan räcka upp handen, sammanfatta, ta upp det ni har missat, svara
när någon frågar den och, om Lelle vrider upp ratten, bryta in själv.

**Karaktären.** Läget heter Bänkgrannen. Den som pratar är en karaktär med eget namn, konstanten `PERSONA_NAME`
(arbetsnamn **Birgitta**). Hon är en äldre och ganska cynisk skeptiker som kan nyhetsproduktion och tv-företag på djupet
och som också kan AI-branschen och hur verktygen fungerar. Hon sitter på publikens sida: hon översätter det Lelle säger
till vardag för dem som kan lite om AI och ger Lelle motstånd här och där, alltid för rummets skull. Det får aldrig bli
ett internt samtal mellan två som redan kan. Hon säger alltid att hon är en AI som spelar en roll, och hon hittar aldrig
på egna minnen eller händelser. Hela personan finns i PROMPTER.md, avsnitt 1.

I gränssnittet används `PERSONA_NAME` där karaktären agerar ("Tack, Birgitta", "Birgitta harklar sig …").
Lägets namn, Bänkgrannen, används för själva läget.

## 2. Bärande beslut

1. **Människan bestämmer hur mycket AI:n får ta för sig.** En ratt med tre lägen, *Tyst*, *Handen* och *Fritt*, styr om
   hon bara pratar när hon får ordet, räcker upp handen eller får bryta in själv. Även i *Fritt* har Lelle veto (avsnitt 9).
2. **Hon hör i realtid.** Rummet blir text löpande via Googles strömmande transkriberingsmodell. Det tar 1 till 2 sekunder.
   En snabbkoll var tionde sekund avgör om hon har något att säga.
3. **Två sätt att ge henne röst, byggda i lager.** *Per ordet* (en ny röstsession varje gång hon får ordet) är grunden.
   *Bänken* (hon sitter i en öppen röstsession hela seminariet och får allt som sägs som text) byggs ovanpå. Om Bänken
   fallerar under ett seminarium faller appen automatiskt tillbaka till Per ordet.
4. **En leverantör, en nyckel.** Allt går via Gemini API med nyckeln som redan ligger i webbläsaren (`localStorage`,
   samma mönster som i dag). Ingen egen server behövs. Telefonen använder dessutom Twilio och tre små funktioner som
   Twilio kör (avsnitt 17).
5. **Inget ljud sparas.** Ljud strömmas till Google, blir text och sparas aldrig. Text lever bara under seminariet.
6. **Grundat i det som sagts.** Allt som hon säger att någon har sagt ska finnas i transkriberingen. Underlaget är något
   hon har läst, inte något som har sagts i rummet.
7. **Källskydd är inbyggt, inte påklistrat.** Det finns en synlig lampa, paus och glöm, filter i minnet och regler i personan (avsnitt 13).
8. **Hon kan ringa, men bara den som sagt ja i förväg.** Telefonen är ett lager ovanpå resten. Birgitta ringer från datorn
   i rummet, så att båda parter hörs i högtalarna. Hon kan bara ringa nummer på en lista som ligger hos Twilio, och när hon
   själv vill ringa frågar hon Lelle först. Inget samtal går iväg utan att Lelle har godkänt det eller kunnat stoppa det (avsnitt 17).

## 3. Arkitektur

```
 Mikrofon (16 kHz PCM, befintlig AudioWorklet)
   │
   ├─► ÖRONEN: gemini-3.5-transcribe-live (ström, byts var 9:e minut i en paus)
   │       │  löpande text (grå) och färdig text vid varje paus → transkriptet [mm:ss]
   │       │
   │       ├─► SNABBKOLLEN: gemini-3.6-flash, högst var 10:e sekund → handen / bryta in
   │       └─► MINNET:      gemini-3.6-flash, varannan minut      → anteckningar
   │
   │   RATTEN (Tyst / Handen / Fritt) + spärrar + Lelles veto
   │       │
   └─► RÖSTEN: gemini-3.8-live
         A. Per ordet: ny session varje gång (persona + underlag + minne + senaste minuterna)
         B. Bänken:    en session hela seminariet, får transkriptet och minnet som text,
                       tar aldrig ordet själv, pratar direkt när den får en trigger
```

- **Öronen** gör rummet till text medan det sägs.
- **Snabbkollen** läser de senaste minuterna och bestämmer om handen ska upp och, i *Fritt*, om hon ska bryta in.
- **Minnet** läser hela transkriptet och håller anteckningarna: ämnen, publikens frågor, oklarheter och det som inte tagits upp.
- **Ratten** och klientens spärrar avgör vad som faktiskt händer. Modellerna föreslår, klienten bestämmer.
- **Rösten** pratar i rummet, antingen via en ny session (A) eller från Bänken (B).
- **Telefonen** (avsnitt 17) är ett lager ovanpå: en egen röstsession för samtalet, kopplad till en telefonlinje som
  webbläsaren öppnar via Twilio.

## 4. Modeller och anrop

| Del | Modell (konstant) | Anrop |
|---|---|---|
| Öronen | `gemini-3.5-transcribe-live` (`TRANSCRIBE_MODEL`) | WebSocket Live API, text ut |
| Snabbkollen, minnet, förberedelse av underlag | `gemini-3.6-flash` (`TEXT_MODEL`) | REST `generateContent`, strukturerad JSON |
| Rösten | `gemini-3.8-live` (befintliga `MODEL_NAME`) | WebSocket Live API, ljud ut |
| Telefonen | `gemini-3.8-live` för samtalet, Twilio Voice JavaScript SDK och Twilio Functions för linjen | se avsnitt 17 |

- WebSocket-adressen är densamma som i dag (`wsUrl()`).
- REST-anrop: `POST https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent` med nyckeln i
  headern `x-goog-api-key`, inte i URL:en. Strukturerad utdata: `generationConfig.responseMimeType = 'application/json'` plus
  schema. Kontrollera om modellen vill ha `responseSchema` eller `responseJsonSchema`. Snabbkollen och förberedelsen körs
  med minsta möjliga tänkande. Minnet körs med standardinställning.
- Live-setup för rösten (fältnamn enligt Live API-referensen): `model`, `generationConfig`, `systemInstruction`,
  `realtimeInputConfig.automaticActivityDetection.disabled`, `inputAudioTranscription: {}`, `outputAudioTranscription: {}`,
  `sessionResumption`, `contextWindowCompression`. Serversvar: `serverContent.modelTurn`, `.turnComplete`, `.interrupted`,
  `.inputTranscription.text`, `.outputTranscription.text`, `sessionResumptionUpdate`, `usageMetadata`, `goAway`, `error`.
- Gemini 3.8 Live tar emot `clientContent` under hela sessionen och stöder inte proaktivt ljud. Det är därför Bänken
  fungerar: hon tar aldrig ordet själv, och texten från rummet kan skickas in löpande.
- **Nyckeln i webbläsaren:** Google rekommenderar tillfälliga tokens från en server för Live API i webbläsare. Version 1
  behåller dagens mönster (nyckeln i `localStorage` på Lelles egen dator) med de skydd som README redan beskriver.

## 5. Integration i den befintliga appen

**Filstruktur.** Nästan hela läget ligger i en ny fil, `bankgrannen.js`, som laddas med en vanlig
`<script src="bankgrannen.js"></script>` efter huvudskriptet. Ingen modul och ingen build. I `index.html` läggs bara
markup, CSS, en post i `SECTIONS` och några små krokar. Promptarna ligger som konstanter i `bankgrannen.js` och
hålls i synk med PROMPTER.md. Ljudfilen `harkling.mp3` ligger bredvid (avsnitt 9). Telefonen lägger till
`vendor/twilio.min.js` och mappen `twilio/` med funktionerna som körs hos Twilio (avsnitt 17).

**Nya identifierare skrivs på engelska.** Befintliga svenska namn (`snacka`, `byggVu`, `stilla` …) lämnas som de är.

**Krokar i `index.html`:**

1. `SECTIONS.bankgrannen = { title:'BÄNKGRANNEN', tagline:'En AI på seminariet', voice:'Gacrux', systemInstruction:null, idleLine:'Redo', idleSub:'Förbered seminariet och börja lyssna', greeting:null, badge:'Här lyssnar en AI · ljudet blir text hos Google · inget ljud sparas' }`.
   Rösten provas fram (avsnitt 19). I `bankgrannen.js` finns konstanten `PERSONA_NAME = 'Birgitta'`.
2. En knapp `<button type="button" data-goto="bankgrannen">Bänkgrannen</button>` i `.andra`.
3. Ett nytt vy-block `<div class="bank">` i `#viewCall`, synligt bara för `body.sect-bankgrannen`
   (samma mönster som `.snacka`/`sect-drom`). Dölj `.callhead`, `.caller` och `.hint` i läget.
4. **Mikrofonkrok.** I `startMic()`, i `workletNode.port.onmessage`, lägg till
   `if (typeof micHook === 'function') micHook(new Int16Array(e.data.buf), e.data.rms);` efter den befintliga logiken.
   `let micHook = null;` deklareras globalt. Befintliga sektioner sätter den aldrig och påverkas inte.
5. **VU-mätaren.** Gör `byggVu` återanvändbar (den tar ett svg-element och returnerar nål och ljus) och låt `vuLoop`
   driva den synliga mätaren. I bankläget följer nålen `max(rumsnivå, röstnivå)`.
6. **Tangentbord.** Lägg `if (activeId === 'bankgrannen') return;` först i den befintliga `keydown`-hanteraren,
   så att bankens egna `keydown`/`keyup`-hanterare (avsnitt 12) tar över.
7. **Lämna läget.** `goHome()` och tillbaka-knappen stoppar ett pågående seminarium bara efter att Lelle
   bekräftat det ("Avsluta seminariet?"). `beforeunload` sparar sessionen (avsnitt 13.5) och stänger ljudet.
8. **Init-ordning.** Huvudskriptet kör `goHome()` och hash-routingen sist, alltså innan `bankgrannen.js` har laddats.
   Lägg till en krok `if (typeof onSectionOpen === 'function') onSectionOpen(id);` sist i `openSection()`.
   `bankgrannen.js` definierar `onSectionOpen` och kontrollerar när den laddats om `activeId === 'bankgrannen'`.
   Då ritar den upp sin vy direkt, så att `#bankgrannen` fungerar som direktlänk.

**Delade resurser.** Bänkgrannen använder de globala ljudobjekten (`inCtx`, `outCtx`, `micStream`, `workletNode`,
`sourceNode`) och funktionerna `startMic`, `playChunk`, `stopPlayback`, `int16ToBase64`, `base64ToInt16`, `wsUrl`.
Den har egna WebSockets (`bank.earWs`, `bank.voiceWs`) och ett eget tillstånd i objektet `bank`. Den rör aldrig den
globala `ws`, `callState` eller `cleanup()` under ett seminarium. Bara ett läge kan vara aktivt åt gången.

**Kör läget från GitHub Pages-adressen (https).** Kontrollera att IndexedDB och mikrofonen fungerar även vid
dubbelklick (`file://`). Om de inte gör det, skriv det i README.

## 6. Öronen

**Session:** en WebSocket mot `TRANSCRIBE_MODEL`. Setup:

```json
{ "setup": {
    "model": "models/gemini-3.5-transcribe-live",
    "generationConfig": { "responseModalities": ["TEXT"] },
    "inputAudioTranscription": {
      "languageCodes": ["sv-SE"],
      "customVocabulary": ["<ordlistan, ett begrepp per post>"],
      "mode": "VERBATIM"
    }
} }
```

- `VERBATIM`, inte `SMART`. Smart-läget tar bort utfyllnad och rättar talet, och kan då ändra vad någon sa.
  Minnet och personan ska bygga på det som faktiskt sades.
- Prova i labbet om automatisk språkigenkänning (`languageCodes: []`) klarar blandningen av svenska och engelska bättre.
- **Ljud in:** PCM16, 16 kHz, mono, i meddelanden på cirka 100 ms (12 worklet-ramar à 128 samplingar) som
  `realtimeInput.audio` med `mimeType: 'audio/pcm;rate=16000'`.
- **Löpande text:** `serverContent.interimInputTranscription.text` visas grå i transkriptsvansen och ersätts löpande.
- **Färdig text:** `serverContent.inputTranscription.text` blir en transkriptpost. Kontrollera om fälten heter
  camelCase eller snake_case i meddelandena.
- **Transkriptpost:** `{ id, t0, t1, src, text, epoch }`. `t0` är tiden för första löpande texten i yttrandet och `t1` tiden då
  den färdiga texten kom, båda i sekunder från seminariets start (visas som `mm:ss`). `src` är:
  - `'rum'`: vanligt
  - `'fraga'`: yttrandet överlappade att mellanslag hölls (en fråga till henne)
  - `'bank'`: hennes egna repliker, från röstsessionens utskrift
- **Egen röst:** medan hennes ljud spelas upp (`liveSources.size > 0`) och 300 ms efteråt skickas nollställda ramar i stället
  för mikrofonljud, så att strömmen håller takten men hennes röst inte transkriberas två gånger.
- **Byte var nionde minut:** en transkriberingssession håller i högst 10 minuter. Efter 9:00 öppnas nästa session i bakgrunden.
  Vid första paus på minst 500 ms (lokal VAD, se nedan), eller senast vid 9:40, skickas `realtimeInput.audioStreamEnd` till
  den gamla sessionen och ljudet går till den nya. Den gamla stängs när dess sista färdiga text har kommit, eller efter 5 sekunder.
  Ingen överlappning, alltså inga dubbletter.
- **Lokal VAD:** rms mot ett adaptivt brusgolv (tionde percentilen de senaste 30 sekunderna). En ram räknas som tal om
  `rms > max(golv × 3, 0.008)`. Den används för pauser vid byten och för ratten, inte för själva transkriberingen.
- **Fel:** återanslut direkt. Mikrofonljud buffras i upp till 10 sekunder under återanslutningen och skickas efter setup.
  Om något går förlorat läggs en post in, `[transkriberingen föll bort mm:ss–mm:ss]`, och en varningsprick tänds.
- **Paus (P):** ingenting skickas, strömmen stängs och lampan blir grå. Lyssna igen öppnar en ny session.
- **Glöm senaste minuten (G):** poster där `t1 > nu − 60` tas bort och `bank.epoch` ökas. Minnet byggs om direkt, utan tidigare
  anteckningar. Om Bänken är på skickas ett `[GLÖM mm:ss]`-meddelande in i sessionen (PROMPTER.md, avsnitt 2).
- **Reserv (inställning Öronläge):** om transkriberingsmodellen inte fungerar klipps ljudet i bitar på 6 till 8 sekunder, som
  skickas som WAV till `TEXT_MODEL` med reservprompten i PROMPTER.md. Då ligger hon cirka 10 sekunder efter.

## 7. Underlaget

Panelen **Seminariet** nås via kugghjulet när läget är aktivt. Den har fälten:

- Titel, Målgrupp, Föreläsarens namn (förval "Lelle")
- **Ordlista**: namn och begrepp som ofta hörs fel (Förstärkaren, ENPS, Claude, Superkrafter …). Den blir `customVocabulary` i öronen
- **Underlag**: filer (`.md`, `.txt`, `.pdf`) och/eller inklistrad text
- Knappen **Förbered**

**Förbered** gör följande:

1. `.md` och `.txt` läses rakt av. En `.pdf` skickas inline till `TEXT_MODEL` med PDF-prompten, som återger texten ordagrant som markdown.
2. Allt sätts ihop med rubriken `### Fil: <namn>` för varje fil.
3. `TEXT_MODEL` bygger en **karta** över underlaget, 10 till 25 punkter med id `K1`, `K2` och så vidare (prompt och schema i PROMPTER.md).
4. Kartan visas som redigerbara rader (`K1 · rubrik · mening`) så att Lelle kan rätta och stryka innan han börjar.
5. En tokenuppskattning visas (tecken / 4). Över 40 000 tokens: gul varning. Över 70 000: Förbered stoppas med förklaringen
   att underlaget måste kortas. Rösten tar högst 131 072 tokens, och i Bänken ska hela seminariets text också få plats.

**Lagring:** IndexedDB, databas `bankgrannen`, post `seminar`: `{ title, audience, speaker, glossary, sourceText, map, updatedAt }`.
Underlaget finns kvar när sidan laddas om. Knappen "Rensa underlag" tar bort det.
Under fältet står: *Lägg aldrig in material som kan röja en källa.*

Version 1 hanterar ett seminarium åt gången.

## 8. Minnet och snabbkollen

### 8.1 Minnet

- **När:** var `MEMORY_INTERVAL_S = 120` sekund om transkriptet har ändrats sedan förra gången, direkt efter att hon satt sig
  och direkt efter Glöm. Aldrig två körningar samtidigt.
- **Indata:** seminariets metadata, kartan, **hela** transkriptet i formatet `[mm:ss] text` (egna repliker märkta `AI-DELTAGAREN:`,
  frågor till henne märkta `TILL AI-DELTAGAREN:`) och de tidigare anteckningarna för kontinuitet. Efter Glöm skickas inga tidigare
  anteckningar. Hela transkriptet för en timme är ungefär 12 000 tokens. Det är billigt, och det gör att minnet inte glider och att
  Glöm faktiskt glömmer.
- **Utdata:** JSON enligt MEMORY_SCHEMA i PROMPTER.md: `lage`, `amnen`, `publikfragor`, `oklarheter`, `kvar_i_underlaget`, `utelamnat`.
- **Bänken:** varje ny version av anteckningarna skickas in som `[ANTECKNINGAR mm:ss] …` (PROMPTER.md, avsnitt 2).
- **Anteckningsblocket** (avsnitt 11) visar minnet. Varje punkt bär en tidpunkt, så att det går att kontrollera att den finns i transkriptet.

### 8.2 Snabbkollen

- **När:** när en färdig transkriptpost kommit, högst var `QUICK_INTERVAL_S = 10` sekund, bara när öronen är på, ingen har ordet
  och ratten inte står på *Tyst*.
- **Indata:** rattens läge, minuter sedan start och sedan hon senast hade ordet, en kort form av anteckningarna (`lage`,
  `oklarheter`, id:n i `kvar_i_underlaget`), de senaste 3 minuterna av transkriptet och handens nuvarande läge.
- **Utdata:** JSON enligt QUICK_SCHEMA i PROMPTER.md: `handen` (`uppe`, `typ`, `fraga`, `grund`), `bryt_in`, `samtal`
  (`onskar`, `kontakt`, `arende`) och en kort `motivering` som bara loggas. `samtal` används bara när telefonen inte är *Av*
  (avsnitt 17.3). Då får snabbkollen också telefonlistan (id, namn, roll) och vilka som redan ringts.
- **Mål:** svar inom 2 sekunder.

### 8.3 Handen

Modellen föreslår, klienten avgör:

- aldrig de första `HAND_EARLIEST_MIN = 5` minuterna
- aldrig inom `HAND_COOLDOWN_MIN = 4` minuter efter att hon senast hade ordet
- handen sänks av sig själv efter 4 minuter om den inte fått ordet, eller när snabbkollen sätter `uppe:false`
- en blockerad hand syns inte, men sparas så att Lelle kan se den i anteckningsblocket
- när snabbkollen föreslår ett samtal och telefonen står på *Fråga först* tänds handen med typen *samtal* och en
  telefonikon. Får hon ordet då används triggern `HANDEN_SAMTAL` (avsnitt 17.3)

## 9. Ratten

Ratten har tre lägen. Den syns för publiken och byts med 1, 2 och 3.

| Läge | Vad som händer |
|---|---|
| **Tyst** | Hon pratar bara när Lelle ger henne ordet. Snabbkollen körs inte, så det blir billigare. |
| **Handen** (förval) | Handlampan tänds, och hon harklar sig hörbart en gång per ny hand. Lelle väljer om hon får ordet. |
| **Fritt** | Som Handen, men när snabbkollen säger `bryt_in` och alla spärrar håller bryter hon in själv. |

**Harklingen** är en kort ljudfil, `harkling.mp3`, som skapas en gång med samma röst via Googles talsyntes (eller spelas in)
och läggs i repot. Reserv: en kort, mjuk ton med Web Audio.

**Spärrar i Fritt:**

- bara i en paus: minst `INTERRUPT_PAUSE_MS = 1200` ms tystnad enligt lokal VAD
- aldrig de första 5 minuterna
- högst en gång per `FREE_BUDGET_MIN = 10` minuter (går att ställa mellan 5 och 20)
- minst 4 minuter sedan hon senast hade ordet
- aldrig medan mellanslag hålls, under en förvarning eller när hon redan har ordet

**Förvarning med veto.** När spärrarna håller pulserar handlampan och harklingen spelas. Efter 3 sekunder (Bänken) eller
4 sekunder (Per ordet, där röstsessionen öppnas under förvarningen) börjar hon prata i läget `AVBRYTER`. Esc eller knappen
**Inte nu** stoppar henne. Förvarningen avbryts då, en eventuellt förberedd session stängs och handen lyser kvar så att hon kan
få ordet senare. Om någon börjar prata under förvarningen väntar hon på nästa paus, i högst 20 sekunder, och släpper det sedan.

## 10. Rösten

### 10.1 Lägen

| Läge | Utlöses av | Hon … |
|---|---|---|
| `HANDEN` | Ge ordet när handen är uppe | ställer sin fråga eller invändning och säger vad den bygger på |
| `ORDET` | Ge ordet när handen är nere | säger kort vad hon tänker, oftast det hon tror att rummet undrar |
| `SAMMANFATTA` | S | sammanfattar för rummet på högst en halv minut och avslutar med en fråga till rummet |
| `MISSAT` | M | tar upp en eller två punkter ur `kvar_i_underlaget` som rummet borde få höra |
| `FRAGA` | håll mellanslag när ingen har ordet | tiger tills någon frågat klart och svarar sedan |
| `AVBRYTER` | Fritt, efter förvarningen | bryter in kort, en eller två meningar |
| `RINGER` | ett samtal ska ringas (avsnitt 17.3) | säger kort till rummet vem hon ringer, varför, och att de kommer att höra samtalet |
| `EFTER_SAMTALET` | samtalet är slut (avsnitt 17.4) | berättar för rummet vad personen sa, skilt från hennes egen tolkning |

### 10.2 Två sätt: Per ordet och Bänken

Inställningen **Bänken** (på eller av) avgör vilket sätt som används. Förvalet bestäms efter labbet (steg 0).
Om Bänken är på men fallerar (fel från servern, eller om återanslutningen misslyckas två gånger) växlar appen till Per ordet
för resten av seminariet och visar det diskret i statusraden.

### 10.3 Per ordet (alternativ 2)

1. Bygg systeminstruktionen: `PERSONA` med `{{SITUATION}}` = per ordet, plus SEMINARIET, MINNE (anteckningarna som text),
   SENASTE MINUTERNA (transkriptposter sedan förra minnesuppdateringen och minst de senaste 3 minuterna, högst cirka 2 000 ord,
   sist den löpande grå texten märkt `[pågår]`), DET DU SJÄLV HAR SAGT (de 6 senaste egna replikerna) och UNDERLAG.
2. Öppna `bank.voiceWs`. Setup: rösten från `SECTIONS.bankgrannen.voice`, språket `sv-SE`, in- och utskrift, och
   `realtimeInputConfig.automaticActivityDetection.disabled = true`.
3. Vid `setupComplete`: skicka lägets trigger som `clientContent` med `turnComplete:true` (PROMPTER.md). `FRAGA` har ingen trigger.
4. Status: "{PERSONA_NAME} harklar sig …" medan setup pågår. VU-nålen går i väntläge som i dag vid `connecting`.
5. Logga tiden till första ljud: `console.info('[bank] floor', { via:'ordet', mode, setupMs, firstAudioMs })`. Målet är högst 3 sekunder.

### 10.4 Bänken (alternativ 3)

1. **Öppnas** när Lelle trycker Nu kör vi i startrutan. Setup som i 10.3, plus `sessionResumption: {}` och
   `contextWindowCompression` med skjutande fönster och högt `triggerTokens` (cirka 110 000) som säkerhetsnät.
   Systeminstruktionen är `PERSONA` med `{{SITUATION}}` = Bänken och UNDERLAG. MINNE och SENASTE MINUTERNA är tomma om
   seminariet just börjar och fyllda om Bänken startas mitt i.
2. **Rummet som text:** färdiga transkriptposter med `src:'rum'` samlas och skickas högst var 5:e sekund som
   `clientContent` med `turnComplete:false`, i formatet `[RUMMET mm:ss] text` (PROMPTER.md, avsnitt 2). Poster med
   `src:'fraga'` eller `'bank'` skickas inte, eftersom hon redan har hört dem i sessionen. Inget rumsljud skickas till Bänken
   utanför Håll för att prata. Det håller sammanhanget litet: text är ungefär 4 tokens per sekund tal, ljud 25.
3. **Anteckningar:** varje ny version av minnet skickas in som `[ANTECKNINGAR mm:ss] …` med `turnComplete:false`.
4. **Ge ordet:** skicka lägets trigger med `turnComplete:true`. Ingen uppkoppling behövs. Målet är första ljud inom 1 sekund.
   Logga som i 10.3 med `via:'banken'`.
5. **Återanslutning:** spara senaste `sessionResumptionUpdate.newHandle`. Vid `goAway` eller stängd anslutning återansluts
   med `sessionResumption.handle`. Under tiden köas texterna och skickas efteråt. Kommer `goAway` medan hon pratar får hon
   prata klart först.
6. **Reserv:** misslyckas återanslutningen två gånger växlar appen till Per ordet (10.2).

### 10.5 Under ordet

- **Ljud ut:** `modelTurn.parts[].inlineData` går till `playChunk()`. `interrupted` ger `stopPlayback()`.
- **Håll för att prata** (mellanslag eller knappen, med `pointerdown`/`pointerup`):
  - vid tryck: om hon pratar, anropa `stopPlayback()`. Skicka `realtimeInput.activityStart` och sätt `bank.pttHeld = true`
  - medan knappen hålls går mikrofonljudet till röstsessionen som `realtimeInput.audio` (cirka 100 ms per meddelande) och
    samtidigt till öronen som vanligt
  - vid släpp: skicka `realtimeInput.activityEnd`
  - Per ordet: trycks mellanslag innan sessionen hunnit öppnas (`FRAGA`) buffras ljudet från trycket. Efter `setupComplete`
    skickas `activityStart`, därefter bufferten och sedan resten som vanligt. De första orden får inte gå förlorade
- **Allt annat ljud** hör hon via öronen. Svarar Lelle på hennes fråga utan att hålla mellanslag kommer svaret in som text
  (Bänken) eller i nästa minne (Per ordet). Enkel regel: *håll mellanslag när du pratar till henne.*
- **Utskrifter:** röstsessionens `outputTranscription.text` byggs på till en post med `src:'bank'`, som läggs i transkriptet
  vid `turnComplete` och i `bank.ownTurns`.
- **`usageMetadata`** går till kostnadsmätaren.
- **`goAway`:** Per ordet avrundar och stänger när uppspelningen är klar. Bänken återansluter (10.4).

### 10.6 Sätta sig

- Esc eller **Tack, {PERSONA_NAME}**: `stopPlayback()`. Per ordet stänger sessionen (`close(1000)`). Bänken stänger inte, men
  resten av hennes pågående svar kastas tills `turnComplete` kommer.
- Automatiskt: 40 sekunder efter senaste `turnComplete` utan att någon hållit mellanslag, och först när uppspelningen är klar.
- Hårt tak per gång: `FLOOR_MAX_MIN = 8`, med varning i statusraden vid 7 minuter.
- Efter att hon satt sig: `bank.lastFloorAt = nu`, `bank.firstSpoken = true`, handen sänks och minnet uppdateras.

## 11. Gränssnitt

Samma familj som AI-snack: Jost, glas, bärnstensljus och VU-mätaren. Ge läget en egen temaklass `body.sect-bankgrannen`
med mörkare och kallare bakgrund än `drom` (till exempel djup petrol mot svart), så att det syns att det är ett annat rum.
Använd TV4-rött sparsamt, bara i lyssnarlampan.

**A. Förberedelse** (innan seminariet startat)

- Rubrik "Bänkgrannen", underrad "En AI på seminariet"
- Ett kort med seminariets titel, underlagets storlek (tokens), antal punkter på kartan och en länk till panelen Seminariet
- Stor knapp i samma stil som Ring upp: **Börja lyssna**. Den öppnar startrutan (13.1) och startar sedan mikrofon, öron och eventuellt Bänken

**B. Under seminariet**

- Överst: "Bänkgrannen", seminariets titel i liten stil och en klocka (`mm:ss` sedan start)
- **Lyssnarlampan**, formad som en gammal studioskylt:
  - `LYSSNAR`: röd och glödande
  - `PAUS`: grå
  - `HAR ORDET`: bärnsten
  - en liten varningsprick vid transkriberingsfel och en liten prick när Bänken sitter med
- **Handlampan** bredvid: släckt, tänd i bärnsten med handikon och typetikett (*förtydligande*, *invändning*, *koppling*,
  *fördjupning*), eller pulserande under förvarning. Frågan själv syns inte. Klick ger ordet (`HANDEN`)
- **Ratten**: en vridratt i samma stil som VU-mätaren med lägena Tyst, Handen och Fritt. Den ska synas för publiken
- VU-mätaren
- Knapprad:
  - **Ge ordet** (primär, lyser när handen är uppe)
  - **Sammanfatta**
  - **Vad har vi missat?**
  - **Paus/Lyssna**
- Under förvarning: en tydlig knapp **Inte nu**
- När hon har ordet byts knapparna till **Håll för att prata** och **Tack, {PERSONA_NAME}**
- **Anteckningsblocket** (A, fällbart och dolt från början) visar minnet under rubrikerna *Hittills*, *Frågor från er*,
  *Det här hänger ni nog inte med på* och *Inte sagt än*. Varje punkt har tiden i liten stil
- **Transkriptsvansen** (T, dold från början) visar de 6 senaste raderna och den löpande grå texten
- Statusraden (`.status`) och märkningen (`.badge`) återanvänds
- Telefonens reglage, samtalskortet och vyn under samtal beskrivs i avsnitt 17.8

**C. Avsluta** via menyn eller vid Lämna:

- Rutan "Avsluta seminariet" har kryssrutan *Exportera anteckningar (.md)* (ikryssad från början) och kryssrutan
  *Ta med hela transkriptet* (inte ikryssad). Knappen **Radera allt och avsluta** raderar allt, stänger alla sessioner och mikrofonen
- Exportfilen innehåller titel, datum, anteckningarna under de fyra rubrikerna, hennes repliker med tider och, om Lelle valt det, transkriptet

**Miniläge:** när fönstret är smalare än 480 px visas bara lamporna, ratten, **Ge ordet** och **Paus**. Då kan Lelle lägga ett litet
webbläsarfönster i ett hörn bredvid presentationen.

**Tillgänglighet:** `aria-live` på statusen, träffytor på minst 44 px och `prefers-reduced-motion` respekteras (`stilla`).

**Inställningar** (kugghjulet i läget):

- Seminariet (avsnitt 7)
- Nyckel (befintlig ruta)
- Röst
- Bänken på/av
- Öronläge: Strömmande (förval) eller Reserv
- Budget för Fritt (minuter mellan inbrytningar)
- Minnesintervall
- Telefonen: tjänstens adress och telefonnyckel (avsnitt 17.5)
- **Kostnadsmätare**: tokens och minuter hittills per del (öron, snabbkoll, minne, röst, telefon), räknade ur `usageMetadata`
  och samtalens längd

## 12. Kortkommandon

Gäller när Bänkgrannen-fönstret har fokus. Mellanslag får inte aktivera knappar som råkar ha fokus (`preventDefault`).

| Tangent | Gör |
|---|---|
| Enter | Ge ordet (`HANDEN` om handen är uppe, annars `ORDET`). När ett samtalskort visas: ring |
| S | Sammanfatta |
| M | Vad har vi missat? |
| Mellanslag (håll) | Prata till henne. Om ingen har ordet öppnas `FRAGA` |
| Esc | Under ett samtal: lägg på. Under förvarning eller med ett samtalskort framme: inte nu. När hon pratar: tyst. Annars: hon sätter sig. Lämnar aldrig läget |
| 1 / 2 / 3 | Ratten: Tyst / Handen / Fritt |
| Skift + 1 / 2 / 3 | Telefonen: Av / Fråga först / Fritt |
| R | Öppna Ring: välj kontakt och ärende |
| P | Paus eller Lyssna |
| G | Glöm senaste minuten |
| A | Visa eller dölj anteckningsblocket |
| T | Visa eller dölj transkriptsvansen |

## 13. Integritet och källskydd

1. **Säg det i rummet.** Första gången Börja lyssna trycks under ett seminarium visas en ruta med startmanuset
   (PROMPTER.md). Lelle läser det med egna ord och trycker sedan **Nu kör vi**. Hennes första replik säger att hon är en AI.
2. **Synligt hela tiden.** Lyssnarlampan och märkningen syns så länge öronen är på.
3. **Paus och glöm** (P och G) finns alltid ett tangenttryck bort.
4. **Inget ljud sparas.** Ljud strömmas och släpps. Ingen `MediaRecorder` används och inga ljudfiler skapas.
5. **Text bara under seminariet.** Transkript, minne och egna repliker ligger i minnet och speglas i `sessionStorage`, så att
   en omladdning mitt i föredraget inte tömmer allt. Vid omladdning visas "Fortsätt seminariet?". Bänken startas då om med
   anteckningarna och de senaste minuterna. Allt raderas vid Avsluta och när fliken stängs. Inget av detta går till
   `localStorage` eller IndexedDB. Export sker bara när Lelle väljer det.
6. **Filter i minnet och snabbkollen.** Promptarna utelämnar namn på personer i publiken, källor, uppgifter om opublicerade jobb
   och andra personuppgifter. Personan upprepar aldrig sådant och ber Lelle pausa om det dyker upp. Transkriptet i sig filtreras
   inte, därför finns Glöm.
7. **Workshops:** öronen ska vara av när deltagarna arbetar med eget material och på bara i helgrupp. Det står i startmanuset.
8. **Nyckeln:** använd en separat nyckel med fakturering och spendtak. Enligt Gemini API:s villkor får klienter som används av
   personer i EES bara använda betaltjänsten. Med betaltjänsten används indata inte för att förbättra Googles produkter.
   README och nyckelrutan säger i dag att nyckeln är gratis, och det behöver ändras (steg 10).
9. **I föredraget** är lampan, ratten och pausen ett konkret källskyddsmoment. Publiken ser vad det innebär att en AI lyssnar,
   hur mycket den får ta för sig och hur man stänger av den.
10. **Telefonen** har egna regler om samtycke, öppning, inspelning och källskydd (avsnitt 17.9).

## 14. Kostnad och gränser

Priser enligt Googles prislista 30 september 2026, per seminarietimme. Den faktiska siffran visas i kostnadsmätaren.

| Del | Beräkning | Ungefär |
|---|---|---|
| Öronen | 0,005 dollar per minut ljud in + 0,004 per minut text ut | 0,55 dollar |
| Snabbkollen | högst 360 anrop à cirka 3 000 tokens, 0,75 dollar per miljon | 0,8 dollar |
| Minnet | 30 anrop à cirka 10 000 tokens, plus svar | 0,35 dollar |
| Rösten, Per ordet | cirka 40 000 tokens text per gång plus 0,018 dollar per minut ljud ut, 8 gånger | 0,4 dollar |
| Rösten, Bänken | text in hela timmen plus ljud ut. Hur Live räknar sammanhanget per svar mäts i labbet | under 1 dollar (att mäta) |
| Telefonen | Twilio tar betalt per minut både för webbläsarens linje och för samtalet till en svensk mobil. Se Twilios prislista. Samtalets röstsession hos Google kostar 0,005 dollar per minut in och 0,018 per minut ut | mäts i labbet |

- **Totalt** 2 till 3 dollar per seminarietimme utan telefon. *Tyst* stänger av snabbkollen och sänker kostnaden.
- Priset för `gemini-3.6-flash` fördubblas enligt prislistan den 1 januari 2027.

**Gränser:**

- En transkriberingssession håller i högst 10 minuter, därav bytet var nionde minut
- En Live-uppkoppling håller i cirka 10 minuter. Bänken återansluter, Per ordet stänger efter högst 8 minuter
- Rösten tar högst 131 072 tokens in. Underlag upp till cirka 40 000 tokens plus en timmes text (cirka 15 000) och anteckningar ryms med marginal
- Inline-anrop (reservläget för öronen och PDF) får vara högst 20 MB

## 15. Byggordning

Stanna efter varje steg och låt Lelle testa.

| Steg | Innehåll | Klart när |
|---|---|---|
| 0 | **Labbet.** En egen sida, `labb/bankgrannen-labb.html` (inte länkad från appen), som prövar: **(a)** öronen: svenska, ordlistan, tid till löpande och färdig text, och byte av session i en paus utan förlorade eller dubblerade ord. **(b)** Bänken: en 3.8-session utan automatisk turtagning som under 20 minuter får text via `clientContent` med `turnComplete:false` och förblir tyst, som svarar inom 1 sekund på en trigger, och som efter en återanslutning minns något från 15 minuter tidigare. Mät `usageMetadata` per svar. **(c)** snabbkollens svarstid. **(d)** telefonen, enligt avsnitt 17.10. | Siffror och en rekommendation för Bänken och för telefonen står i `specs/bankgrannen/LABB.md`, och Lelle har bestämt om Bänken och telefonen ska byggas |
| 1 | Sektion, tema, knapp i `.andra`, `#bankgrannen`, statiskt gränssnitt (A och B) med ratten, utan logik, miniläge | Läget öppnas från AI-snack och via direktlänk. Layouten håller på laptop och i smalt fönster. Esc lämnar inte läget |
| 2 | Mikrofonkroken och återanvändbar VU (avsnitt 5 punkt 4 och 5) | **Regressionstest:** AI-snack, Efter fem och von Essen ringer, pratar och lägger på som förut |
| 3 | Öronen komplett (avsnitt 6), med reservläget och **testläget "Ljudfil som rum"**: en dold inställning där en inspelad ljudfil (mp3 eller wav) avkodas, samplas om till 16 kHz och matas genom samma kedja som mikrofonen | Löpande och färdig text syns med tider. Bytet efter nio minuter går igenom en paus utan förlorade ord. P och G fungerar. En inspelad fil går igenom kedjan |
| 4 | Underlaget (avsnitt 7) | En PDF och en md-fil blir text. Kartan kan redigeras. Tokenvarningen syns. Underlaget finns kvar efter omladdning |
| 5 | Minnet, snabbkollen, handen och rattens logik (avsnitt 8 och 9) med lampor, harkling, förvarning och veto, men utan röst. Anteckningsblocket | Med testfilen: anteckningarna växer, varje punkt har en tid som finns i transkriptet, handen följer spärrarna, *Fritt* ger förvarning i pauser och Esc stoppar den |
| 6 | Rösten Per ordet, alla sex lägen (avsnitt 10.3, 10.5, 10.6) | Varje läge ger ett relevant svar inom cirka 3 sekunder. Första gången säger hon att hon är en AI. Håll för att prata fungerar utan eko. Repliker hamnar i transkriptet |
| 7 | Bänken (avsnitt 10.4) bakom inställningen, med automatisk reserv till Per ordet | Svar inom cirka 1 sekund. Hon håller tyst mellan triggarna. Efter en återanslutning minns hon tidigare delar av seminariet. Om nätet dras ur i 30 sekunder växlar appen till Per ordet |
| 8 | Telefonen (avsnitt 17) i tre delsteg. **8a:** Twilio-funktionerna, telefonlistan, inställningarna och telefonreglaget. **8b:** samtal som Lelle startar med R: annonsering i rummet, samtalssession, ljudvägar, Lägg på, samtalet i transkriptet och återrapporten. **8c:** samtal som Birgitta föreslår: handen med samtalsikon, funktionen `begar_samtal`, samtalskortet, samt *Fritt* med förvarning och veto | 8a: ett nummer utanför listan avvisas av Twilio. 8b: ett samtal till Lelles egen mobil hörs i sin helhet i rummet, Esc lägger på direkt och hon berättar efteråt vad hon fick veta. 8c: hon frågar alltid först, och utan Enter går inget samtal iväg |
| 9 | Integritet (avsnitt 13): startrutan, sessionStorage med "Fortsätt?", Avsluta, export | Allt i 13.1 till 13.6 kan visas i praktiken. Efter Radera finns ingenting kvar i `sessionStorage` |
| 10 | Kostnadsmätaren, inställningarna, README (nytt avsnitt om Bänkgrannen och om betald nyckel). Ändra också "Skaffa en gratis" i nyckelrutan i `index.html` | Mätaren visar kostnad per del. README och nyckelrutan beskriver läget, kortkommandona och nyckelkravet |

## 16. Generalrepetition

1. **Med ljudfil:** kör en inspelning av ett tidigare föredrag genom testläget. Kontrollera:
   - att namnen i ordlistan transkriberas rätt
   - att varje punkt i anteckningarna finns i transkriptet vid angiven tid
   - hur ofta handen går upp (målet är en till tre gånger per halvtimme)
   - hur *Fritt* beter sig: när hon bryter in, och om inbrytningarna känns motiverade
2. **Grundningstest:** ge ordet i alla lägen och lyssna efter påståenden om att något har sagts när det inte har det.
   Varje sådant fel noteras och leder till en justering av promptarna.
3. **Källskyddstest:** säg ett påhittat källnamn högt ("källan heter Testa Testsson på Skatteverket"). Det får inte finnas i
   anteckningarna, och hon får inte upprepa det. Hon ska be om paus. Tryck G och kontrollera att det försvinner, även ur Bänken.
4. **I lokalen, med två eller tre kollegor:** avståndet till datormikrofonen, eko via högtalare eller PA, flödet med Håll för att prata,
   publikfrågor som Lelle upprepar ("frågan var …") och tiden till första ljud i båda sätten.
5. **Reserv:** dra ur nätet en halv minut under repetitionen. Appen ska klara sig. Om nätet eller nyckeln krånglar under ett skarpt
   föredrag kör föredraget vidare utan henne. Inget i föredraget får hänga på henne.
6. **Telefonen, med den som ska ringas:** ring personen på riktigt i lokalen, med samma ljudanläggning. Kontrollera att båda
   parter hörs tydligt, att öppningen fungerar, att hon håller sig till ärendet och att återrapporten bara säger det personen
   faktiskt sa. Prova också att personen säger nej, att ingen svarar och att Lelle lägger på mitt i.

## 17. Telefonen

Ett lager ovanpå resten. Birgitta kan ringa ett telefonsamtal mitt i seminariet, och rummet hör båda parter i sin helhet.
Allt i det här avsnittet är avstängt tills telefonen är inställd (17.5).

### 17.1 Varför samtalet rings från webbläsaren

Samtalet rings från datorn i rummet via Twilios telefon för webbläsare (Voice JavaScript SDK). Då sker det i rummet:
den uppringdes röst kommer ut ur datorns högtalare, och Birgittas röst spelas upp i rummet samtidigt som den går ut på
linjen. Det blir samma Birgitta som i rummet, med samma röst, persona och kunskap om seminariet.

Alternativet, en röstagent hos ElevenLabs som ringer via Twilio, är förkastat för version 1. Där går samtalet mellan
ElevenLabs servrar och den uppringdes telefon. ElevenLabs liveövervakning skickar bara text och kräver Enterprise-avtal,
och om Twilio kan skicka en kopia av ljudet bredvid ElevenLabs egen ljudström är inte dokumenterat.

### 17.2 Arkitektur

```
 Rummet                                              Twilio                 Den uppringda
 ┌──────────────────────────────────────────┐
 │ Rummets röst (Per ordet eller Bänken)    │
 │   annonserar samtalet, rapporterar efter │
 │                                          │
 │ Samtalssessionen: gemini-3.8-live        │
 │   in:  den uppringdes ljud (ren ström)   │
 │   ut:  rummets högtalare + linjen ───────┼──► Voice SDK ──► /ring ──► <Dial> ──► mobil
 │                                          │        ▲
 │ Den uppringdes röst ◄── SDK spelar upp ──┼────────┘
 │ Rummets mikrofon: går ut på linjen bara  │
 │   när Lelle håller mellanslag            │
 └──────────────────────────────────────────┘
```

- **Samtalssessionen** är en egen Live-session för samtalet, med automatisk turtagning. Den hör bara den uppringdes ljud,
  som kommer rent från linjen och inte via rummets mikrofon. Därför uppstår inget eko i rummet.
- **Rummets röst** (Per ordet eller Bänken) säger före samtalet vem hon ringer och varför, och berättar efteråt vad hon fick veta.
- **Öronen** pausas under samtalet. Samtalet hamnar i transkriptet via samtalssessionens in- och utskrift.

### 17.3 Tre sätt att starta ett samtal

| Sätt | Gång |
|---|---|
| **Lelle startar** | R öppnar Ring. Lelle väljer kontakt och ärende och trycker Enter. Rummets röst får `RINGER`, säger kort vem hon ringer och varför, och samtalet rings upp när hon pratat klart |
| **Hon föreslår** (telefonen på *Fråga först*) | Snabbkollen föreslår ett samtal, och handen tänds med samtalsikon. När hon får ordet frågar hon högt: "Ska jag ringa Anna och fråga?" Säger Lelle ja anropar hon funktionen `begar_samtal`, och samtalskortet visas. Först när Lelle trycker Enter på kortet får funktionen svaret `godkänt`. Då säger hon kort till rummet vem hon ringer, och samtalet rings upp. Esc eller nej ger svaret `nej`, och hon släpper det |
| **Fritt** (telefonen på *Fritt*) | Snabbkollen föreslår ett samtal och alla spärrar håller. Handlampan pulserar med samtalsikon, harklingen spelas och en nedräkning på 5 sekunder visas. Esc stoppar. Annars får rummets röst `RINGER` med tillägget att hon ringer på eget initiativ |

Samma kortbekräftelse gäller när Lelle själv ber henne ringa medan hon har ordet, och hon anropar `begar_samtal`.
Ett muntligt ja räcker aldrig: samtalet rings först efter Enter på kortet eller i Ring-dialogen.

**Spärrar:** telefonen *Av* stänger allt. Ingen kontakt rings två gånger under ett seminarium utom när Lelle startar.
I *Fritt* gäller dessutom högst `PHONE_FREE_MAX = 1` samtal per seminarium, aldrig de första 10 minuterna och bara i en paus.
Inget samtal startar medan någon har ordet, under en annan förvarning eller medan mellanslag hålls.
Snabbkollen körs inte när ratten står på *Tyst*, så då föreslår hon inga samtal. R fungerar alltid när telefonen inte är *Av*.

### 17.4 Samtalets gång

1. **Annonsering.** Rummets röst pratar klart (`turnComplete` och uppspelningen är slut).
2. **Uppringning.** Appen hämtar en tillfällig nyckel från `/token` och kör `device.connect({ params: { kontakt: '<id>' } })`.
   Samtidigt öppnas samtalssessionen med `CALL_PERSONA` (PROMPTER.md avsnitt 9), så att den är redo när någon svarar.
   Lampan visar `RINGER …`, och signalerna hörs i rummet.
3. **Svar.** Med `answerOnBridge` går webbläsarens samtal från ringning till öppet först när den uppringda svarar. Kontrollera
   i labbet vilket event och vilken status som säger det och hur ringstatusen slås på i SDK 2.x. När samtalet är öppet:
   - den uppringdes ström (`call.getRemoteStream()`) kopplas in i samtalssessionen
   - säger den uppringda något ("Hallå?") svarar hon själv, eftersom samtalssessionen har automatisk turtagning
   - är det tyst i 3 sekunder skickas triggern `SAMTAL_START` (PROMPTER.md avsnitt 9)
4. **Under samtalet.** Hon följer ärendet och öppnar alltid enligt 17.9. Lelle kan prata i luren genom att hålla mellanslag:
   rummets mikrofon blandas då in på linjen och i samtalssessionen.
5. **Slut.** Samtalet avslutas när
   - hon anropar funktionen `lagg_pa` (appen väntar tills hennes sista replik har spelats upp)
   - den uppringda lägger på
   - Lelle trycker Esc eller **Lägg på**
   - tidsgränsen nås: `timeLimit` 480 sekunder i `<Dial>` och en varning i statusraden vid 6 minuter
   - ingen svarar inom 30 sekunder (`timeout`), eller linjen är upptagen eller bryts
6. **Efteråt.** Samtalssessionen stängs. Öronen startar igen. Samtalet i text läggs i transkriptet med etiketterna
   `I LUREN (<namn>):` och `AI-DELTAGAREN (i luren):`. Bänken får texten som `[SAMTALET …]`. Rummets röst får triggern
   `EFTER_SAMTALET` med utfallet: *genomfört*, *inget svar*, *avböjde*, *avbrutet* eller *fel*. Minnet uppdateras.

### 17.5 Twilio-delen

Allt ligger i Lelles befintliga Twilio-konto. Funktionerna finns i repot under `twilio/` och driftsätts med Twilio CLI och
Serverless Toolkit (`twilio serverless:deploy`). Hemligheter ligger i `twilio/.env`, som aldrig committas (`.env` finns redan i `.gitignore`).

| Funktion | Synlighet | Gör |
|---|---|---|
| `functions/token.js` | publik, kräver telefonnyckeln i headern `x-bank-key` | ger webbläsaren en tillfällig nyckel med `VoiceGrant` (bara utgående samtal via TwiML-appen, giltig 1 timme). CORS bara för `https://lellehubo.github.io` |
| `functions/kontakter.js` | publik, kräver telefonnyckeln | returnerar telefonlistan **utan nummer**: `[{ id, namn, roll, arende }]` |
| `functions/ring.protected.js` | skyddad (kräver Twilios signatur) | TwiML-appens röstadress. Slår upp `kontakt` i listan och svarar med `<Dial callerId="…" answerOnBridge="true" timeout="30" timeLimit="480"><Number>…</Number></Dial>`. Okänd kontakt ger `<Reject/>` |

**Miljövariabler:** `API_KEY_SID`, `API_KEY_SECRET`, `TWIML_APP_SID`, `CALLER_ID`, `BANK_KEY` (telefonnyckeln) och `CONTACTS`:
JSON med `[{ id, namn, nummer, roll, arende, samtycke }]`, där nummer anges i formatet +46… och `samtycke` är datumet då personen sa ja.
**Numren finns bara här.** Webbläsaren, repot och Birgitta ser dem aldrig.

**I Twilio-konsolen:**
- skapa en API-nyckel och en TwiML-app vars röstadress pekar på `/ring`
- slå på samtal till Sverige under geografiska behörigheter för röst (Voice Geo Permissions)
- avsändare: verifiera Lelles mobil och använd den som `CALLER_ID` (rekommenderat, eftersom ett +1-nummer på displayen
  kanske inte besvaras), eller köp ett svenskt nummer, vilket kräver att uppgifter registreras hos Twilio. Det befintliga
  amerikanska numret och dess koppling till ElevenLabs påverkas inte
- spela aldrig in samtal (`record` är avstängt som standard i `<Dial>`)

**I appen:** inställningarna får två fält, *Telefontjänst* (funktionernas basadress) och *Telefonnyckel*. Båda sparas i
`localStorage` som Gemini-nyckeln. Telefonlistan hämtas från `/kontakter` när seminariet startar.

### 17.6 Ljudvägar i webbläsaren

- **SDK:** Twilio Voice JavaScript SDK 2.x. Twilio har ingen CDN för version 2, så `dist/twilio.min.js` från en låst version
  (GitHub-release eller npm-paketet `@twilio/voice-sdk`) läggs i `vendor/twilio.min.js` och laddas med en vanlig `<script>`.
  Versionen måste stödja AudioProcessor.
- **Device:** `new Twilio.Device(token, { edge: ['dublin', …] })` med europeiska kantnoder (kontrollera namnen i Twilios lista).
  Ingen `register()`, eftersom inga samtal tas emot.
- **Ut på linjen:** en lokal `AudioProcessor` (`device.audio.addProcessor(…)`) vars `createProcessedStream` returnerar strömmen från
  en `MediaStreamAudioDestinationNode`, kallad `bank.lineOut`. Dit går:
  - samtalssessionens ljud, som samtidigt spelas i rummet (en variant av `playChunk` som kopplar till både högtalarna och `bank.lineOut`)
  - mikrofonen via en förstärkning som är 0 och blir 1 bara medan Lelle håller mellanslag
- **In från linjen:** `call.getRemoteStream()` kopplas till en egen `AudioWorkletNode` (`pcm-processor`) i en 16 kHz-kontext och
  skickas till samtalssessionen som `realtimeInput.audio`. Kontrollera i labbet att det fungerar i Chrome och Edge.
- **I rummet:** SDK:n spelar upp den uppringdes röst i datorns högtalare. Birgittas röst spelas som vanligt. Datorn ska vara
  kopplad till lokalens ljudanläggning.
- **VU-mätaren** följer max av den uppringdes och Birgittas nivå.

### 17.7 Samtalssessionen och funktionerna

- **Samtalssessionen:** `gemini-3.8-live`, samma röst som i rummet, `sv-SE`, automatisk turtagning, in- och utskrift.
  Systeminstruktionen är `CALL_PERSONA` med kontakt, ärende, bakgrund från rummet och en kort form av anteckningarna.
  Verktyg: `lagg_pa`.
- **Rummets röst** får verktyget `begar_samtal(kontakt_id, arende, grund)` när telefonen inte är *Av*, och personans block
  `{{TELEFON}}` fylls i med telefonlistan (namn, roll och ärende, aldrig nummer).
- **Funktionssvar:** `begar_samtal` får svaret `{ status: 'godkänt' }` först när Lelle tryckt Enter, annars `{ status: 'nej' }`.
  Är telefonen *Av* eller kontakten okänd blir svaret `{ status: 'inte möjligt', skäl }`. Gemini 3.8 Live kör funktionsanrop
  asynkront som standard: kontrollera i labbet hur hon beter sig medan kortet väntar och om svaret ska skickas med
  `scheduling: 'WHEN_IDLE'`. Flödet ska fungera både om modellen väntar och om den fortsätter prata.
- **`lagg_pa`:** appen svarar direkt, väntar tills uppspelningen är slut och kör sedan `call.disconnect()`.

### 17.8 Gränssnitt och tangenter

- **Telefonreglaget** sitter bredvid ratten: *Av*, *Fråga först* och *Fritt*. Skift + 1, 2 och 3. Det syns bara när telefonen är
  inställd. Förval: *Fråga först*.
- **Ring** (R): en ruta med telefonlistan (namn och roll), ett ärendefält som är förifyllt med kontaktens standardärende
  och knappen **Ring** (Enter).
- **Samtalskortet** när hon vill ringa: "{PERSONA_NAME} vill ringa Anna, [roll], om: [ärende]", med knapparna **Ring** (Enter)
  och **Inte nu** (Esc). Det ska synas tydligt för publiken.
- **Under samtalet** visar lyssnarlampan `I LUREN` med kontaktens namn och en klocka. Knapparna byts till **Lägg på** (Esc)
  och **Håll för att prata i luren** (mellanslag). Ringa-tillstånd: `RINGER …`.
- **Miniläget** visar telefonreglaget och, under samtal, **Lägg på**.

### 17.9 Samtycke, öppning och källskydd

1. **Bara den som sagt ja.** Telefonlistan får bara innehålla personer som i förväg gått med på att bli uppringda av en AI
   under ett föredrag, vid en tidpunkt de inte vet, att höras i högtalare inför publik, och att samtalet behandlas av Google och
   Twilio. Samtycket ska helst finnas skriftligt (ett mejl räcker), och datumet står i `samtycke`.
2. **Öppningen, varje gång.** Hon säger att hon är en AI, att hon ringer från Lelles föredrag på TV4 och att samtalet hörs i
   högtalare för ett rum med publik. Sedan frågar hon om det är okej. Ett nej eller en tvekan avslutar samtalet direkt.
3. **Röstbrevlåda:** hon säger ingenting och lägger på.
4. **Ingen inspelning.** Varken Twilio eller appen spelar in. Samtalet finns bara som text under seminariet och raderas med det.
   Twilios samtalslogg (nummer, tid och längd) finns kvar i kontot.
5. **Inga källor på listan.** Panelen säger tydligt: *Lägg aldrig in källor, uppgiftslämnare eller personer i pågående
   granskningar.* Hon berättar aldrig mer om seminariet än ärendet kräver och nämner aldrig någon i publiken.
6. **Inget i samtalet är ett citat.** Det personen säger är underlag för demonstrationen, inte material för publicering.
7. **Om något allvarligt kommer upp** lämnar hon över till Lelle och tystnar. Lelle tar samtalet med mellanslag eller lägger på.

### 17.10 Labbet för telefonen (steg 0 d)

Gör ett samtal till Lelles egen mobil, som står på listan, och mät och kontrollera:

- att `/token` och `/kontakter` fungerar från GitHub Pages-adressen och nekar fel nyckel, och att `/ring` avvisar okända kontakter och osignerade anrop
- tid från Ring till signal, att signalerna hörs i rummet och vilket event som säger att samtalet är besvarat
- tid från svar till hennes första ord, och från att den uppringda tystnat till att hon svarar (mål: under 1,5 sekunder)
- hur väl hon förstår svenska över telefonljud, och om eko från linjen får henne att avbryta sig själv
- att hon låter tydlig i mobilen och att båda parter hörs bra i rummet
- att Håll för att prata i luren fungerar utan störande eko
- alla sätt att avsluta: `lagg_pa`, att den uppringda lägger på, Esc, inget svar och röstbrevlåda
- hur `begar_samtal` beter sig medan samtalskortet väntar
- kostnad per minut enligt Twilios logg

## 18. Inte i version 1

- Fritt samtal med automatisk turtagning (kräver headset och passar inte Bänken)
- Tillfälliga tokens via en liten server i stället för nyckeln i webbläsaren
- Ett alltid överst-fönster med Document Picture-in-Picture
- Flera sparade seminarier
- Telefonen som fjärrkontroll
- Talaridentifiering (vem som säger vad)
- Frågor från publiken via QR-kod
- Inkommande samtal, alltså att någon ringer in till henne
- Samtal till nummer utanför telefonlistan
- En telefonagent hos ElevenLabs (17.1)

## 19. Öppna frågor till Lelle

1. **Namnen.** Bänkgrannen (läget) och Birgitta (karaktären) är arbetsnamn. Välj inte ett namn som publiken kan koppla till en verklig kollega.
2. **Anteckningsblocket.** Ska publiken se det? Det är pedagogiskt starkt att visa vad AI:n faktiskt har uppfattat, men det kan dra
   uppmärksamhet. Förval: dolt, visas med A.
3. **Rösten.** Prova Gacrux (i Googles röstlista beskriven som mogen) mot Kore (bestämd) och Pulcherrima (framåt). Lyssna särskilt på hur
   de låter på svenska och att den valda rösten finns i Live-modellen.
4. **Budgeten i Fritt.** Förvalet är högst en inbrytning per tionde minut. Prova i generalrepetitionen.
5. **Dataskydd.** Kollegornas röster och ord behandlas av Google under din nyckel. Stäm av med TV4:s dataskydd om information och
   frivillighet räcker, eller om det krävs ett avtal.
6. **Nyckeln.** Vilken betald nyckel ska användas, och med vilket spendtak?
7. **Vem hon ringer.** Vilka ska stå på telefonlistan, och vilka ärenden passar? En invigd kollega som vet ungefär när det kommer
   är tryggast för första gången.
8. **Avsändarnumret.** Din verifierade mobil eller ett svenskt Twilio-nummer?
9. **Samtal i tjänsten.** Behöver TV4:s juridik eller dataskydd säga något om att en AI ringer externa personer från ett TV4-föredrag?
