# Personal Webpage

Tims personliga webbplats. Första delen är en träningsdashboard som hämtar Garmin-data via Garmin Connect Personal API och visar den på en mobilanpassad sida bakom Cloudflare Access.

Sidan har fyra flikar:

- **Översikt:** dagens plan med vad du bör göra och undvika, utifrån mätvärdena och vilka kroppsdelar dina senaste pass belastat, och förslag på pass från Persist-arkivet, nyckeltal, återhämtning (HRV mot ditt band, vilopuls, sömn), form och trötthet, tid per vecka, monotoni och strain, pulszoner, kalender och senaste passen.
- **Pass:** alla pass med sök, typfilter, sortering på valfritt mått och sparade vyer (filter, sortering och diagram). Varje pass öppnas med mått enligt passtypens profil, vilotid, puls över tid från FIT-filen (Banister TRIMP, aerob avkoppling), jämförelse mot liknande pass och loggat CrossFit-pass.
- **Trender:** kort per passtyp, till exempel effektivitetsfaktor, puls vid fast tempo, löpvolym och intensitetsfördelning för löpning, och TRIMP, zon 4–5, benchmarks och rörelser för HIIT.
- **Data:** lagring, vad Garmin svarar för dygnsdata, puls för beräkningar, Persist-import, inställningar som JSON och datakartan.

Allt på Översikt och Trender går att anpassa i webbläsaren med knappen **Anpassa**: flytta, dölj och lägg till egna kort. Trender har en egen layout per passgrupp. Inställningarna sparas i databasen.

Belastning (TRIMP) är Edwards TRIMP: varje minut i pulszon 1–5 ger 1–5 poäng, så 10 minuter i zon 4 ger 40. Metodval och källor finns i dokumentet Träningsmetriker och datalagring.

## Struktur

| Fil | Innehåll |
| --- | --- |
| `src/index.js` | Cloudflare Worker: Access-kontroll, Garmin, lagring i D1, loggade pass, Persist-arkivet |
| `src/page.html` | Sidans HTML och CSS. Klientkoden läggs in där `/*APP*/` står |
| `src/client/*.client.js` | Klientkoden: grunder, diagram, metriker, FIT-läsning, vyer, dagens plan, anpassning, loggning, start |
| `wrangler.toml` | Cloudflare-konfiguration |
| `test/run.mjs` | Tester mot låtsade Garmin-, Access- och Claude-svar (`npm test`) |

## Driftsättning

Cloudflare bygger och publicerar automatiskt vid varje push till `main` (Workers Builds). Workerns namn i Cloudflare måste vara `personal-webpage`, samma som i `wrangler.toml`.

Hemligheterna läggs in i Cloudflare under **Settings → Variables and Secrets**, som typ **Secret**:

| Namn | Värde |
| --- | --- |
| `GARMIN_API_KEY` | Nyckeln från Garmin Connect → Settings → Personal API |
| `POLICY_AUD` | Application Audience (AUD) Tag från Cloudflare Access |
| `TEAM_DOMAIN` | `https://<team>.cloudflareaccess.com` |
| `ANTHROPIC_API_KEY` | Valfri. Läser CrossFit-pass från skärmdumpar. Skapas på console.anthropic.com och betalas per anrop |

Utan `POLICY_AUD` och `TEAM_DOMAIN` svarar Workern 403 på allt. Varje förfrågan måste ha en giltig, signerad Access-token, så sidan är stängd även om Access av misstag stängs av.

## Lagring

En Cloudflare D1-databas med bindningen `DB` sparar:

| Tabell | Innehåll | Sparas |
| --- | --- | --- |
| `activities` | Garmin-pass, rådata plus färdiga kolumner (tid, distans, puls, kalorier, TRIMP) | 62 dagar |
| `daily` | Dygnsdata: HRV, vilopuls, sömn, Body Battery, stress, steg | 62 dagar |
| `logs` | Loggade CrossFit-pass | Utan tidsgräns |
| `persist` | Persist-arkivet, importerat från sidan | Utan tidsgräns |
| `settings` | Layout, egna kort, vyer, profiler | Utan tidsgräns |

62 dagar räcker för 42 dagars kronisk belastning och HRV-baslinjen. Workern hämtar nya pass högst var tionde minut, dygnsdata högst varannan halvtimme, och läser om hela fönstret en gång per dygn. Äldre data hämtas från Garmin när sidan behöver den och sparas inte.

Tabellerna skapas automatiskt första gången Workern använder databasen. Utan bindningen fungerar sidan direkt mot Garmin, men loggade pass och Persist-förslag kräver databasen.

Garmins svar för dygnsdata är inte dokumenterade. Workern letar efter poster med datum och kända fältnamn, och Data-fliken visar vad som hittades.

## Säkerhet

- Repot är publikt och innehåller ingen data och inga nycklar. Allt sådant finns bara i Cloudflare.
- Ändringar (synk, inställningar, loggade pass, import) tas bara emot från sidan själv, med kontroll av `Origin`.
- Garmin-nyckeln finns bara som hemlighet i Cloudflare, aldrig i koden eller i webbläsaren.
- Personal API är skrivskyddat. Nyckeln kan tas bort i Garmin Connect när som helst.
- Sidan har en strikt Content-Security-Policy och laddar inget från andra domäner.
