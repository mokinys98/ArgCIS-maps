alter table if exists risk_hex_cells
  add column if not exists signal_count integer not null default 0;

alter table if exists risk_hex_cells
  add column if not exists red_signal_count integer not null default 0;

alter table if exists risk_hex_cells
  add column if not exists yellow_signal_count integer not null default 0;

alter table if exists risk_hex_cells
  add column if not exists confidence_multiplier double precision not null default 0;
