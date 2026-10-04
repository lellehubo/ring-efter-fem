# Telefontjänsten för Bänkgrannen

Tre små funktioner hos Twilio som låter Birgitta ringa från webbläsaren, så att rummet hör båda parter
(SPEC.md avsnitt 17). Telefonnumren finns bara här, i Twilio. Webbläsaren, repot och Birgitta ser dem aldrig.

| Funktion | Gör |
|---|---|
| `/token` | ger webbläsaren en tillfällig nyckel för Twilios Voice SDK (bara utgående samtal, giltig en timme) |
| `/kontakter` | ger telefonlistan utan nummer: id, namn, roll och ärende |
| `/ring` | skyddad, bara Twilio kan anropa den. Slår upp numret och ringer. Okända kontakter avvisas |

`/token` och `/kontakter` kräver telefonnyckeln (`BANK_KEY`) och svarar bara sidor i `ALLOWED_ORIGINS`.
Inga samtal spelas in.

## Engångsinställning

**1. Verktygen** (en gång per dator)

```
npm install -g twilio-cli
twilio login
twilio plugins:install @twilio-labs/plugin-serverless
```

**2. I Twilio-konsolen**

- **API-nyckel:** Account › API keys & tokens › Create API key, typ *Standard*. Spara SID (`SK…`) och hemligheten.
- **Sverige:** Voice › Settings › Geo permissions. Slå på Sverige.
- **Avsändare:** Phone Numbers › Manage › Verified Caller IDs. Verifiera din mobil och använd den som `CALLER_ID`.
  Ett amerikanskt nummer på displayen besvaras sällan. Det befintliga numret och kopplingen till ElevenLabs påverkas inte.

**3. Inställningarna**

```
cd twilio
cp .env.example .env
```

Fyll i `.env`. Skapa telefonnyckeln med

```
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

`.env` committas aldrig. Lägg den inte heller i Slack eller mejl.

**4. Driftsätt**

```
twilio serverless:deploy
```

Skriv upp domänen i svaret, till exempel `https://bankgrannen-telefon-1234-dev.twil.io`.

**5. TwiML-appen**

Voice › Manage › TwiML apps › Create. *Voice Request URL* = `https://<domänen>/ring`, metod POST.
Lägg appens SID (`AP…`) som `TWIML_APP_SID` i `.env` och driftsätt igen.

**6. Twilios SDK i appen** (i repots rot)

```
node tools/hamta-twilio-sdk.mjs
git add vendor && git commit -m "Twilios Voice SDK"
```

**7. I Bänkgrannen**

Kugghjulet eller **Seminariet** › Telefon: klistra in domänen och telefonnyckeln och tryck **Testa och hämta listan**.
Båda sparas bara i webbläsaren.

## Telefonlistan

`CONTACTS` i `.env` är en JSON-lista på en rad:

```
CONTACTS='[{"id":"anna","namn":"Anna","nummer":"+46701234567","roll":"producent","arende":"Hur ni testar nya moment","samtycke":"2026-10-04"}]'
```

- **Bara den som sagt ja i förväg.** Personen ska ha gått med på att bli uppringd av en AI under ett föredrag, vid en
  tidpunkt hen inte vet, att höras i högtalare inför publik, och att samtalet behandlas av Google och Twilio.
  Helst skriftligt; ett mejl räcker. Datumet står i `samtycke`. Kontakter utan samtycke eller med ogiltigt nummer tas bort automatiskt.
- **Aldrig källor**, uppgiftslämnare eller personer i pågående granskningar.
- `id` är det enda webbläsaren skickar när den ringer. Använd korta id utan personuppgifter.

Ändrar du listan: driftsätt igen, eller ändra miljövariabeln direkt i konsolen (Functions and Assets › Services › Environment variables).

## Prova först (labbet, SPEC 17.10)

Ring din egen mobil, som står på listan. Kontrollera bland annat att fel nyckel nekas, att `/ring` avvisar okända
kontakter, tiden från Ring till signal och från svar till hennes första ord, hur hon förstår svenska över telefonljud,
att båda parter hörs i rummet och alla sätt att avsluta: hon lägger på, du lägger på, Esc, inget svar och röstbrevlåda.

## Kostnad

Samtal till svenska mobiler debiteras per minut enligt Twilios prislista, plus Geminis röstsessioner. Se Twilios samtalslogg
efter labbet. Där finns också nummer, tid och längd för varje samtal kvar, även om inget spelas in.
