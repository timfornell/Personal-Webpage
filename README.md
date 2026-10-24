# Personal Webpage

Tims personliga webbplats. Första delen är en träningsdashboard som hämtar Garmin-data via Garmin Connect Personal API och visar den på en mobilanpassad sida bakom Cloudflare Access. Just nu är den en prototyp för att se vilken data Garmin ger.

Sidan har fyra flikar:

- **Översikt:** nyckeltal för vald period jämfört med föregående, tid per vecka per träningsform, belastningsbalans (senaste veckan mot fyra veckors snitt), pulszoner, kalender och senaste passen.
- **Pass:** alla pass grupperade per vecka med sök, typfilter och sortering. Varje pass öppnas i en detaljvy med pulszoner, jämförelse mot dina andra pass av samma typ och övningar som klockan registrerat.
- **Trender:** snittpuls, längd och löptempo över tid, andel hård pulstid per vecka, mest tränade rörelser och när i veckan du tränar.
- **Data:** hämta tre års historik och kör datakartan, som listar alla fält Garmin skickar.

Zonpoäng är en egen uppskattning av belastning: minuter i varje pulszon gånger zonens nummer.

## Struktur

| Fil | Innehåll |
| --- | --- |
| `src/index.js` | Cloudflare Worker: kontroll av Access-inloggning, Garmin-token, API-rutter |
| `src/page.html` | Sidan som visas i webbläsaren |
| `wrangler.toml` | Cloudflare-konfiguration |
| `test/run.mjs` | Tester mot låtsade Garmin- och Access-svar (`npm test`) |

## Driftsättning

Cloudflare bygger och publicerar automatiskt vid varje push till `main` (Workers Builds). Workerns namn i Cloudflare måste vara `personal-webpage`, samma som i `wrangler.toml`.

Tre hemligheter läggs in i Cloudflare under **Settings → Variables and Secrets**, som typ **Secret**:

| Namn | Värde |
| --- | --- |
| `GARMIN_API_KEY` | Nyckeln från Garmin Connect → Settings → Personal API |
| `POLICY_AUD` | Application Audience (AUD) Tag från Cloudflare Access |
| `TEAM_DOMAIN` | `https://<team>.cloudflareaccess.com` |

Utan `POLICY_AUD` och `TEAM_DOMAIN` svarar Workern 403 på allt. Varje förfrågan måste ha en giltig, signerad Access-token, så sidan är stängd även om Access av misstag stängs av.

## Säkerhet

- Repot är publikt och innehåller ingen data och inga nycklar. Allt sådant finns bara i Cloudflare.
- Garmin-nyckeln finns bara som hemlighet i Cloudflare, aldrig i koden eller i webbläsaren.
- Personal API är skrivskyddat. Nyckeln kan tas bort i Garmin Connect när som helst.
- Sidan har en strikt Content-Security-Policy och laddar inget från andra domäner.
