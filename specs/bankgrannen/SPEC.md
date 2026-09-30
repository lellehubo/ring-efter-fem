# Bänkgrannen: nytt läge i AI-snack

Byggspec för Claude Code · version 1 · 30 september 2026
Arbetsnamn: **Bänkgrannen**. Direktlänk: `#bankgrannen`. Promptarna ligger i [`PROMPTER.md`](./PROMPTER.md).

---

## Startprompt (klistra in i Claude Code)

> Läs `specs/bankgrannen/SPEC.md` och `specs/bankgrannen/PROMPTER.md`, sedan `index.html` och `README.md`.
> Bygg läget Bänkgrannen i den ordning som står i avsnitt 14. Efter varje steg: stanna, beskriv
> exakt vad jag ska testa i webbläsaren och vänta på mitt klartecken innan du går vidare.
> De befintliga samtalen (AI-snack, Efter fem, von Essen) får inte ändra beteende.
> Kontrollera fältnamnen för Live API och generateContent mot Googles aktuella dokumentation
> innan du skriver anropen. Inga långa tankstreck i texter som syns i gränssnittet.

---

## 1. Vad det är

Bänkgrannen sitter med som deltagare när Lelle håller föredrag eller workshop. Den lyssnar på hela
seminariet och har läst underlaget i förväg. När Lelle ger den ordet pratar den, med röst, i rummet.

Bänkgrannen gör fyra saker:

- **räcker upp handen** (en lampa på skärmen) när den har en fråga. Den pratar bara när Lelle ger den ordet
- **sammanfattar** det ni har pratat om hittills
- **tar upp det ni har missat**, alltså sådant i underlaget som inte kommit upp än
- **svarar** när någon i rummet frågar den något

**Karaktären.** Läget heter Bänkgrannen. Den som pratar är en karaktär med eget namn, konstanten `PERSONA_NAME`
(arbetsnamn **Birgitta**). Hon är en äldre och ganska cynisk skeptiker som kan nyhetsproduktion och tv-företag på djupet
och som också kan AI-branschen och hur verktygen fungerar. Hon sitter på publikens sida: hon översätter det Lelle säger
till vardag för dem som kan lite om AI och ger Lelle motstånd här och där, alltid för rummets skull. Det får aldrig bli
ett internt samtal mellan två som redan kan. Hon säger alltid att hon är en AI som spelar en roll, och hon hittar aldrig
på egna minnen eller händelser. Hela personan finns i PROMPTER.md, avsnitt 1.

I gränssnittet används `PERSONA_NAME` där karaktären agerar ("Tack, Birgitta", "Birgitta harklar sig …").
Lägets namn, Bänkgrannen, används för själva läget.

## 2. Bärande beslut

1. **Människan har ordet.** Bänkgrannen pratar aldrig självmant. Handen är en lampa, och det är Lelle som ger ordet.
   (Gemini 3.8 Live stöder ändå inte proaktivt ljud.)
2. **Tre delar i stället för en lång session.** Om röstmodellen hade lyssnat på hela seminariet hade den
   slagit i gränsen på 15 minuter per session och 10 minuter per uppkoppling, och den hade glömt början.
   I stället lyssnar en billig kedja hela tiden, och en ny röstsession öppnas varje gång Lelle ger ordet.
3. **En leverantör, en nyckel.** Allt går via Gemini API med nyckeln som redan ligger i webbläsaren
   (`localStorage`, samma mönster som i dag). Ingen server behövs.
4. **Inget ljud sparas.** Ljud blir text och släpps sedan. Text lever bara under seminariet.
5. **Grundat i det som sagts.** Allt som Bänkgrannen säger att någon har sagt ska finnas i transkriberingen.
   Underlaget är något den har läst, inte något som har sagts i rummet.
6. **Källskydd är inbyggt, inte påklistrat.** Det finns en synlig lampa, paus och glöm, filter i minnet och regler i personan (avsnitt 12).

## 3. Arkitektur

