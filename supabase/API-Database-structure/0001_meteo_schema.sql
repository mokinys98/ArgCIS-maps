create extension if not exists pgcrypto;

create table if not exists meteo_stations (
  code text primary key,
  name text not null,
  type text,
  lat double precision,
  lon double precision,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists meteo_station_obs (
  station_code text not null references meteo_stations(code) on delete cascade,
  observation_time_utc timestamptz not null,
  air_temp double precision,
  feels_like_temp double precision,
  wind_speed double precision,
  wind_gust double precision,
  wind_dir double precision,
  cloud_cover double precision,
  sea_level_pressure double precision,
  rel_humidity double precision,
  precipitation double precision,
  snow_depth double precision,
  condition_code text,
  fetched_at timestamptz not null default timezone('utc', now()),
  primary key (station_code, observation_time_utc)
);

create index if not exists meteo_station_obs_observation_time_idx
  on meteo_station_obs (observation_time_utc desc);

create table if not exists meteo_places (
  code text primary key,
  name text not null,
  administrative_division text,
  country_code text,
  lat double precision,
  lon double precision,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists meteo_forecast_runs (
  id uuid primary key default gen_random_uuid(),
  place_code text not null references meteo_places(code) on delete cascade,
  forecast_type text not null,
  forecast_creation_time_utc timestamptz not null,
  fetched_at timestamptz not null default timezone('utc', now()),
  unique (place_code, forecast_type, forecast_creation_time_utc)
);

create index if not exists meteo_forecast_runs_place_created_idx
  on meteo_forecast_runs (place_code, forecast_creation_time_utc desc);

create table if not exists meteo_forecast_points (
  run_id uuid not null references meteo_forecast_runs(id) on delete cascade,
  forecast_time_utc timestamptz not null,
  air_temp double precision,
  feels_like_temp double precision,
  wind_speed double precision,
  wind_gust double precision,
  wind_dir double precision,
  cloud_cover double precision,
  sea_level_pressure double precision,
  rel_humidity double precision,
  total_precipitation double precision,
  condition_code text,
  primary key (run_id, forecast_time_utc)
);

create index if not exists meteo_forecast_points_time_idx
  on meteo_forecast_points (forecast_time_utc desc);

create table if not exists ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  status text not null check (status in ('running', 'success', 'partial', 'failed')),
  note text
);

create index if not exists ingestion_runs_started_at_idx
  on ingestion_runs (started_at desc);

create table if not exists meteo_sync_state (
  key text primary key,
  last_synced_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists meteo_stations_set_updated_at on meteo_stations;
create trigger meteo_stations_set_updated_at
before update on meteo_stations
for each row
execute function set_updated_at();

drop trigger if exists meteo_places_set_updated_at on meteo_places;
create trigger meteo_places_set_updated_at
before update on meteo_places
for each row
execute function set_updated_at();

drop trigger if exists meteo_sync_state_set_updated_at on meteo_sync_state;
create trigger meteo_sync_state_set_updated_at
before update on meteo_sync_state
for each row
execute function set_updated_at();
