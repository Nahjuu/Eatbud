-- Ejecuta este archivo una vez en el SQL Editor de Supabase.
-- Es seguro volver a ejecutarlo: no elimina registros existentes.

create extension if not exists pgcrypto;

create table if not exists public.daily_logs (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'anonymous',
  food_text text not null,
  parsed_data jsonb not null,
  logged_at timestamptz not null default now()
);

-- Migración para instalaciones anteriores que solo tenían
-- `ai_estimated_calories`. Conserva todos los registros existentes.
alter table public.daily_logs
  add column if not exists parsed_data jsonb;

update public.daily_logs
set parsed_data = jsonb_build_object(
  'foods', jsonb_build_array(),
  'totals', jsonb_build_object('calories', 0, 'protein', 0, 'carbs', 0, 'fat', 0)
)
where parsed_data is null;

alter table public.daily_logs
  alter column parsed_data set not null;

create index if not exists daily_logs_user_logged_at_idx
  on public.daily_logs (user_id, logged_at desc);