```
 Mikrofon (16 kHz PCM, befintlig AudioWorklet)
     │
     ├── ÖRONEN ── 15–40 s bitar (klipps i tystnad) ─► gemini-3.6-flash ─► transkript [mm:ss] text
     │                                                                        │
     │                                   var 2:a minut, hela transkriptet ◄───┘
     │                                                    │
     │                         MINNET ─► gemini-3.6-flash (JSON) ─► anteckningar + handen
     │                                                    │
     └── RÖSTEN (bara när Lelle ger ordet) ◄──────────────┘
            ny Live-session: persona + underlag + minne + senaste minuterna
            gemini-3.8-live ◄─► högtalare, in- och utskrift tillbaka till transkriptet
```

- **Öronen** gör rummet till text, hela tiden, i bitar.
- **Minnet** läser hela transkriptet (plus en karta över underlaget) och håller anteckningar uppdaterade:
  ämnen, publikens frågor, oklarheter, det som inte tagits upp och om handen ska vara uppe.
- **Rösten** öppnas när Lelle ger ordet, med allt ovan inbakat, och stängs när den sätter sig.

## 4. Modeller och anrop

| Del | Modell | Anrop |
|---|---|---|
| Öronen | `gemini-3.6-flash` | REST `generateContent`, ljud inline som `audio/wav` |
| Minnet | `gemini-3.6-flash` | REST `generateContent`, strukturerad JSON (schema i PROMPTER.md) |
| Förbered underlag (PDF till text, karta) | `gemini-3.6-flash` | REST `generateContent` |
| Rösten | `gemini-3.8-live` (befintliga `MODEL_NAME`) | WebSocket Live API, som i dag |

- Ny konstant `TEXT_MODEL = 'gemini-3.6-flash'` bredvid `MODEL_NAME`.
- REST-anrop: `POST https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent`
  med nyckeln i headern `x-goog-api-key`, inte i URL:en.
- Strukturerad utdata: `generationConfig.responseMimeType = 'application/json'` plus schema. Kontrollera
  om modellen vill ha `responseSchema` eller `responseJsonSchema` innan du bygger.
- Öronen: temperatur 0 och minsta möjliga tänkande, eftersom det ska gå fort. Minnet: standardinställning.
- Live-setup (fältnamn enligt Live API-referensen): `model`, `generationConfig`, `systemInstruction`,
  `realtimeInputConfig.automaticActivityDetection.disabled`, `inputAudioTranscription: {}`,
  `outputAudioTranscription: {}`. Serversvar: `serverContent.modelTurn`, `.turnComplete`, `.interrupted`,
  `.inputTranscription.text`, `.outputTranscription.text`, samt `usageMetadata`, `goAway` och `error`.
- Gemini 3.8 Live tar emot `clientContent` under hela sessionen. Det används för att skicka in de allra
  senaste sekunderna efter att sessionen öppnats (avsnitt 9.2).

## 5. Integration i den befintliga appen

**Filstruktur.** Nästan hela läget ligger i en ny fil, `bankgrannen.js`, som laddas med en vanlig
`<script src="bankgrannen.js"></script>` efter huvudskriptet. Ingen modul och ingen build. I `index.html` läggs bara
markup, CSS, en post i `SECTIONS` och några små krokar. Det avviker från principen om en enda fil,
men annars blir `index.html` svår att underhålla. Promptarna ligger som konstanter i `bankgrannen.js` och
hålls i synk med PROMPTER.md.

**Nya identifierare skrivs på engelska.** Befintliga svenska namn (`snacka`, `byggVu`, `stilla` …) lämnas som de är.

**Krokar i `index.html`:**

1. `SECTIONS.bankgrannen = { title:'BÄNKGRANNEN', tagline:'En AI på seminariet', voice:'Gacrux', systemInstruction:null, idleLine:'Redo', idleSub:'Förbered seminariet och börja lyssna', greeting:null, badge:'Här lyssnar en AI · ljudet blir text hos Google · inget ljud sparas' }`.
   Rösten provas fram (avsnitt 17). I `bankgrannen.js` finns konstanten `PERSONA_NAME = 'Birgitta'`.
2. En knapp `<button type="button" data-goto="bankgrannen">Bänkgrannen</button>` i `.andra`.
3. Ett nytt vy-block `<div class="bank">` i `#viewCall`, synligt bara för `body.sect-bankgrannen`
   (samma mönster som `.snacka`/`sect-drom`). Dölj `.callhead`, `.caller` och `.hint` i läget.
