# ArgCIS Maps

`ArgCIS Maps` yra atskiras web produktas virs egzistuojancio ingest backend'o, kuris renka `meteo.lt` ir `eismoinfo.lt` duomenis i `Supabase`. Sio repo tikslas yra tuos duomenis:

- suvienodinti i bendrus sluoksnius;
- paversti i rizikos signalus;
- agreguoti i H3 gardeles;
- parodyti zemelapyje laike ir erdveje;
- susieti su pratybu scenarijais, veiklomis ir issaugotais preset'ais.

Jei nori greitai suprasti, kaip viskas veikia, pradek nuo siu failu:

- `apps/web/src/App.tsx` - pagrindinis frontend srautas.
- `apps/web/src/components/MapCanvas.tsx` - kaip sluoksniai atvaizduojami zemelapyje.
- `apps/risk-worker/src/index.ts` - visi HTTP endpoint'ai ir scheduler entrypoint.
- `apps/risk-worker/src/repository.ts` - duomenu paemimas is `Supabase` ir rasymas atgal.
- `apps/risk-worker/src/risk-engine.ts` - forecast -> H3 -> risk transformacijos.
- `packages/shared/src/risk.ts` - pagrindine rizikos logika.
- `supabase/migrations/0001_argcis_maps.sql` - aplikacijos lenteles, indeksai ir RLS.

## Kas sis repo yra ir kuo jis nera

Sis repo nera pirminis duomenu ingest sprendimas. Jis pats neparsisiuncia duomenu is `meteo.lt` ar `eismoinfo.lt`. Tam yra atskiras backend produktas, kuris duomenis sukaupia `Supabase`.

Sis repo:

- skaito ingest duomenis is `Supabase` view arba susijusiu lenteliu;
- is ju sugeneruoja zemelapio kadrus ir H3 rizikos celes;
- pateikia API frontend'ui;
- leidzia dirbti su scenarijais, veiklomis ir issaugotais zemelapiais;
- gali veikti demo rezimu be realios integracijos.

## Auksto lygio architektura

```text
                +----------------------+
                |  External ingest     |
                |  meteo.lt + road     |
                +----------+-----------+
                           |
                           v
                +----------------------+
                |      Supabase        |
                | ingest tables/views  |
                | app tables           |
                +----+-------------+---+
                     |             |
     read/write      |             | auth
                     v             v
            +-----------------------------+
            | apps/risk-worker            |
            | Cloudflare Worker API       |
            | + scheduled recompute       |
            +-------------+---------------+
                          |
                       HTTP JSON
                          |
                          v
            +-----------------------------+
            | apps/web                    |
            | React + Vite + MapLibre     |
            | + deck.gl overlay           |
            +-----------------------------+
```

Pagrindine ideja:

1. Ingest produktas uzpildo `Supabase`.
2. `risk-worker` skaito taskinius signalus.
3. Worker'is normalizuoja juos i 3 valandu forecast segmentus.
4. Signalai agreguojami i H3 celes ir issaugomi lentelese.
5. Frontend'as skaito jau paruostus kadrus, celes ir veiklu duomenis.

## Repo struktura

```text
apps/
  risk-worker/   Cloudflare Worker API + recompute logika
  web/           React aplikacija su zemelapiu
packages/
  shared/        bendri tipai, risk taisykles, laiko util'ai, demo duomenys
supabase/
  migrations/    aplikacijos lenteles ir schema papildymai
  API-Database-structure/
                 ingest schemos ir view failai
```

## Moduliu atsakomybes

### `apps/web`

Frontend aplikacija:

- uzkrauna layer kataloga, scenarijus, veiklas ir issaugotus preset'us;
- valdo prisijungima per `Supabase Auth`;
- keicia pasirinktus sluoksnius ir laika;
- uzkrauna `frame` ir `hex` API atsakus;
- atvaizduoja zemelapi per `MapLibre GL` ir `deck.gl`.

Svarbiausi failai:

- `apps/web/src/App.tsx`
  - pagrindinis state management;
  - initial load;
  - laiko keitimas;
  - preset'u issaugojimas ir pritaikymas;
  - sprendimas, kada kviesti `frame`, `hex` ir `activities` endpoint'us.
- `apps/web/src/lib/api.ts`
  - vienas HTTP klientas visam frontend'ui;
  - palaiko ir realu API, ir demo atsakus;
  - slepia `fetch` detales.
