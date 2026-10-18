-- LuckieLynx tester access: admin flag, alpha/beta phases, codes, downloads
-- Run this once in Supabase: SQL Editor > New query > paste > Run. Run schema.sql first.
-- Safe to re-run.
--
-- After running it, make yourself admin (swap in your own username):
--   update public.profiles set is_admin = true where lower(username) = lower('DevAbbe');

create extension if not exists pgcrypto with schema extensions;

-- 1. Admin flag ------------------------------------------------------------------
-- Players can't change this from the site: they may only update their email choices.

alter table public.profiles add column if not exists is_admin boolean not null default false;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;

-- 2. Tables ----------------------------------------------------------------------

create table if not exists public.phases (
  id               text primary key check (id ~ '^[a-z0-9_]{2,20}$'),
  name             text not null,
  sort             int  not null default 0,
  active           boolean not null default false,
  code_hash        text,
  code_max_uses    int check (code_max_uses is null or code_max_uses > 0),
  code_expires_at  timestamptz,
  code_uses        int not null default 0,
  code_set_at      timestamptz,
  build_label      text,
  build_key        text,
  build_notes      text,
  updated_at       timestamptz not null default now()
);

insert into public.phases (id, name, sort) values ('alpha', 'Alpha', 1), ('beta', 'Beta', 2)
on conflict (id) do nothing;

create table if not exists public.tester_access (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  phase_id    text not null references public.phases (id) on delete cascade,
  granted_via text not null check (granted_via in ('code', 'admin')),
  granted_at  timestamptz not null default now(),
  primary key (user_id, phase_id)
);

create table if not exists public.code_attempts (
  id      bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  at      timestamptz not null default now()
);
create index if not exists code_attempts_user_at_idx on public.code_attempts (user_id, at);