4. **Mikrofonkrok.** I `startMic()`, i `workletNode.port.onmessage`, lägg till
   `if (typeof micHook === 'function') micHook(new Int16Array(e.data.buf), e.data.rms);` efter den befintliga logiken.
   `let micHook = null;` deklareras globalt. Befintliga sektioner sätter den aldrig och påverkas inte.
5. **VU-mätaren.** Gör `byggVu` återanvändbar (den tar ett svg-element och returnerar nål och ljus) och låt `vuLoop`
   driva den synliga mätaren. I bankläget följer nålen `max(rumsnivå, röstnivå)` när öronen eller rösten är igång.
6. **Tangentbord.** Den befintliga `keydown`-hanteraren skickar Escape till `goHome()`. Lägg
   `if (activeId === 'bankgrannen') return;` först i den, så att bankens egna `keydown`/`keyup`-hanterare (avsnitt 11) tar över.
7. **Lämna läget.** `goHome()` och tillbaka-knappen stoppar ett pågående seminarium bara efter att Lelle
   bekräftat det ("Avsluta seminariet?"). `beforeunload` sparar sessionen (avsnitt 12.5) och stänger ljudet.
8. **Init-ordning.** Huvudskriptet kör `goHome()` och hash-routingen sist, alltså innan `bankgrannen.js` har laddats.
   Lägg till en krok `if (typeof onSectionOpen === 'function') onSectionOpen(id);` sist i `openSection()`.
   `bankgrannen.js` definierar `onSectionOpen` och kontrollerar när den laddats om `activeId === 'bankgrannen'`.
   Då ritar den upp sin vy direkt, så att `#bankgrannen` fungerar som direktlänk.

**Delade resurser.** Bänkgrannen använder de globala ljudobjekten (`inCtx`, `outCtx`, `micStream`, `workletNode`,
`sourceNode`) och funktionerna `startMic`, `playChunk`, `stopPlayback`, `int16ToBase64`, `base64ToInt16`, `wsUrl`.
Den har en egen WebSocket (`bank.ws`) och ett eget tillstånd i objektet `bank`. Den rör aldrig den globala `ws`,
`callState` eller `cleanup()` under ett seminarium. Bara ett läge kan vara aktivt åt gången.

**Kör läget från GitHub Pages-adressen (https).** Kontrollera att IndexedDB och mikrofonen fungerar även vid
dubbelklick (`file://`). Om de inte gör det, skriv det i README.

## 6. Öronen

**Flöde:** mikrofonkroken, sedan buffert, sedan klippning, WAV, `generateContent` och till sist transkriptet.

- **Buffra** Int16-ramarna (128 samplingar à 8 ms). Håll löpande koll på rms per ram.
- **Tal eller tystnad** avgörs mot ett adaptivt brusgolv: tionde percentilen av rms de senaste 30 sekunderna.
  En ram räknas som tal om `rms > max(golv × 3, 0.008)`. Konstanterna ska gå att justera.
- **Klipp** när bufferten är minst `CHUNK_TARGET_S = 25` sekunder och det varit tyst i minst 600 ms.
  Tvångsklipp vid `CHUNK_MAX_S = 40`. Kortare än `CHUNK_MIN_S = 5` slås ihop med nästa bit.
- **Skicka inte tystnad.** Om mindre än 10 % av ramarna i en bit är tal kastas den utan anrop.
  Det sparar tokens, är bättre för integriteten och undviker att modellen hittar på text i tystnad.
- **Hoppa över egen röst.** Medan Bänkgrannen spelar upp ljud (`liveSources.size > 0`) och en halv sekund efteråt
  läggs inga ramar i örats buffert. Då hamnar inte dess röst i transkriptet två gånger.
- **WAV:** en RIFF-header på 44 byte plus PCM16 mono 16 kHz. 30 sekunder blir ungefär 1 MB, långt under gränsen på 20 MB per anrop.
- **Anrop:** `contents: [{ role:'user', parts:[ {text: TRANSCRIBE_PROMPT}, {inlineData:{mimeType:'audio/wav', data}} ] }]`.
  Prompten (med ordlistan inbakad) finns i PROMPTER.md.