- `apps/web/src/lib/auth.ts`
  - sukuria `Supabase` kliento instance;
  - automatiskai ijungia demo rezima, jei truksta env kintamuju.
- `apps/web/src/components/MapCanvas.tsx`
  - inicializuoja `MapLibre` zemelapi;
  - stebi `bbox` ir `zoom`;
  - is `frame` ir `hex` duomenu pastato deck.gl sluoksnius.
- `apps/web/src/components/LayerPanel.tsx`
  - layer toggle UI;
  - preset'o issaugojimas ir pritaikymas.
- `apps/web/src/components/ActivityPanel.tsx`
  - rodo scenarijus ir veiklas su priskirta rizika.
- `apps/web/src/components/Timeline.tsx`
  - 7 dienu laiko juosta kas 3 val.;
  - play/pause animacija.

### `apps/risk-worker`

Serverio dalis, paleista kaip `Cloudflare Worker`:

- validuoja env konfiguracija;
- tvarko auth;
- pateikia read/write API frontend'ui;
- skaito duomenis is `Supabase`;
- per scheduler arba rankiniu budu perskaiciuoja risk artefaktus.

Svarbiausi failai:

- `apps/risk-worker/src/index.ts`
  - route dispatch;
  - `OPTIONS` CORS apdorojimas;
  - `scheduled()` hook kas valanda.
- `apps/risk-worker/src/config.ts`
  - env -> typed config;
  - `SUPABASE_SERVICE_ROLE_KEY` validacija;
  - `ALLOW_ANON_READ` ir `USE_DEMO_DATA` interpretacija.
- `apps/risk-worker/src/auth.ts`
  - Bearer token validacija per `Supabase Auth`.
- `apps/risk-worker/src/http.ts`
  - JSON atsakai;
  - CORS header'iai;
  - query param parsing (`bbox`, `layers`).
- `apps/risk-worker/src/repository.ts`
  - visas darbas su `Supabase`;
  - forecast signalu skaitymas;
  - scenariju, veiklu, preset'u CRUD;
  - recompute pipeline I/O.
- `apps/risk-worker/src/risk-engine.ts`
  - taskiniu signalu transformacija i H3 risk celes;
  - frame atsaku formavimas;
  - veiklu risk priskyrimas.

### `packages/shared`

Bendras kodas abiems aplikacijoms:

- tipai ir response shape'ai;
- layer katalogas;
- forecast laiko util'ai;
- risk threshold ir agregavimo logika;
- demo mode fixture'iai.

Svarbiausi failai:

- `packages/shared/src/types.ts`
- `packages/shared/src/layers.ts`
- `packages/shared/src/time.ts`
- `packages/shared/src/risk.ts`
- `packages/shared/src/demo.ts`

### `supabase`

DB schema siame repo dalinasi i dvi dalis:

- `supabase/migrations/`
  - ArgCIS Maps aplikacijos lenteles;
  - indeksai;
  - RLS taisykles.
- `supabase/API-Database-structure/`
  - ingest schema;
  - ingest view failai, kuriais remiasi worker'is.

## Pagrindinis runtime srautas

### 1. Frontend paleidimas

Atidarius `apps/web`:

1. `App.tsx` pasitikrina, ar yra auth, ar reikia demo rezimo.
2. Jei auth aktyvus, paima esama sesija is `Supabase`.
3. Tada uzkrauna:
   - layer kataloga;
   - issaugotus zemelapius;
   - scenarijus.
4. Atsizvelgdamas i pasirinkta laika, matoma `bbox` ir aktyvius sluoksnius, frontend'as uzklausia:
   - `GET /api/map/frame`
   - `GET /api/map/hex` tik jei reikalingas `risk-hex` arba `h3-grid-outline`
   - `GET /api/exercise-activities`

### 2. `frame` endpoint'o srautas

`GET /api/map/frame?time=...&layers=...`

Worker'is:

1. suapvalina laika iki artimiausio 3 val. segmento;
2. pasiima galimus laikus per `buildTimeline()`;
3. pasiima `forecast_frames_raw` eilutes konkreciam laikui;
4. papildomai pasiima `exercise_geometries`;
5. pasiima aktyvias veiklas pasirinktame laike;
6. sujungia visa tai i `MapFrameResponse`.

