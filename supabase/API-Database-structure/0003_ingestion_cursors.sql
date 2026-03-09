create table if not exists ingestion_cursors (
  key text primary key,
  cursor text,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists ingestion_cursors_set_updated_at on ingestion_cursors;
create trigger ingestion_cursors_set_updated_at
before update on ingestion_cursors
for each row
execute function set_updated_at();

create or replace function ensure_meteo_forecast_run(
  p_place_code text,
  p_forecast_type text,
  p_forecast_creation_time_utc timestamptz,
  p_fetched_at timestamptz default timezone('utc', now())
)
returns table (run_id uuid, inserted boolean)
language plpgsql
as $$
declare
  v_run_id uuid;
begin
  insert into meteo_forecast_runs (
    place_code,
    forecast_type,
    forecast_creation_time_utc,
    fetched_at
  )
  values (
    p_place_code,
    p_forecast_type,
    p_forecast_creation_time_utc,
    p_fetched_at
  )
  on conflict (place_code, forecast_type, forecast_creation_time_utc) do nothing
  returning id into v_run_id;

  if v_run_id is not null then
    return query select v_run_id, true;
    return;
  end if;

  select id
    into v_run_id
    from meteo_forecast_runs
   where place_code = p_place_code
     and forecast_type = p_forecast_type
     and forecast_creation_time_utc = p_forecast_creation_time_utc
   limit 1;

  return query select v_run_id, false;
end;
$$;

create or replace function get_latest_meteo_station_obs(
  p_station_codes text[]
)
returns table (
  station_code text,
  observation_time_utc timestamptz
)
language sql
as $$
  select
    station_code,
    max(observation_time_utc) as observation_time_utc
  from meteo_station_obs
  where station_code = any(p_station_codes)
  group by station_code
$$;

create or replace function get_latest_road_weather_observations(
  p_station_ids bigint[]
)
returns table (
  station_id bigint,
  collected_at_utc timestamptz
)
language sql
as $$
  select
    station_id,
    max(collected_at_utc) as collected_at_utc
  from road_weather_observations
  where station_id = any(p_station_ids)
  group by station_id
$$;