- **Kö:** högst 2 anrop samtidigt. Resultaten sorteras in efter bitens startid.
- **Transkriptpost:** `{ id, t0, t1, src:'rum'|'fraga'|'bank', text, epoch }`. Tiden räknas i sekunder från seminariets start och visas som `mm:ss`.
- **Fel:** ett nytt försök efter 2 sekunder. Misslyckas det igen läggs en post in, `[transkriberingen föll bort mm:ss–mm:ss]`,
  och en liten varningsprick tänds. Öronen stoppas aldrig av ett fel.
- **Paus (P):** ramar ignoreras, bufferten töms utan att skickas och lampan blir grå.
- **Glöm senaste minuten (G):** poster där `t1 > nu − 60` tas bort, bufferten töms och `bank.epoch` ökas.
  Svar som kommer in senare från en äldre epoch slängs om de gäller tid efter gränsen. Minnet byggs sedan om direkt,
  utan tidigare anteckningar (avsnitt 8).

## 7. Underlaget

Panelen **Seminariet** nås via kugghjulet när läget är aktivt. Den har fälten:

- Titel, Målgrupp, Föreläsarens namn (förval "Lelle")
- **Ordlista**: namn och begrepp som ofta hörs fel (Förstärkaren, ENPS, Claude, Superkrafter …)
- **Underlag**: filer (`.md`, `.txt`, `.pdf`) och/eller inklistrad text
- Knappen **Förbered**

**Förbered** gör följande:

1. `.md` och `.txt` läses rakt av. En `.pdf` skickas inline till `TEXT_MODEL` med PDF-prompten, som återger texten ordagrant som markdown.
2. Allt sätts ihop med rubriken `### Fil: <namn>` för varje fil.
3. `TEXT_MODEL` bygger en **karta** över underlaget, 10 till 25 punkter med id `K1`, `K2` och så vidare (prompt och schema i PROMPTER.md).
4. Kartan visas som redigerbara rader (`K1 · rubrik · mening`) så att Lelle kan rätta och stryka innan han börjar.
5. En tokenuppskattning visas (tecken / 4). Över 50 000 tokens: gul varning. Över 80 000: Förbered stoppas med förklaringen att underlaget måste kortas, eftersom Live-sessionen tar högst 131 072 tokens.

**Lagring:** IndexedDB, databas `bankgrannen`, post `seminar`: `{ title, audience, speaker, glossary, sourceText, map, updatedAt }`.
Underlaget finns kvar när sidan laddas om. Knappen "Rensa underlag" tar bort det.
Under fältet står: *Lägg aldrig in material som kan röja en källa.*

Version 1 hanterar ett seminarium åt gången.

## 8. Minnet

- **När:** var `MEMORY_INTERVAL_S = 120` sekund om transkriptet har ändrats sedan förra gången, direkt efter att Bänkgrannen satt sig
  och direkt efter "Glöm". Aldrig två körningar samtidigt.
- **Indata:** seminariets metadata, kartan, **hela** transkriptet i formatet `[mm:ss] text` (egna repliker märkta `AI-DELTAGAREN:`,
  frågor till henne märkta `TILL AI-DELTAGAREN:`) och de tidigare anteckningarna för kontinuitet. Efter Glöm skickas inga tidigare anteckningar.
  Hela transkriptet för en timme är ungefär 12 000 tokens. Det är billigt, och det gör att minnet inte glider och att Glöm faktiskt glömmer.
- **Utdata:** JSON enligt schemat i PROMPTER.md: `lage`, `amnen`, `publikfragor`, `oklarheter`, `kvar_i_underlaget`, `handen`, `utelamnat`.
- **Handen, regler i klienten** (modellen föreslår, klienten avgör):
  - aldrig de första `HAND_EARLIEST_MIN = 5` minuterna
  - aldrig inom `HAND_COOLDOWN_MIN = 6` minuter efter förra gången Bänkgrannen hade ordet
  - handen sänks av sig själv efter 4 minuter om den inte fått ordet, eller när minnet sätter `uppe:false`
  - en blockerad hand syns inte, men sparas i anteckningarna så att Lelle kan se den med A
- **Anteckningsblocket** (avsnitt 10) visar minnet med rubrikerna *Hittills*, *Frågor från er*, *Det här hänger jag inte med på*, *Inte sagt än*.
- Varje punkt i minnet bär en tidpunkt. Den gör det möjligt att kontrollera att punkten verkligen finns i transkriptet, både vid generalrepetitionen och efteråt.