Svarbi detale: keliu oro taskams worker'is papildomai naudoja `listLatestRoadRowsByStation()`, kuris leidzia parodyti naujausia zinoma stoties taska net jei tiksliai tam segmentui tasko nera. Lookback langas yra `12` valandu.

### 3. `hex` endpoint'o srautas

`GET /api/map/hex?time=...&bbox=...`

Worker'is:

1. skaito `risk_hex_cells` pasirinktame laike;
2. pavercia DB eilutes i `RiskHexCellRow`;
3. jei perduotas `bbox`, filtruojama pagal H3 celes centra;
4. grazina:
   - `cells` su pilna rizikos informacija;
   - `outline_cells` konturu sluoksniui.

### 4. `recompute` srautas

`POST /api/internal/recompute?time=...`

Tai svarbiausia serverine operacija. Ji:

1. sugeneruoja 7 dienu laiko juosta kas 3 val.;
2. nuskaitytus ingest signalus isskleidzia per visa forecast laiko juosta;
3. kiekvienam taskui priskiria H3 indeksa;
4. sugrupuoja taskus pagal `forecast_time_utc + h3_index`;
5. apskaiciuoja H3 celes `risk_score`, `risk_level`, `risk_reasons`;
6. perraso esamus artefaktus tame laiko lange:
   - `forecast_frames_raw`
   - `risk_hex_cells`
   - `risk_frames`

Tas pats srautas paleidziamas ir scheduler'yje kas valanda per `wrangler` cron:

```toml
[triggers]
crons = ["0 * * * *"]
```

### 5. Veiklu rizikos priskyrimas

Kai uzklausiamos aktyvios veiklos:

1. pasiimamos veiklos, kuriu `starts_at <= time <= ends_at`;
2. uzkraunamos susijusios geometrijos;
3. uzkraunamos `risk_hex_cells` to paties laiko momentui;
4. veiklai ieskoma tinkama celes:
   - pirma pagal `geometry_h3_index`, jei toks yra;
   - jei jo nera, pagal artimiausia centroid'o centra;
5. veikla gauna `risk_score`, `risk_level`, `recommended_action`, `risk_summary`.

## Demo rezimas

Demo rezimas palaikomas ir frontend'e, ir worker'yje.

Frontend demo mode aktyvuojamas jei:

- `VITE_DEMO_MODE=true`, arba
- nera `VITE_SUPABASE_URL`, arba
- nera `VITE_SUPABASE_ANON_KEY`.

Worker demo mode aktyvuojamas jei:

- `USE_DEMO_DATA=true`.

Demo rezime:

- auth nera privalomas;
- API grazina sintetinius `frame`, `hex`, scenariju, veiklu ir preset'u duomenis;
- galima testuoti UI dar nesujungus realaus ingest.

Demo duomenys generuojami is `packages/shared/src/demo.ts`.

## Layer modelis

Visi sluoksniai deklaruojami `packages/shared/src/layers.ts`.

Esami sluoksniai:

- `meteo-forecast-points`
- `road-weather-points`
- `road-alerts`
- `exercise-areas`
- `risk-hex`
- `activity-risk`
- `h3-grid-outline`

Kiekvienas sluoksnis turi:

- `id`
- `name`
- `description`
- `kind`
- `render_type`
- `default_visible`
- `default_opacity`
- `color_hint`

Frontend'as pagal `render_type` ir `layer.id` nusprendzia, kaip sluoksni piesti:

- taskiniai `meteo` ir `road` sluoksniai piesti kaip `IconLayer`;
- `risk-hex` piestas kaip uzpildytos H3 celes;
- `h3-grid-outline` piestas tik konturais;
- `exercise-areas` ir `activity-risk` piesti kaip `GeoJsonLayer`.

## Frontend data flow detaliau

### State, kuri valdo visa UI

`App.tsx` laiko:

- `sessionToken`
- `layers`
- `layerState`
- `selectedTime`
- `frame`
- `hex`
- `savedMaps`
- `scenarios`
- `activities`
- `bbox`
- `isPlaying`
- `draftName`
- `uiError`

### Kaip aktyvus layer selection veikia uzklausas

`visibleLayerIds` apskaiciuojami is `layerState`.

Toliau:

