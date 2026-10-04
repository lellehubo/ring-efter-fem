# AI-snack

Röstsamtal med en AI, byggt till föredraget *Drömverktyg*. Startsidan är **AI-snack**: en VU-mätare
vars nål följer rösterna, en 1980-talslur och en Ring upp-knapp. Samma app har också två äldre
samtal, *Efter fem* och *AI × von Essen*, och läget **Bänkgrannen** (en AI-deltagare på seminarier, se nedan).
Alla nås via små knappar uppe till vänster. Direktlänkar: `#drom` (AI-snack), `#efterfem`, `#ai`, `#bankgrannen`.

Huvudsakligen en fil, `index.html`. Ingen build, inget backend. Bänkgrannen ligger i egna filer bredvid. Fungerar som ett telefonsamtal:
tryck på mikrofonen, prata, lägg på. Rösten är TV4:s *Efter fem*, driven av Gemini Live API
direkt från webbläsaren.

## Kör den

Öppna `index.html` lokalt (dubbelklick funkar) eller besök GitHub Pages-sidan. Första gången:
klicka på kugghjulet uppe till höger och klistra in en **Gemini API-nyckel** (skapas på
[aistudio.google.com/apikey](https://aistudio.google.com/apikey)). Används appen av personer i EU
kräver Googles villkor en betald nyckel: sätt ett spendtak på den. Tryck sedan på mikrofonen.

## GitHub Pages

`index.html` ligger i repo-roten. Aktivera under **Settings → Pages → Branch: `main` / root**.
Sidan blir tillgänglig på `https://<användarnamn>.github.io/ring-efter-fem/` inom någon minut.

## Viktigt om nyckeln

Eftersom det inte finns något backend pratar sidan direkt med Google från klienten. Nyckeln
sparas **bara i den egna webbläsaren** (`localStorage`) – aldrig i filen eller i git-historiken.
Var och en ser bara sin egen inmatade nyckel. Inför en skarp demo:

- Skapa en **separat engångsnyckel** (inte produktionsnyckeln).
- Sätt en **spendgräns/budget** på den i Google AI Studio.
- **Ta bort nyckeln** i AI Studio efteråt.
- Dela inte skärmen så nyckelrutan syns, och sprid inte länken + nyckeln vidare.

Vill man ha noll nyckel i klienten krävs en liten serverdel som utfärdar tillfälliga tokens –
mer än vad en ren Pages-sida rymmer.

## 15-minutersgräns

Google begränsar rena ljudsessioner till 15 minuter. Appen varnar i statusraden strax innan –
lägg på och ring upp igen så börjar en ny session.

## Byta modell, röst eller innehåll

Överst i `<script>` (sök efter `MODEL_NAME` och `VOICE_NAME`) byts modell och röst utan att röra
resten. Kunskapen om veckans sändningar ligger i `SYSTEM_INSTRUCTION` i samma script – det är den
enda strängen som byts ut inför en ny vecka. Tonen är grundad i [`efter-fem-persona.md`](./efter-fem-persona.md),
den gemensamma röstreferensen bakom både denna app och Claude-versionen.

## Not

Byggt mot Googles dokumenterade meddelandeformat för Live API. Testkör en runda själv innan
skarpt läge.

## Bänkgrannen

En AI-deltagare på föredrag och workshops: **Birgitta**. Hon sitter med i rummet, svarar när hon blir
tilltalad, sammanfattar och ger mothugg, och kan ringa ett telefonsamtal som hela rummet hör.
Specifikationen finns i [`specs/bankgrannen/SPEC.md`](./specs/bankgrannen/SPEC.md) och alla promptar i
[`specs/bankgrannen/PROMPTER.md`](./specs/bankgrannen/PROMPTER.md).

**Det som är byggt är den smala versionen** (SPEC 15.1): hon hör bara det som sägs till henne när någon håller
i talknappen. Att lyssna på hela seminariet, räcka upp handen och ratten kommer i den fulla versionen.

### Roller

| Roll | För | Hon är |
|---|---|---|
| **Skeptikern** | AI-föredrag | en erfaren, lite cynisk kollega som står på publikens sida och ger föreläsaren mothugg |
| **Dramaturgen** | programutveckling | dramaturg och tv-producent, sparringpartner i idéarbetet kring formatet Robinson |

Rollen väljs i **Seminariet** (kugghjulet i Bänkgrannen). Där laddas också underlaget upp: kunskapsbasen
(.md, .txt eller .pdf) eller inklistrad text. För Dramaturgen är det kunskapsbasen om Robinson. Underlaget sparas
bara i webbläsaren (IndexedDB) och skickas till Google varje gång hon kopplas upp. **Lägg aldrig in något som kan röja en källa.**

### Kortkommandon

| Tangent | Gör |
|---|---|
| Mellanslag (håll) | prata med henne. Under ett samtal: prata i luren |
| Enter | ge henne ordet |
| S | be henne sammanfatta |
| R | ring någon på telefonlistan |
| Esc | tysta henne, avbryt ett samtal eller låt henne sätta sig |
| T | visa de senaste replikerna |
| Skift + 1 / 2 | telefonen Av / Fråga först |

Vill hon själv ringa frågar hon först, och ett kort visas på skärmen. Samtalet rings bara när du trycker Enter på kortet.

### Telefonen

Samtalen går från webbläsaren via Twilio, så att rummet hör båda parter. Inställningen beskrivs i
[`twilio/README.md`](./twilio/README.md). Twilios SDK hämtas med `node tools/hamta-twilio-sdk.mjs` och läggs i `vendor/`.
Utan telefontjänsten fungerar allt annat som vanligt.

### Promptarna

Ändra alltid i `specs/bankgrannen/PROMPTER.md` och kör sedan

```
node tools/prompter-till-js.mjs
```

som skriver om `bankgrannen-prompter.js`. Ändra aldrig den filen för hand.

### Test

`node tests/bankgrannen.cjs` kör hela flödet i Chromium med låtsas-Gemini, låtsas-Twilio och falsk mikrofon:
de andra sektionerna, Seminariet, talknappen, samtalskortet, ett samtal från uppringning till rapport, Avsluta och Fortsätt.
Inget når Google eller Twilio. Kräver Playwright.

### Integritet

Inget ljud sparas. Samtalen finns bara under seminariet (i webbläsarens sessionStorage) och raderas när du trycker
**Avsluta**, med möjlighet att exportera dem som en .md-fil först. Det du säger till henne behandlas av Google, och
telefonsamtal också av Twilio. Inga samtal spelas in.