## 9. Rösten

### 9.1 Lägen

| Läge | Utlöses av | Bänkgrannen … |
|---|---|---|
| `HANDEN` | Ge ordet när handen är uppe | ställer sin fråga och säger vad den bygger på |
| `ORDET` | Ge ordet när handen är nere | säger kort vad den tänker på just nu, en tanke eller en fråga |
| `SAMMANFATTA` | S | sammanfattar hittills på högst en halv minut och avslutar med en fråga till rummet |
| `MISSAT` | M | tar upp en eller två punkter ur `kvar_i_underlaget` som nyfikenhet, inte som rättelse |
| `FRAGA` | håll mellanslag när ingen har ordet | tiger tills någon i rummet frågat klart och svarar sedan |

### 9.2 Öppna ordet

1. Stäng inget ljud. Mikrofonen och öronen fortsätter.
2. **Töm örats buffert** som en egen bit (utan minsta längd) och starta transkriberingen av den. Vänta inte på svaret.
3. Bygg systeminstruktionen: `PERSONA` med platshållarna ifyllda (PROMPTER.md) plus SEMINARIET, MINNE (anteckningarna som läsbar text),
   SENASTE MINUTERNA (transkriptposter sedan förra minnesuppdateringen och minst de senaste 3 minuterna, högst cirka 2 000 ord),
   DET DU SJÄLV SAGT TIDIGARE (de 6 senaste egna replikerna) och UNDERLAG (hela texten).
4. Öppna `bank.ws` och skicka setup. Rösten kommer från `SECTIONS.bankgrannen.voice` och språket är `sv-SE`. Ta med in- och utskrift.
   I turläget *Håll för att prata* (förval) sätts `realtimeInputConfig.automaticActivityDetection.disabled = true`.
5. Vid `setupComplete`:
   - om den tömda bitens transkribering har kommit, eller kommer inom 4 sekunder från knapptrycket, skickas den som
     `clientContent` (roll `user`, `turnComplete:false`) med texten från PROMPTER.md, *Precis innan du fick ordet*
   - skicka lägets trigger som `clientContent` med `turnComplete:true` (PROMPTER.md). `FRAGA` har ingen trigger
6. Status: "{PERSONA_NAME} harklar sig …" medan setup pågår. VU-nålen går i väntläge som i dag vid `connecting`.
7. Logga tiden till första ljud i konsolen (`console.info('[bank] floor', { mode, setupMs, firstAudioMs })`). Målet är högst 3 sekunder.

### 9.3 Under ordet

- **Ljud ut:** `modelTurn.parts[].inlineData` går till `playChunk()`. `interrupted` ger `stopPlayback()`.
- **Håll för att prata** (mellanslag eller knappen, med `pointerdown`/`pointerup`):
  - vid tryck: om Bänkgrannen pratar, anropa `stopPlayback()`. Skicka `realtimeInput.activityStart` och sätt `bank.pttHeld = true`
  - medan knappen hålls går mikrofonramarna till `realtimeInput.audio` och inte till öronen (samla gärna 5 ramar per meddelande)
  - vid släpp: skicka `realtimeInput.activityEnd`
  - trycks mellanslag innan sessionen hunnit öppnas (`FRAGA`) buffras ljudet från trycket. Efter `setupComplete`
    skickas `activityStart`, därefter bufferten och sedan resten som vanligt. De första orden får inte gå förlorade
- **Allt annat ljud** under ordet (när ingen håller mellanslag) går till öronen som vanligt. Svarar Lelle på Bänkgrannens fråga
  utan att hålla mellanslag hamnar svaret i transkriptet och i nästa minne, men inte i den pågående sessionen.
  Enkel regel: *håll mellanslag när du pratar till Bänkgrannen.*
- **Turläget Fritt samtal** (inställning): automatisk turtagning. Alla ramar går till Live medan ordet är öppet och öronen pausas.
  Rekommenderas bara med headset eller i ett litet rum.
- **Utskrifter:** `inputTranscription.text` byggs på till en post `src:'fraga'`. `outputTranscription.text` byggs på till en post
  `src:'bank'`. Posterna läggs i transkriptet när `turnComplete` kommer. Egna repliker sparas också i `bank.ownTurns`.
