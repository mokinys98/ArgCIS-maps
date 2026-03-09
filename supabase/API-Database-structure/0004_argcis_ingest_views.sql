create or replace view public.argcis_ingest_meteo_feed as
with latest_runs as (
  select distinct on (mfr.place_code)
    mfr.id,
    mfr.place_code,
    mfr.forecast_type,
    mfr.forecast_creation_time_utc
  from public.meteo_forecast_runs mfr
  where mfr.forecast_type = 'long-term'
  order by mfr.place_code, mfr.forecast_creation_time_utc desc
)
select
  lr.place_code || ':' || mfp.forecast_time_utc::text as source_id,
  mfp.forecast_time_utc,
  mp.lat as latitude,
  mp.lon as longitude,
  mp.name as location_name,
  jsonb_build_object(
    'air_temperature_c', mfp.air_temp,
    'wind_speed_ms', mfp.wind_speed,
    'wind_gust_ms', mfp.wind_gust,
    'visibility_m', null,
    'precipitation_mm', mfp.total_precipitation,
    'thunder_probability',
      case
        when mfp.condition_code ilike '%thunder%' then 100
        when mfp.condition_code ilike '%storm%' then 100
        else null
      end,
    'surface_state', mfp.condition_code
  ) as metrics
from public.meteo_forecast_points mfp
join latest_runs lr
  on lr.id = mfp.run_id
join public.meteo_places mp
  on mp.code = lr.place_code
where mp.lat is not null
  and mp.lon is not null;

create or replace view public.argcis_ingest_road_feed as
select
  rwo.station_id::text || ':' || rwo.collected_at_utc::text as source_id,
  rwo.collected_at_utc as forecast_time_utc,
  rws.lat as latitude,
  rws.lon as longitude,
  coalesce(
    nullif(rws.device_name, ''),
    concat_ws(' ', rws.road_number, rws.road_name),
    'Road station ' || rws.id::text
  ) as location_name,
  jsonb_build_object(
    'air_temperature_c', rwo.air_temp,
    'wind_speed_ms', rwo.wind_speed_avg,
    'wind_gust_ms', rwo.wind_speed_max,
    'visibility_m', rwo.visibility,
    'precipitation_mm', rwo.precipitation_amount,
    'thunder_probability', null,
    'road_ice',
      case
        when lower(coalesce(rwo.surface_condition, '')) like '%ice%' then true
        when lower(coalesce(rwo.surface_condition, '')) like '%snow%' then true
        when lower(coalesce(rwo.surface_condition, '')) like '%slippery%' then true
        else false
      end,
    'road_restriction',
      exists (
        select 1
        from public.road_weather_alerts rwa
        where rwa.station_id = rwo.station_id
          and rwa.collected_at_utc = rwo.collected_at_utc
      ),
    'surface_state', rwo.surface_condition
  ) as metrics
from public.road_weather_observations rwo
join public.road_weather_stations rws
  on rws.id = rwo.station_id
where rws.lat is not null
  and rws.lon is not null;