- jei `risk-hex` arba `h3-grid-outline` nera aktyvus, `hex` endpoint'as net nekvieciamas;
- `frame` gauna tik aktyviu layer `id` sarasa;
- `bbox` siunciama tik `hex` endpoint'ui.

Tai reiskia, kad:

- raw taskai filtruojami serverio puseje pagal `layer_id`;
- H3 celes papildomai pjaunamos pagal matoma zemelapio langa.

### Zemelapio atvaizdavimas

`MapCanvas.tsx` daro kelis svarbius dalykus:

- sukuria `MapLibre` zemelapi;
- seka `moveend` ir siuncia atnaujinta `bbox` i parent komponenta;
- pagal `zoom` keicia tasku, ikoneliu ir konturu dydi;
- rodo popup'us is `properties`;
- uz Lietuvos ribu slepia dalyje sluoksniu, palikdamas tik didesnes prasmes sluoksnius:
  - `risk-hex`
  - `exercise-areas`
  - `activity-risk`

Popup'uose rodomi:

- `label`
- `risk_summary`
- `recommended_action`
- `risk_score`
- signalu skaicius
- confidence multiplier

### Preset'ai

Preset'as saugo:

- pavadinima;
- `active_time_utc`;
- sluoksniu sarasa;
- kiekvieno sluoksnio `visible`, `ordering`, `opacity`, `filters`.

Pritaikius preset'a:

- pakeiciamas aktyvus pavadinimas draft lauke;
- pakeiciamas laikas;
- perrasomas sluoksniu matomumas.

## Worker API

### `GET /health`

Grazina:

- `ok`
- `service`
- `demo_mode`
- `h3_resolution`

Naudinga greitam patikrinimui, ar worker'is gyvas ir kokia jo konfiguracija.

### `GET /api/map/layers`

Grazina `LayerCatalogResponse`.

Siuo metu layer katalogas ateina is shared kodo, ne is DB.

### `GET /api/map/frame`

Query parametrai:

- `time`
- `layers` kaip comma-separated sarasas

Grazina `MapFrameResponse`:

- `time`
- `available_times`
- `layers`
- `activities`

### `GET /api/map/hex`

Query parametrai:

- `time`
- `bbox=west,south,east,north`

Grazina `MapHexResponse`:

- `time`
- `cells`
- `outline_cells`

### `GET /api/internal/debug/forecast`

Debug endpoint'as. Padeda suprasti:

- ar ingest view turi duomenu reikiamam langui;
- ar worker'is turi `forecast_frames_raw`;
- ar sugeneruotas `risk_frame`;
- kokie artimi laikai yra DB.

Kai `frame` ar `hex` endpoint'ai atrodo tusti, pradek nuo sito endpoint'o.

### `GET /api/exercises`

Grazina scenariju sarasa is `exercise_scenarios`.

### `POST /api/exercises`

Sukuria scenariju. Jei perduota geometrija, papildomai sukuria ir `exercise_geometries` irasa.

### `GET /api/exercise-activities`

Grazina aktyvias veiklas pasirinktame laike, jau praturtintas rizikos duomenimis.

### `POST /api/exercise-activities`

Sukuria veikla ir grazina pradini objekta su `green` rizika. Tikras risk priskyrimas ateina per velesne read uzklausa pasirinktame laike.

### `GET /api/saved-maps`

Grazina vartotojo issaugotus zemelapius ir susijusius sluoksnius.

### `POST /api/saved-maps`

Sukuria nauja issaugota zemelapi ir jo sluoksniu irasus.

### `POST /api/internal/recompute`

Rankinis perskaiciavimas nurodytam laikui. Naudinga lokalioje aplinkoje arba debug'inant ingest integracija.

## Risk engine detaliau

Visa business logika sukoncentruota dviejose vietose:

- `packages/shared/src/risk.ts`
- `apps/risk-worker/src/risk-engine.ts`

### 1. Signalas -> taskinis risk summary

`evaluateRisk(metrics)` vertina viena taska.

Dabartines ribos:

- `thunder_probability >= 70` -> red, score bent `85`
- `thunder_probability >= 30` -> yellow, score bent `45`
- `wind_gust_ms >= 20` -> red, score bent `80`
- `wind_gust_ms >= 14` -> yellow, score bent `45`
- `visibility_m <= 300` -> red, score bent `90`
- `visibility_m <= 1000` -> yellow, score bent `40`
- `road_ice=true` arba `surface_state="ice"` -> red, score bent `95`
- `road_restriction=true` -> red, score bent `90`
- `precipitation_mm >= 10` -> yellow, score bent `35`

