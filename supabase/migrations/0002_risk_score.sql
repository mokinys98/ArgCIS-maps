alter table if exists risk_hex_cells
  add column if not exists risk_score integer not null default 0;
