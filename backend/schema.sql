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

-- Nueva tabla de perfiles
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  date_of_birth date not null,
  weight_kg numeric not null,
  height_cm numeric not null,
  sex text not null,
  weekly_activity_description text not null,
  goal text not null,
  avatar_url text,
  daily_calorie_goal integer,
  calorie_goal_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Migración para añadir meta calórica a perfiles existentes si la tabla ya fue creada
alter table public.profiles
  add column if not exists daily_calorie_goal integer,
  add column if not exists calorie_goal_updated_at timestamptz;

-- ============================================================
-- Tabla de resúmenes diarios persistidos y cierre de día
-- El cierre de los días se realiza estrictamente a las 00:00 de horario uruguayo (America/Montevideo, UTC-3)
-- ============================================================
create table if not exists public.daily_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'anonymous',
  date date not null default (timezone('America/Montevideo', now()))::date,
  conclusion_text text,
  total_calories numeric not null default 0,
  total_protein numeric not null default 0,
  total_carbs numeric not null default 0,
  total_fat numeric not null default 0,
  meal_count integer not null default 0,
  closed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Migraciones seguras para compatibilidad con esquemas anteriores
alter table public.daily_summaries
  alter column conclusion_text drop not null;

-- Asegurar que la fecha por defecto de la tabla use la zona horaria de Uruguay (cambio a las 00:00 hora local)
alter table public.daily_summaries
  alter column date set default (timezone('America/Montevideo', now()))::date;

alter table public.daily_summaries
  add column if not exists total_calories numeric not null default 0,
  add column if not exists total_protein numeric not null default 0,
  add column if not exists total_carbs numeric not null default 0,
  add column if not exists total_fat numeric not null default 0,
  add column if not exists meal_count integer not null default 0,
  add column if not exists closed_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- Restricción única para idempotencia: un único resumen por usuario y fecha
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'daily_summaries_user_date_unique'
  ) then
    alter table public.daily_summaries
      add constraint daily_summaries_user_date_unique unique (user_id, date);
  end if;
end $$;

create index if not exists daily_summaries_user_date_idx
  on public.daily_summaries (user_id, date desc);

-- ============================================================
-- RLS para daily_logs: cada usuario solo ve/modifica sus datos
-- ============================================================
alter table public.daily_logs enable row level security;

-- Política de lectura
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'daily_logs' and policyname = 'Users can read own logs'
  ) then
    create policy "Users can read own logs" on public.daily_logs
      for select using (user_id = auth.uid()::text);
  end if;
end $$;

-- Política de inserción
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'daily_logs' and policyname = 'Users can insert own logs'
  ) then
    create policy "Users can insert own logs" on public.daily_logs
      for insert with check (user_id = auth.uid()::text);
  end if;
end $$;

-- Política de actualización
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'daily_logs' and policyname = 'Users can update own logs'
  ) then
    create policy "Users can update own logs" on public.daily_logs
      for update using (user_id = auth.uid()::text) with check (user_id = auth.uid()::text);
  end if;
end $$;

-- Política de eliminación
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'daily_logs' and policyname = 'Users can delete own logs'
  ) then
    create policy "Users can delete own logs" on public.daily_logs
      for delete using (user_id = auth.uid()::text);
  end if;
end $$;

-- ============================================================
-- RLS para daily_summaries
-- ============================================================
alter table public.daily_summaries enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'daily_summaries' and policyname = 'Users can read own summaries'
  ) then
    create policy "Users can read own summaries" on public.daily_summaries
      for select using (user_id = auth.uid()::text);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'daily_summaries' and policyname = 'Users can insert own summaries'
  ) then
    create policy "Users can insert own summaries" on public.daily_summaries
      for insert with check (user_id = auth.uid()::text);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'daily_summaries' and policyname = 'Users can update own summaries'
  ) then
    create policy "Users can update own summaries" on public.daily_summaries
      for update using (user_id = auth.uid()::text) with check (user_id = auth.uid()::text);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'daily_summaries' and policyname = 'Users can delete own summaries'
  ) then
    create policy "Users can delete own summaries" on public.daily_summaries
      for delete using (user_id = auth.uid()::text);
  end if;
end $$;

-- ============================================================
-- RLS para profiles
-- ============================================================
alter table public.profiles enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'profiles' and policyname = 'Users can read own profile'
  ) then
    create policy "Users can read own profile" on public.profiles
      for select using (user_id = auth.uid());
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'profiles' and policyname = 'Users can insert own profile'
  ) then
    create policy "Users can insert own profile" on public.profiles
      for insert with check (user_id = auth.uid());
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'profiles' and policyname = 'Users can update own profile'
  ) then
    create policy "Users can update own profile" on public.profiles
      for update using (user_id = auth.uid());
  end if;
end $$;
