-- Mi Dinero · esquema para Supabase
-- Pégalo completo en: Supabase > SQL Editor > New query > Run

-- 1) Perfil de cada persona (nombre y apellido del registro)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  last_name text,
  created_at timestamptz not null default now()
);

-- 2) Todos los datos de la app de cada persona (cuentas, movimientos, objetivos...)
create table if not exists public.user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 3) Seguridad: cada persona solo puede ver y modificar SUS filas
alter table public.profiles  enable row level security;
alter table public.user_data enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "user_data_select_own" on public.user_data;
drop policy if exists "user_data_insert_own" on public.user_data;
drop policy if exists "user_data_update_own" on public.user_data;
drop policy if exists "user_data_delete_own" on public.user_data;
create policy "user_data_select_own" on public.user_data for select using (auth.uid() = user_id);
create policy "user_data_insert_own" on public.user_data for insert with check (auth.uid() = user_id);
create policy "user_data_update_own" on public.user_data for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "user_data_delete_own" on public.user_data for delete using (auth.uid() = user_id);

-- 4) Al registrarse, crear el perfil con nombre y apellido automáticamente
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, first_name, last_name)
  values (new.id, new.raw_user_meta_data->>'first_name', new.raw_user_meta_data->>'last_name');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- 5) SINCRONIZACIÓN POR REGISTRO (offline + varios dispositivos)
--    Cada cuenta, categoría, movimiento y objetivo es una fila.
--    Así dos dispositivos no se pisan: solo gana el más reciente
--    sobre el MISMO registro.
-- =====================================================================
create table if not exists public.records (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  kind text not null,                       -- acc | cat | tx | goal | settings
  data jsonb not null default '{}'::jsonb,
  deleted boolean not null default false,
  ts bigint not null,                       -- hora del cambio (ms) en el dispositivo
  srv_at timestamptz not null default now(),-- hora en que llegó al servidor
  primary key (user_id, id)
);
create index if not exists records_pull_idx on public.records (user_id, srv_at);
alter table public.records enable row level security;

drop policy if exists "records_select_own" on public.records;
drop policy if exists "records_insert_own" on public.records;
drop policy if exists "records_update_own" on public.records;
drop policy if exists "records_delete_own" on public.records;
create policy "records_select_own" on public.records for select using (auth.uid() = user_id);
create policy "records_insert_own" on public.records for insert with check (auth.uid() = user_id);
create policy "records_update_own" on public.records for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "records_delete_own" on public.records for delete using (auth.uid() = user_id);

-- Guarda varios registros a la vez; solo reemplaza si el cambio es más reciente
create or replace function public.push_records(items jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare it jsonb;
begin
  for it in select * from jsonb_array_elements(items) loop
    insert into public.records (user_id, id, kind, data, deleted, ts)
    values (auth.uid(), it->>'id', it->>'kind', coalesce(it->'data','{}'::jsonb),
            coalesce((it->>'deleted')::boolean,false), (it->>'ts')::bigint)
    on conflict (user_id, id) do update
      set kind = excluded.kind, data = excluded.data, deleted = excluded.deleted,
          ts = excluded.ts, srv_at = now()
      where public.records.ts < excluded.ts;
  end loop;
end;
$$;
revoke all on function public.push_records(jsonb) from public, anon;
grant execute on function public.push_records(jsonb) to authenticated;
