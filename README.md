# ArgCIS Maps

ArgCIS Maps yra atskiras hostinamas web produktas virs egzistuojancio ingest backend'o, kuris renka `meteo.lt` ir `eismoinfo.lt` duomenis i `Supabase`. Sis repo apima:

- `apps/web` - React + Vite interaktyvu zemelapi
- `apps/risk-worker` - Cloudflare Worker API ir sintetiniu risk/forecast sluoksniu job'us
- `packages/shared` - bendrus tipus, risk taisykles ir demo fixtures
- `supabase/migrations` - ArgCIS Maps lenteles ir RLS politika

## Architektura

Esamas ingest produktas lieka atskiras ir nekeiciamas. ArgCIS Maps skaito is to paties `Supabase` projekto ir prideda savo modelius:

- pratybu scenarijus, veiklas ir geometrijas
- issaugotus zemelapiu preset'us
- animacinius forecast kadrus
- H3 pagrindu sugeneruotas risk celes

Jei ingest lenteles ar view dar nepasiekiamos, `Risk API Worker` gali veikti demo rezimu ir rodyti sintetinius duomenis.

## Repo struktura

```text
apps/
  risk-worker/
  web/
packages/
  shared/
supabase/
  migrations/
```

## Pagrindines funkcijos

- interaktyvus MapLibre zemelapis su deck.gl overlay
- layer katalogas baziniams ir calculated sluoksniams
- 7 dienu forecast animacija 3 valandu segmentais
- H3 resolution 6 risk layer su paaiskinimais
- pratybu veiklu overlay ir risk suvestines
- issaugomi vartotojo layer preset'ai
- Supabase Auth vidiniams vartotojams

## Reikalingi aplinkos kintamieji

### `apps/risk-worker`

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`
- `APP_ORIGIN`
- `ALLOW_ANON_READ` - `true` tik lokaliam demo naudojimui
- `USE_DEMO_DATA` - `true`, jei ingest saltiniai dar nesujungti
- `H3_RESOLUTION` - default `6`

Papildomai galima nurodyti view pavadinimus, is kuriu workeris skaitys ingest duomenis:

- `METEO_SOURCE_VIEW` - default `argcis_ingest_meteo_feed`
- `ROAD_SOURCE_VIEW` - default `argcis_ingest_road_feed`

### `apps/web`

- `VITE_API_BASE_URL`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_OSM_TILE_URL` - default `https://tile.openstreetmap.org/{z}/{x}/{y}.png`
- `VITE_DEMO_MODE` - `true`, jei reikia dirbti be auth ir be realaus API

## Paleidimas

1. `npm install`
2. `npm run dev:worker`
3. `npm run dev:web`

## Supabase migracijos

Paleisk:

1. `supabase/migrations/0001_argcis_maps.sql`

Sis migracijos failas sukuria Maps lenteles, indeksus ir RLS politikas. Ingest lenteles is kito backend produkto siame repo nekuriamos.

Jei naudojama ta pati `Supabase` DB kaip ingest backend'ui, papildomai paleisk:

2. `supabase/API-Database-structure/0004_argcis_ingest_views.sql`

Sis failas sukuria `argcis_ingest_meteo_feed` ir `argcis_ingest_road_feed` view ant esamu ingest lenteliu.

## Testai

- `npm run test`

Testai dengia:

- risk threshold logika
- H3 agregacija ir sintetiniu kadru generavima
- API atsako formu sudaryma is worker service sluoksnio

## Dabartine integracijos prielaida

`Risk API Worker` pirmiausia skaito ingest saltinius is `Supabase` view:

- `argcis_ingest_meteo_feed`
- `argcis_ingest_road_feed`

Siame repo jau yra SQL failas, kuris sukuria view pagal realia ingest schema:

- `supabase/API-Database-structure/0004_argcis_ingest_views.sql`

View turi pateikti bent:

- `source_id`
- `forecast_time_utc`
- `latitude`
- `longitude`
- `location_name`
- `metrics` JSON objektas

`metrics` viduje workeris iesko siu raktu:

- `wind_gust_ms`
- `wind_speed_ms`
- `visibility_m`
- `thunder_probability`
- `precipitation_mm`
- `road_ice`
- `road_restriction`
- `surface_state`

Esamose ingest lentelese ne visi signalai egzistuoja tiesiogiai, todel view dalis reiksmiu aproksimuoja:

- `thunder_probability` meteo view nustatomas pagal `condition_code`
- `road_ice` road view nustatomas pagal `surface_condition`
- `road_restriction` road view nustatomas pagal `road_weather_alerts`

Jei view neegzistuoja arba duomenu nera, demo rezimas sugeneruoja pavyzdinius forecast ir risk sluoksnius, kad frontend butu is karto naudojamas.