- **`usageMetadata`** går till kostnadsmätaren.
- **`goAway`** betyder att Bänkgrannen avrundar och sätter sig (stäng när uppspelningen är klar).

### 9.4 Sätta sig

- Esc eller "Tack, {PERSONA_NAME}" stänger direkt: `stopPlayback()`, sedan `bank.ws.close(1000)`.
- Automatiskt: 40 sekunder efter senaste `turnComplete` utan att någon hållit mellanslag, och först när uppspelningen är klar.
- Hårt tak: `FLOOR_MAX_MIN = 8`, med varning i statusraden vid 7 minuter. Det håller sessionen långt under uppkopplingsgränsen på cirka 10 minuter.
- Efter stängning: `bank.lastFloorAt = nu`, `bank.firstSpoken = true`, handen sänks och en minnesuppdatering körs.

## 10. Gränssnitt

Samma familj som AI-snack: Jost, glas, bärnstensljus och VU-mätaren. Ge läget en egen temaklass `body.sect-bankgrannen`
med mörkare och kallare bakgrund än `drom` (till exempel djup petrol mot svart), så att det syns att det är ett annat rum.
Använd TV4-rött sparsamt, bara i lyssnarlampan.

**A. Förberedelse** (innan seminariet startat)

- Rubrik "Bänkgrannen", underrad "En AI på seminariet"
- Ett kort med seminariets titel, underlagets storlek (tokens), antal punkter på kartan och en länk till panelen Seminariet
- Stor knapp i samma stil som Ring upp: **Börja lyssna**. Den öppnar startrutan (12.1) och startar sedan mikrofon och öron

**B. Under seminariet**

- Överst: "Bänkgrannen", seminariets titel i liten stil och en klocka (`mm:ss` sedan start)
- **Lyssnarlampan**, formad som en gammal studioskylt:
  - `LYSSNAR`: röd och glödande
  - `PAUS`: grå
  - `HAR ORDET`: bärnsten
  - en liten varningsprick vid transkriberingsfel
- **Handlampan** bredvid: släckt, eller tänd i bärnsten med en handikon och typetikett
  (*förtydligande*, *invändning*, *koppling*, *fördjupning*). Frågan själv syns inte, bara att den finns. Klick ger ordet (`HANDEN`)
- VU-mätaren
- Knapprad:
  - **Ge ordet** (primär, lyser när handen är uppe)
  - **Sammanfatta**
  - **Vad har vi missat?**
  - **Paus/Lyssna**
- När Bänkgrannen har ordet byts knapparna till **Håll för att prata** och **Tack, {PERSONA_NAME}**
- **Anteckningsblocket** (A, fällbart och dolt från början) visar minnet under fyra rubriker. Varje punkt har tiden i liten stil
- **Transkriptsvansen** (T, dold från början) visar de 6 senaste raderna i liten grå text
- Statusraden (`.status`) och märkningen (`.badge`) återanvänds

**C. Avsluta** via menyn eller vid Lämna:

- Rutan "Avsluta seminariet" har kryssrutan *Exportera anteckningar (.md)* (ikryssad från början) och kryssrutan
  *Ta med hela transkriptet* (inte ikryssad). Knappen **Radera allt och avsluta** raderar allt och stänger mikrofonen
- Exportfilen innehåller titel, datum, anteckningarna under de fyra rubrikerna, Bänkgrannens repliker med tider och, om Lelle valt det, transkriptet

**Miniläge:** när fönstret är smalare än 480 px visas bara lamporna, **Ge ordet** och **Paus**. Då kan Lelle lägga ett litet
webbläsarfönster i ett hörn bredvid presentationen.

**Tillgänglighet:** `aria-live` på statusen, träffytor på minst 44 px och `prefers-reduced-motion` respekteras (`stilla`).

**Inställningar** (kugghjulet i läget):

- Seminariet (avsnitt 7)
- Nyckel (befintlig ruta)
- Röst
- Turläge: *Håll för att prata* (förval) eller *Fritt samtal*
- Handen på/av
- Minnesintervall
- **Kostnadsmätare**: tokens hittills per del (öron, minne, röst), räknade ur `usageMetadata`

## 11. Kortkommandon

Gäller när Bänkgrannen-fönstret har fokus. Mellanslag får inte aktivera knappar som råkar ha fokus (`preventDefault`).