create table if not exists public.download_tokens (
  token      text primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  phase_id   text not null references public.phases (id) on delete cascade,
  build_key  text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists download_tokens_user_created_idx on public.download_tokens (user_id, created_at);

-- Nothing here is readable or writable directly from the site, except a player's own access rows.
-- Everything else goes through the functions below, which check who is asking.
alter table public.phases enable row level security;
alter table public.tester_access enable row level security;
alter table public.code_attempts enable row level security;
alter table public.download_tokens enable row level security;

revoke all on public.phases, public.tester_access, public.code_attempts, public.download_tokens from anon, authenticated;
grant select on public.tester_access to authenticated;

drop policy if exists "Players read their own access" on public.tester_access;
create policy "Players read their own access"
  on public.tester_access for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- 3. Player functions ----------------------------------------------------------------

-- What the signed-in player can see: admin or not, and the open phases they have access to.
create or replace function public.my_status()
returns json
language sql
stable
security definer
set search_path = ''
as $$
  select json_build_object(
    'is_admin', public.is_admin(),
    'access', coalesce((
      select json_agg(json_build_object(
               'phase', p.id, 'name', p.name,
               'build_label', p.build_label, 'build_notes', p.build_notes,
               'has_build', coalesce(p.build_key, '') <> '',
               'granted_at', t.granted_at)
             order by p.sort desc)
      from public.tester_access t
      join public.phases p on p.id = t.phase_id
      where t.user_id = auth.uid() and p.active
    ), '[]'::json)
  );
$$;

-- Redeem a tester code. Case, spaces and dashes don't matter. Wrong codes are counted: 5 wrong tries per hour, then a pause.
-- Returns {ok, phase, name, already} or {ok:false, error}.
create or replace function public.redeem_code(code text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid      uuid := auth.uid();
  c        text := regexp_replace(upper(coalesce(code, '')), '[^A-Z0-9]', '', 'g');
  fails    int;
  ph       public.phases%rowtype;
  inserted int;
begin
  if uid is null then
    return json_build_object('ok', false, 'error', 'Sign in first, then enter your code.');
  end if;

  select count(*) into fails from public.code_attempts a
  where a.user_id = uid and a.at > now() - interval '1 hour';
  if fails >= 5 then
    return json_build_object('ok', false, 'error', 'Too many wrong codes. Wait an hour and try again.');
  end if;

  if length(c) between 4 and 40 then
    select * into ph from public.phases p
    where p.active
      and p.code_hash is not null
      and (p.code_expires_at is null or p.code_expires_at > now())
      and (p.code_max_uses is null or p.code_uses < p.code_max_uses)
      and p.code_hash = extensions.crypt(c, p.code_hash)
    order by p.sort desc
    limit 1;
  end if;

  if ph.id is null then
    insert into public.code_attempts (user_id) values (uid);
    return json_build_object('ok', false, 'error', 'That code isn''t valid or has run out. Check it and try again.');
  end if;

  insert into public.tester_access (user_id, phase_id, granted_via)
  values (uid, ph.id, 'code')
  on conflict do nothing;
  get diagnostics inserted = row_count;
  if inserted > 0 then
    update public.phases set code_uses = code_uses + 1 where id = ph.id;
  end if;

  return json_build_object('ok', true, 'phase', ph.id, 'name', ph.name, 'already', inserted = 0);
end;
$$;

-- Start a download: returns a one-off token that works for 10 minutes.
-- Admins can download every phase, open or not, to test builds.
create or replace function public.create_download_token(phase text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid    uuid := auth.uid();
  k      text;
  recent int;
  tok    text;
begin
  if uid is null then
    raise exception 'Sign in first.';
  end if;

  select p.build_key into k
  from public.phases p
  where p.id = phase
    and (public.is_admin()
         or (p.active and exists (select 1 from public.tester_access t where t.user_id = uid and t.phase_id = p.id)));

  if coalesce(k, '') = '' then
    raise exception 'There''s no download for you in this phase yet.';
  end if;

  select count(*) into recent from public.download_tokens d
  where d.user_id = uid and d.created_at > now() - interval '1 hour';
  if recent >= 30 then
    raise exception 'Too many downloads started. Try again in an hour.';
  end if;

  delete from public.download_tokens where expires_at < now() - interval '1 day';

  tok := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.download_tokens (token, user_id, phase_id, build_key, expires_at)
  values (tok, uid, phase, k, now() + interval '10 minutes');
  return tok;
end;
$$;

-- Used by the download service on Cloudflare to look up which file a token unlocks.
create or replace function public.use_download_token(t text)
returns json
language sql
stable
security definer
set search_path = ''
as $$
  select json_build_object('key', d.build_key)
  from public.download_tokens d
  where d.token = t and d.expires_at > now();
$$;

-- 4. Admin functions ---------------------------------------------------------------

create or replace function public.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only.';
  end if;
end;
$$;

create or replace function public.admin_overview()
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return json_build_object(
    'accounts', (select count(*) from public.profiles),
    'phases', coalesce((
      select json_agg(json_build_object(
               'id', p.id, 'name', p.name, 'active', p.active,
               'has_code', p.code_hash is not null,
               'code_uses', p.code_uses, 'code_max_uses', p.code_max_uses,
               'code_expires_at', p.code_expires_at, 'code_set_at', p.code_set_at,
               'build_label', p.build_label, 'build_key', p.build_key, 'build_notes', p.build_notes,
               'testers', (select count(*) from public.tester_access t where t.phase_id = p.id))
             order by p.sort)
      from public.phases p), '[]'::json),
    'testers', coalesce((
      select json_agg(json_build_object(
               'username', pr.username, 'phase', t.phase_id, 'phase_name', p.name,
               'via', t.granted_via, 'granted_at', t.granted_at)
             order by t.granted_at desc)
      from public.tester_access t
      join public.profiles pr on pr.id = t.user_id
      join public.phases p on p.id = t.phase_id), '[]'::json)
  );
end;
$$;

create or replace function public.admin_set_code(phase text, code text, max_uses int default null, expires_at timestamptz default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c text := regexp_replace(upper(coalesce(code, '')), '[^A-Z0-9]', '', 'g');
begin
  perform public.require_admin();
  if c !~ '^[A-Z0-9]{6,40}$' then
    raise exception 'Codes need at least 6 letters or numbers. Dashes and spaces are ignored.';
  end if;
  if max_uses is not null and max_uses < 1 then
    raise exception 'Max uses must be 1 or more, or left empty.';
  end if;
  update public.phases p
  set code_hash = extensions.crypt(c, extensions.gen_salt('bf', 8)),
      code_max_uses = max_uses,
      code_expires_at = expires_at,
      code_uses = 0,
      code_set_at = now(),
      updated_at = now()
  where p.id = phase;
  if not found then
    raise exception 'Unknown phase.';
  end if;
end;
$$;

create or replace function public.admin_clear_code(phase text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  update public.phases p
  set code_hash = null, code_max_uses = null, code_expires_at = null, code_uses = 0, code_set_at = null, updated_at = now()
  where p.id = phase;
end;
$$;

create or replace function public.admin_update_phase(phase text, name text, active boolean, build_label text, build_key text, build_notes text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  if coalesce(trim(name), '') = '' then
    raise exception 'Give the phase a name.';
  end if;
  update public.phases p
  set name = trim(admin_update_phase.name),
      active = admin_update_phase.active,
      build_label = nullif(trim(admin_update_phase.build_label), ''),
      build_key = nullif(trim(admin_update_phase.build_key), ''),
      build_notes = nullif(trim(admin_update_phase.build_notes), ''),
      updated_at = now()
  where p.id = phase;
  if not found then
    raise exception 'Unknown phase.';
  end if;
end;
$$;

create or replace function public.admin_grant(phase text, username text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
begin
  perform public.require_admin();
  select pr.id into uid from public.profiles pr where lower(pr.username) = lower(trim(admin_grant.username));
  if uid is null then
    raise exception 'No account with the username %.', trim(admin_grant.username);
  end if;
  if not exists (select 1 from public.phases p where p.id = phase) then
    raise exception 'Unknown phase.';
  end if;
  insert into public.tester_access (user_id, phase_id, granted_via)
  values (uid, phase, 'admin')
  on conflict do nothing;
end;
$$;

create or replace function public.admin_revoke(phase text, username text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  delete from public.tester_access t
  using public.profiles pr
  where pr.id = t.user_id
    and lower(pr.username) = lower(trim(admin_revoke.username))
    and t.phase_id = phase;
end;
$$;

-- 5. Who may call what ---------------------------------------------------------------

revoke all on function public.is_admin() from public, anon;
revoke all on function public.require_admin() from public, anon, authenticated;
revoke all on function public.my_status() from public, anon;
revoke all on function public.redeem_code(text) from public, anon;
revoke all on function public.create_download_token(text) from public, anon;
revoke all on function public.use_download_token(text) from public;
revoke all on function public.admin_overview() from public, anon;
revoke all on function public.admin_set_code(text, text, int, timestamptz) from public, anon;
revoke all on function public.admin_clear_code(text) from public, anon;
revoke all on function public.admin_update_phase(text, text, boolean, text, text, text) from public, anon;
revoke all on function public.admin_grant(text, text) from public, anon;
revoke all on function public.admin_revoke(text, text) from public, anon;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.my_status() to authenticated;
grant execute on function public.redeem_code(text) to authenticated;
grant execute on function public.create_download_token(text) to authenticated;
grant execute on function public.use_download_token(text) to anon, authenticated;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_set_code(text, text, int, timestamptz) to authenticated;
grant execute on function public.admin_clear_code(text) to authenticated;
grant execute on function public.admin_update_phase(text, text, boolean, text, text, text) to authenticated;
grant execute on function public.admin_grant(text, text) to authenticated;
grant execute on function public.admin_revoke(text, text) to authenticated;