Taskinis rezultatas turi:

- `risk_score`
- `risk_level`
- `risk_reasons`
- `recommended_action`
- `risk_summary`

### 2. Taskai -> H3 celes risk summary

`aggregateRiskSummaries(items)` neleidzia vienam pavojingam taskui automatiskai padaryti visos celes raudonos.

Naudojama formule sudaryta is keliu daliu:

- vidutinio tasku score;
- raudonu / geltonu tasku dalies celeje;
- maksimalios tasko reiksmes;
- bonus'o keliu dominavimo atvejais.

Po to taikomas `confidence_multiplier`, kuris priklauso nuo signalu skaiciaus:

- `>= 5` signalai -> `1`
- `3-4` signalai -> `0.85`
- `2` signalai -> `0.7`
- `1` signalas -> `0.5`
- `0` signalu -> `0`

Taip celes, kuriu vertinimas paremtas mazai tasku, tampa atsargesnes.

### 3. Signal projection per timeline

`projectSignalsAcrossTimeline()` sugrupuoja signalus i serijas ir kiekvienam forecast laikui parenka:

- tikslu to laiko taska, jei jis egzistuoja;
- kita artimiausia laika, jei tikslus neegzistuoja.

Tai leidzia uzpildyti visa 7 dienu timeline net jei ingest duomenu tankis nelygus.

### 4. H3 geometrijos generavimas

Naudojamas `h3-js`:

- `latLngToCell()` taskui priskirti celes indeksa;
- `cellToBoundary()` poligonui nupiesti;
- `cellToLatLng()` centro koordinates apskaiciuoti.

### 5. Activity risk matching

`attachRiskToActivities()` priskiria veiklai rizika pagal:

- ta pacia H3 cele, jei `geometry_h3_index` uzpildytas;
- artimiausia celes centra, jei ne.

## Laiko modelis

Laiko util'ai yra `packages/shared/src/time.ts`.

Svarbios konstantos:

- `FORECAST_HORIZON_DAYS = 7`
- `FORECAST_SEGMENT_HOURS = 3`
- `FORECAST_SEGMENT_COUNT = 56`

Visi pagrindiniai skaiciavimai remiasi tuo, kad sistema operuoja 3 valandu forecast segmentais.

Naudojamos funkcijos:

- `floorToForecastSegment()`
- `roundToNearestForecastSegment()`
- `findClosestForecastTime()`
- `buildForecastTimeline()`

Jei laikas ateina ne idealiai ant segmento ribos, worker'is ir frontend'as ji suapvalina arba suderina su artimiausiu galimu.

## Duomenu saugojimas

### Aplikacijos lenteles

`supabase/migrations/0001_argcis_maps.sql` sukuria:

- `exercise_scenarios`
  - scenarijai;
  - turi `owner_id`, pavadinima, aprasyma, laiko ribas.
- `exercise_geometries`
  - scenariju geometrijos;
  - saugo `geometry`, centroid'a, galimai H3 indeksa.
- `exercise_activities`
  - veiklos su laiko intervalais;
  - gali buti susietos su geometrija.
- `saved_maps`
  - issaugoti vartotojo zemelapio preset'ai.
- `saved_map_layers`
  - issaugoto preset'o sluoksniai ir ju parametrai.
- `forecast_frames_raw`
  - normalizuoti taskiniai forecast signalai, kuriuos naudoja `frame` endpoint'as.
- `risk_frames`
  - laiko kadru santrauka su skaiciu statistika.
- `risk_hex_cells`
  - H3 celiu rizikos rezultatai.

Papildomos migracijos:

- `0002_risk_score.sql`
  - `risk_score` stulpelio papildymas.
- `0003_risk_hex_confidence.sql`
  - `signal_count`
  - `red_signal_count`
  - `yellow_signal_count`
  - `confidence_multiplier`

### RLS ir prieiga

RLS ijungtas visoms aplikacijos lentelese.

Esama logika:

- scenarijai skaitomi autentifikuotiems naudotojams;
- scenariju valdymas leidziamas savo arba `owner_id is null` irasams;
- saved maps skaitomi/valdomi pagal `owner_id`;
- risk lenteles skaitomos autentifikuotiems naudotojams.