| Tangent | Gör |
|---|---|
| Enter | Ge ordet (`HANDEN` om handen är uppe, annars `ORDET`) |
| S | Sammanfatta |
| M | Vad har vi missat? |
| Mellanslag (håll) | Prata till Bänkgrannen. Om ingen har ordet öppnas `FRAGA` |
| Esc | Bänkgrannen sätter sig. Lämnar aldrig läget |
| P | Paus eller Lyssna |
| G | Glöm senaste minuten |
| A | Visa eller dölj anteckningsblocket |
| T | Visa eller dölj transkriptsvansen |

## 12. Integritet och källskydd

1. **Säg det i rummet.** Första gången Börja lyssna trycks under ett seminarium visas en ruta med startmanuset
   (PROMPTER.md). Lelle läser det med egna ord och trycker sedan **Nu kör vi**. Bänkgrannens första replik säger att den är en AI.
2. **Synligt hela tiden.** Lyssnarlampan och märkningen syns så länge öronen är på.
3. **Paus och glöm** (P och G) finns alltid ett tangenttryck bort.
4. **Inget ljud sparas.** Ljudbuffertar släpps när en bit skickats. Ingen `MediaRecorder` används och inga ljudfiler skapas.
5. **Text bara under seminariet.** Transkript, minne och egna repliker ligger i minnet och speglas i `sessionStorage`, så att
   en omladdning mitt i föredraget inte tömmer allt. Vid omladdning visas "Fortsätt seminariet?". Allt raderas vid
   Avsluta och när fliken stängs. Inget av detta går till `localStorage` eller IndexedDB. Export sker bara när Lelle väljer det.
6. **Filter i minnet.** Minnesprompten utelämnar namn på personer i publiken, källor, uppgifter om opublicerade jobb och andra
   personuppgifter och räknar dem i `utelamnat`. Personan upprepar aldrig sådant och ber Lelle pausa om det dyker upp.
7. **Workshops:** öronen ska vara av när deltagarna arbetar med eget material och på bara i helgrupp. Det står i startmanuset.
8. **Nyckeln:** använd en separat nyckel med fakturering och spendtak. Enligt Gemini API:s villkor får klienter som används av
   personer i EES bara använda betaltjänsten. Med betaltjänsten används indata inte för att förbättra Googles produkter.
   README säger i dag att nyckeln är gratis, och det behöver ändras (steg 8).
9. **I föredraget** är lampan och pausen ett konkret källskyddsmoment. Publiken ser vad det innebär att en AI lyssnar och hur man stänger av den.

## 13. Kostnad och gränser

Uppskattning per seminarietimme. Den faktiska siffran visas i kostnadsmätaren.

- **Öronen:** ljud räknas som 32 tokens per sekund, vilket blir ungefär 115 000 tokens per timme tal. Tystnad skickas inte.
- **Minnet:** cirka 30 körningar à 5 000 till 15 000 tokens (det växer med transkriptet), ungefär 300 000 tokens.
- **Rösten:** per gång ungefär systeminstruktionen (20 000 till 50 000 tokens, mest underlaget) plus ljud (25 tokens per sekund).
  Åtta gånger blir ungefär 250 000 till 450 000 tokens.
- **Totalt** i storleksordningen 0,7 till 1 miljon tokens per timme. Kolla aktuell prislista för Gemini API.

**Gränser:**

- Live-sessionen tar högst 131 072 tokens in, vilket räcker för underlag upp till cirka 60 000 tokens plus minne och transkript
- Ordet får vara öppet i högst 8 minuter, under uppkopplingsgränsen på cirka 10 minuter
- Inline-anrop får vara högst 20 MB

## 14. Byggordning

Stanna efter varje steg och låt Lelle testa.

