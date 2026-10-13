-- Timbang: per-user food log. Every table is private to its owner via RLS.
-- Already applied to Supabase project "timbang" (jdhpmmacudqemephosek). Kept here for reference.

create table public.settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  kcal integer not null default 2000 check (kcal between 0 and 10000),
  p integer not null default 120 check (p between 0 and 1000),
  c integer not null default 220 check (c between 0 and 2000),
  f integer not null default 65 check (f between 0 and 1000),
  updated_at timestamptz not null default now()
);

create table public.foods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  kcal numeric(7,1) not null check (kcal >= 0),
  p numeric(6,1) not null check (p >= 0),
  c numeric(6,1) not null check (c >= 0),
  f numeric(6,1) not null check (f >= 0),
  unit text check (char_length(unit) <= 40),
  unit_grams numeric(7,1) check (unit_grams > 0),
  verified boolean not null default false,
  source text not null default 'manual' check (source in ('manual','claude','usda','off')),
  source_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index foods_user_name_idx on public.foods (user_id, lower(name));
create unique index foods_user_barcode_idx on public.foods (user_id, source_ref) where source = 'off';

create table public.entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day date not null,
  meal text not null check (meal in ('breakfast','lunch','dinner','snack')),
  name text not null check (char_length(name) between 1 and 120),
  grams numeric(7,1) not null check (grams >= 0),
  kcal numeric(7,1) not null check (kcal >= 0),   -- per 100 g
  p numeric(6,1) not null check (p >= 0),
  c numeric(6,1) not null check (c >= 0),
  f numeric(6,1) not null check (f >= 0),
  checked boolean not null default false,
  src text not null default 'text' check (src in ('text','photo','library','meal','barcode','usda')),
  food_id uuid references public.foods(id) on delete set null,
  created_at timestamptz not null default now()
);
create index entries_user_day_idx on public.entries (user_id, day);
create index entries_food_idx on public.entries (food_id);

create table public.saved_meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  created_at timestamptz not null default now()
);
create index saved_meals_user_idx on public.saved_meals (user_id, created_at desc);

create table public.weights (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day date not null,
  kg numeric(5,1) not null check (kg between 20 and 400),
  primary key (user_id, day)
);

do $$
declare t text;
begin
  foreach t in array array['settings','foods','entries','saved_meals','weights'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy "owner_all" on public.%I for all to authenticated
      using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))$p$, t);
  end loop;
end $$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
create trigger foods_touch before update on public.foods for each row execute function public.touch_updated_at();
create trigger settings_touch before update on public.settings for each row execute function public.touch_updated_at();