Pastaba: jei worker'is paleistas su `ALLOW_ANON_READ=true`, API gali leisti skaityma be bearer token, nors DB skaitymui worker'is pats naudoja service role raktus.

## Ingest integracija

Worker'is tikisi bent siu view:

- `argcis_ingest_meteo_feed`
- `argcis_ingest_road_feed`

Ju default pavadinimai ateina is:

- `METEO_SOURCE_VIEW`
- `ROAD_SOURCE_VIEW`

Reikalingi laukai view rezultatuose:

- `source_id`
- `forecast_time_utc`
- `latitude`
- `longitude`
- `location_name`
- `metrics`

`metrics` viduje worker'is iesko:

- `wind_gust_ms`
- `wind_speed_ms`
- `visibility_m`
- `thunder_probability`
- `precipitation_mm`
- `road_ice`
- `road_restriction`
- `surface_state`

Papildomai keliu perspejimai skaitomi tiesiai is lenteliu:

- `road_weather_alerts`
- `road_weather_stations`

Alert'ai paverciami i papildomus `road-alerts` signalus.

Jei naudoji si repo su realia ingest schema, ziurek:

- `supabase/API-Database-structure/0001_meteo_schema.sql`
- `supabase/API-Database-structure/0002_eismo_weather.sql`
- `supabase/API-Database-structure/0003_ingestion_cursors.sql`
- `supabase/API-Database-structure/0004_argcis_ingest_views.sql`

## Aplinkos kintamieji

### Worker (`apps/risk-worker`)

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`
- `APP_ORIGIN`
- `ALLOW_ANON_READ`
- `USE_DEMO_DATA`
- `H3_RESOLUTION`
- `METEO_SOURCE_VIEW`
- `ROAD_SOURCE_VIEW`

Svarbios pastabos:

- `SUPABASE_SERVICE_ROLE_KEY` turi buti tikras server-side `service_role`, ne anon ir ne publishable key.
- `config.ts` default `H3_RESOLUTION` yra `6`, bet commit'intame `wrangler.toml` dev aplinkai nustatyta `5`.
- `APP_ORIGIN` gali buti `*` arba comma-separated allowed origin sarasas.

### Web (`apps/web`)

- `VITE_API_BASE_URL`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_OSM_TILE_URL`
- `VITE_DEMO_MODE`

## Lokalios aplinkos paleidimas

### 1. Priklausomybes

```bash
npm install
```

### 2. DB schema

Paleisk bent:

1. `supabase/migrations/0001_argcis_maps.sql`
2. `supabase/migrations/0002_risk_score.sql`
3. `supabase/migrations/0003_risk_hex_confidence.sql`

Jei nori realios ingest integracijos, papildomai turek ingest schema ir view:

4. `supabase/API-Database-structure/0004_argcis_ingest_views.sql`

### 3. Worker konfiguracija

Sutvarkyk `apps/risk-worker/wrangler.toml` ir atitinkamus secret/env.

Esamas failas numato:

- `APP_ORIGIN = "http://127.0.0.1:5173"`
- `ALLOW_ANON_READ = "true"`
- `USE_DEMO_DATA = "false"`
- `H3_RESOLUTION = "5"`

### 4. Paleisk worker'i

```bash
npm run dev:worker
```

### 5. Paleisk web aplikacija

```bash
npm run dev:web
```

### 6. Jei reikia perskaiciuoti artefaktus ranka

Yra helper script'as:

```bash
npm run recompute:dev
```

Jis kviecia:

```text
POST http://127.0.0.1:8787/api/internal/recompute?time=...
```

Jei nenurodysi laiko, script'as ims dabartini UTC laika.

## Testai

Repo root:

```bash
npm run test
```

Atskiri workspace'ai:

```bash
npm run test --workspace @argcis/shared
npm run test --workspace @argcis/risk-worker
```

Kas realiai testuojama:

- risk threshold logika;
- H3 agregacija;
- confidence multiplier taikymas;
- atvejai su vienu outlier tasku;
- frame ir hex response shape'ai;
- activity risk priskyrimas.

Web testu siuo metu nera.

## Dazniausi pakeitimu taskai

### Jei nori prideti nauja risk signala

