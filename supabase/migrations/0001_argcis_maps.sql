create extension if not exists pgcrypto;

create table if not exists exercise_scenarios (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users (id) on delete set null,
  name text not null,
  description text,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists exercise_geometries (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references exercise_scenarios (id) on delete cascade,
  name text not null,
  geometry jsonb not null,
  centroid_lng double precision,
  centroid_lat double precision,
  h3_index text,
  created_at timestamptz not null default now()
);

create table if not exists exercise_activities (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references exercise_scenarios (id) on delete cascade,
  geometry_id uuid references exercise_geometries (id) on delete set null,
  name text not null,
  activity_type text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists saved_maps (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users (id) on delete set null,
  name text not null,
  description text,
  active_time_utc timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists saved_map_layers (
  id uuid primary key default gen_random_uuid(),
  saved_map_id uuid not null references saved_maps (id) on delete cascade,
  layer_id text not null,
  ordering integer not null default 0,
  visible boolean not null default true,
  opacity numeric(4, 3) not null default 1,
  filters jsonb not null default '{}'::jsonb,
  active_time_utc timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists forecast_frames_raw (
  id bigint generated always as identity primary key,
  source_id text not null,
  source text not null check (source in ('meteo', 'road')),
  layer_id text not null,
  forecast_time_utc timestamptz not null,
  location_name text not null,
  latitude double precision not null,
  longitude double precision not null,
  h3_index text not null,
  geometry jsonb not null,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_id, layer_id, forecast_time_utc)
);

create table if not exists risk_frames (
  forecast_time_utc timestamptz primary key,
  generated_at timestamptz not null default now(),
  raw_feature_count integer not null default 0,
  hex_cell_count integer not null default 0
);

create table if not exists risk_hex_cells (
  forecast_time_utc timestamptz not null,
  h3_index text not null,
  geometry jsonb not null,
  center_lng double precision not null,
  center_lat double precision not null,
  risk_score integer not null default 0,
  risk_level text not null check (risk_level in ('green', 'yellow', 'red')),
  risk_reasons jsonb not null default '[]'::jsonb,
  recommended_action text not null,
  summary text not null,
  raw_metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (forecast_time_utc, h3_index)
);

create index if not exists idx_exercise_activities_window
  on exercise_activities (starts_at, ends_at);

create index if not exists idx_exercise_geometries_h3
  on exercise_geometries (h3_index);

create index if not exists idx_saved_map_layers_saved_map
  on saved_map_layers (saved_map_id, ordering);

create index if not exists idx_forecast_frames_raw_time
  on forecast_frames_raw (forecast_time_utc, layer_id);

create index if not exists idx_risk_hex_cells_time
  on risk_hex_cells (forecast_time_utc);

create index if not exists idx_risk_hex_cells_center
  on risk_hex_cells (center_lng, center_lat);

alter table exercise_scenarios enable row level security;
alter table exercise_geometries enable row level security;
alter table exercise_activities enable row level security;
alter table saved_maps enable row level security;
alter table saved_map_layers enable row level security;
alter table forecast_frames_raw enable row level security;
alter table risk_frames enable row level security;
alter table risk_hex_cells enable row level security;

create policy "exercise read authenticated"
  on exercise_scenarios
  for select
  to authenticated
  using (true);

create policy "exercise manage own"
  on exercise_scenarios
  for all
  to authenticated
  using (owner_id = auth.uid() or owner_id is null)
  with check (owner_id = auth.uid() or owner_id is null);

create policy "exercise geometries read authenticated"
  on exercise_geometries
  for select
  to authenticated
  using (true);

create policy "exercise geometries manage authenticated"
  on exercise_geometries
  for all
  to authenticated
  using (true)
  with check (true);

create policy "exercise activities read authenticated"
  on exercise_activities
  for select
  to authenticated
  using (true);

create policy "exercise activities manage authenticated"
  on exercise_activities
  for all
  to authenticated
  using (true)
  with check (true);

create policy "saved maps read own"
  on saved_maps
  for select
  to authenticated
  using (owner_id = auth.uid() or owner_id is null);

create policy "saved maps manage own"
  on saved_maps
  for all
  to authenticated
  using (owner_id = auth.uid() or owner_id is null)
  with check (owner_id = auth.uid() or owner_id is null);

create policy "saved map layers read authenticated"
  on saved_map_layers
  for select
  to authenticated
  using (
    exists (
      select 1
      from saved_maps
      where saved_maps.id = saved_map_layers.saved_map_id
        and (saved_maps.owner_id = auth.uid() or saved_maps.owner_id is null)
    )
  );

create policy "saved map layers manage authenticated"
  on saved_map_layers
  for all
  to authenticated
  using (
    exists (
      select 1
      from saved_maps
      where saved_maps.id = saved_map_layers.saved_map_id
        and (saved_maps.owner_id = auth.uid() or saved_maps.owner_id is null)
    )
  )
  with check (
    exists (
      select 1
      from saved_maps
      where saved_maps.id = saved_map_layers.saved_map_id
        and (saved_maps.owner_id = auth.uid() or saved_maps.owner_id is null)
    )
  );

create policy "forecast read authenticated"
  on forecast_frames_raw
  for select
  to authenticated
  using (true);

create policy "risk frames read authenticated"
  on risk_frames
  for select
  to authenticated
  using (true);

create policy "risk cells read authenticated"
  on risk_hex_cells
  for select
  to authenticated
  using (true);
