create table if not exists road_weather_stations (
  id bigint primary key,
  device_name text,
  road_number text,
  road_name text,
  kilometer double precision,
  x_coord double precision,
  y_coord double precision,
  lat double precision,
  lon double precision,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists road_weather_observations (
  station_id bigint not null references road_weather_stations(id) on delete cascade,
  collected_at_utc timestamptz not null,
  collected_at_unix bigint,
  air_temp double precision,
  wind_speed_avg double precision,
  precipitation_type text,
  precipitation_amount double precision,
  surface_temp double precision,
  visibility double precision,
  dew_point double precision,
  surface_condition text,
  freezing_point double precision,
  wind_speed_max double precision,
  wind_direction text,
  friction_coefficient double precision,
  structure_temp_007 double precision,
  structure_temp_020 double precision,
  structure_temp_050 double precision,
  structure_temp_080 double precision,
  structure_temp_110 double precision,
  structure_temp_130 double precision,
  structure_temp_140 double precision,
  structure_temp_170 double precision,
  structure_temp_200 double precision,
  fetched_at timestamptz not null default timezone('utc', now()),
  primary key (station_id, collected_at_utc)
);

create index if not exists road_weather_observations_collected_at_idx
  on road_weather_observations (collected_at_utc desc);

create table if not exists road_weather_alerts (
  station_id bigint not null,
  collected_at_utc timestamptz not null,
  code text not null,
  name text not null,
  primary key (station_id, collected_at_utc, code),
  foreign key (station_id, collected_at_utc)
    references road_weather_observations(station_id, collected_at_utc)
    on delete cascade
);

create index if not exists road_weather_alerts_code_idx
  on road_weather_alerts (code);

drop trigger if exists road_weather_stations_set_updated_at on road_weather_stations;
create trigger road_weather_stations_set_updated_at
before update on road_weather_stations
for each row
execute function set_updated_at();