Realiai reikia paliesti daugiau nei viena vieta:

1. ingest view arba saltini, kad naujas signalas patektu i `metrics`;
2. `packages/shared/src/types.ts`, jei reikia isskirto tipo;
3. `packages/shared/src/risk.ts`, kad signalas veiktu risk vertinima;
4. testus `packages/shared/tests` ir `apps/risk-worker/tests`;
5. jei reikia atskiro sluoksnio, `packages/shared/src/layers.ts`;
6. jei signalas turi matytis popup'uose ar kitaip renderintis, `MapCanvas.tsx`.

### Jei nori prideti nauja API endpoint'a

Paprastas kelias:

1. route aprasymas `apps/risk-worker/src/index.ts`;
2. duomenu logika `apps/risk-worker/src/repository.ts`;
3. jei reikia transformacijos, `apps/risk-worker/src/risk-engine.ts`;
4. frontend klientas `apps/web/src/lib/api.ts`;
5. UI komponentas arba `App.tsx`.

### Jei nori pakeisti, kaip piesiami sluoksniai

Ziurek:

- `packages/shared/src/layers.ts`
- `apps/web/src/components/MapCanvas.tsx`

### Jei nori pakeisti, kokios celes generuojamos

Ziurek:

- `apps/risk-worker/src/config.ts`
- `apps/risk-worker/wrangler.toml`
- `apps/risk-worker/src/risk-engine.ts`

Pagrindinis parametras yra `H3_RESOLUTION`.

## Dazniausi bug'ai ir kur ziureti

### `frame` tuscias

Tikrink:

- ar `recompute` buvo paleistas;
- ar `forecast_frames_raw` turi irasu pasirinktam laikui;
- ar `time` sutampa su 3 val. segmentu;
- ar neprifiltravote visko per `layers`.

Naudok:

- `GET /api/internal/debug/forecast`

### `hex` tuscias

Tikrink:

- ar `risk_hex_cells` turi irasu tam laikui;
- ar `bbox` ne per siauras;
- ar `risk-hex` sluoksnis apskritai ijungtas.

### Auth neveikia

Tikrink:

- ar web turi `VITE_SUPABASE_URL` ir `VITE_SUPABASE_ANON_KEY`;
- ar worker turi `SUPABASE_URL` ir `SUPABASE_ANON_KEY`;
- ar siunciamas `Authorization: Bearer ...`.

### Gauti duomenys, bet nieko nesimato zemelapyje

Tikrink:

- ar sluoksnis matomas `LayerPanel`;
- ar jo `render_type` atitinka `MapCanvas` logika;
- ar feature geometrija tikrai tinkamo tipo;
- ar zemelapio centras ne uz Lietuvos ribu, nes dalis sluoksniu tada slepiami.

## Projektines prielaidos ir apribojimai

- Sis repo remiasi egzistuojanciu ingest sprendimu.
- `frame` rodo raw signalus, bet `hex` remiasi is anksto sugeneruotomis celiu lentelemis.
- Keliu oro taskams taikomas iki 12 val. lookback, kad nebutu tusciu stociu.
- Activity risk priskyrimas pagal artimiausia celes centra yra pragmatiskas supaprastinimas.
- BBox filtravimas `hex` endpoint'e daromas pagal celes centra, ne pagal pilna poligono intersection.
- Layer katalogas dabar hardcode'intas shared pakete.

## Greitas skaitymo kelias naujam programuotojui

Jei prisijungei prie projekto pirmakart, siulytinas eiles tvarka:

1. perskaityk si `README`;
2. atsidaryk `packages/shared/src/types.ts`, kad suprastum response shape'us;
3. tada `packages/shared/src/risk.ts`, kad suprastum business logika;
4. tada `apps/risk-worker/src/index.ts` ir `repository.ts`, kad suprastum backend route'us;
5. tada `apps/risk-worker/src/risk-engine.ts`, kad suprastum kaip raw signalai virsta H3 risk;
6. galiausiai `apps/web/src/App.tsx` ir `MapCanvas.tsx`, kad suprastum UI srauta.

Po siu failu turetum suprasti:

- is kur ateina duomenys;
- kaip jie transformuojami;
- kur jie saugomi;
- kaip jie atvaizduojami;
- kur reikia daryti pakeitimus priklausomai nuo uzduoties.