| Steg | Innehåll | Klart när |
|---|---|---|
| 1 | Sektion, tema, knapp i `.andra`, `#bankgrannen`, statiskt gränssnitt (A och B) utan logik, miniläge | Läget öppnas från AI-snack och via direktlänk. Layouten håller på laptop och i smalt fönster. Esc lämnar inte läget |
| 2 | Mikrofonkroken och återanvändbar VU (avsnitt 5 punkt 4 och 5) | **Regressionstest:** AI-snack, Efter fem och von Essen ringer, pratar och lägger på som förut. VU:n i bankläget följer rösten |
| 3 | Öronen komplett (avsnitt 6) plus **testläget "Ljudfil som rum"**: en dold inställning där en inspelad ljudfil (mp3 eller wav) avkodas, samplas om till 16 kHz och matas genom samma kedja som mikrofonen | 3 minuters tal ger rimlig text med tider. Tystnad ger inga anrop. P och G fungerar. Egen röst hamnar inte i transkriptet. En inspelad fil går igenom kedjan |
| 4 | Underlaget (avsnitt 7) | En PDF och en md-fil blir text. Kartan kan redigeras. Tokenvarningen syns. Underlaget finns kvar efter omladdning |
| 5 | Minnet och handen (avsnitt 8) plus anteckningsblocket | Med testfilen: anteckningarna växer, varje punkt har en tid som går att hitta i transkriptet, handen följer spärrarna och Glöm tar bort innehåll |
| 6 | Rösten, alla fem lägen (avsnitt 9) | Varje läge ger ett relevant svar inom cirka 3 sekunder. Första gången säger den att den är en AI. Håll för att prata fungerar utan eko. Repliker och frågor hamnar i transkriptet. Den sätter sig av sig själv |
| 7 | Integritet (avsnitt 12): startrutan, sessionStorage med "Fortsätt?", Avsluta, export | Allt i 12.1 till 12.6 kan visas i praktiken. Efter Radera finns ingenting kvar i `sessionStorage` |
| 8 | Kostnadsmätaren, inställningarna, README (nytt avsnitt om Bänkgrannen och om betald nyckel). Ändra också "Skaffa en gratis" i nyckelrutan i `index.html` | Mätaren visar tokens per del. README och nyckelrutan beskriver läget, kortkommandona och nyckelkravet |

## 15. Generalrepetition

1. **Med ljudfil:** kör en inspelning av ett tidigare föredrag genom testläget (steg 3). Kontrollera:
   - att namnen i ordlistan transkriberas rätt
   - att varje punkt i anteckningarna finns i transkriptet vid angiven tid
   - hur ofta handen går upp (målet är en till tre gånger per halvtimme)
2. **Grundningstest:** ge ordet i alla lägen och lyssna efter påståenden om att något har sagts när det inte har det.
   Varje sådant fel noteras och leder till en justering av promptarna.
3. **Källskyddstest:** säg ett påhittat källnamn högt ("källan heter Testa Testsson på Skatteverket"). Det får inte finnas i
   anteckningarna, och Bänkgrannen får inte upprepa det. Den ska be om paus.
4. **I lokalen, med två eller tre kollegor:** avståndet till datormikrofonen, eko via högtalare eller PA, flödet med Håll för att prata,
   publikfrågor som Lelle upprepar ("frågan var …") och tiden till första ljud.
5. **Reserv:** om nätet eller nyckeln krånglar kör föredraget vidare utan Bänkgrannen. Inget i föredraget får hänga på den.

## 16. Inte i version 1

- En förvärmd Live-session som hålls öppen och får minnet via `clientContent` (om tiden till första ljud blir för lång)
- Ett alltid överst-fönster med Document Picture-in-Picture
- Flera sparade seminarier
- Telefonen som fjärrkontroll
- Talaridentifiering (vem som säger vad)
- Frågor från publiken via QR-kod

## 17. Öppna frågor till Lelle

1. **Namnen.** Bänkgrannen (läget) och Birgitta (karaktären) är arbetsnamn. Välj inte ett namn som
   publiken kan koppla till en verklig kollega.
2. **Anteckningsblocket.** Ska publiken se det? Det är pedagogiskt starkt att visa vad AI:n faktiskt har uppfattat, men det kan dra uppmärksamhet. Förval: dolt, visas med A.
3. **Rösten.** Prova Gacrux (i Googles röstlista beskriven som mogen) mot Kore (bestämd) och Pulcherrima (framåt). Lyssna särskilt på hur
   de låter på svenska och att den valda rösten finns i Live-modellen.
4. **Dataskydd.** Kollegornas röster och ord behandlas av Google under din nyckel. Stäm av med TV4:s dataskydd om information och
   frivillighet räcker, eller om det krävs ett avtal.
5. **Nyckeln.** Vilken betald nyckel ska användas, och med vilket spendtak?
