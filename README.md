# Efter fem – ring upp

En enda fil, `index.html`. Ingen build, inget backend. Fungerar som ett telefonsamtal:
tryck på mikrofonen, prata, lägg på. Rösten är TV4:s *Efter fem*, driven av Gemini Live API
direkt från webbläsaren.

## Kör den

Öppna `index.html` lokalt (dubbelklick funkar) eller besök GitHub Pages-sidan. Första gången:
klicka på kugghjulet uppe till höger och klistra in en **Gemini API-nyckel** (gratis på
[aistudio.google.com/apikey](https://aistudio.google.com/apikey)). Tryck sedan på mikrofonen.

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
