-- LuckieLynx accounts: database setup
-- Run this once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- Safe to re-run: it drops and recreates its own policies, functions and trigger.
--
-- What it creates
--   public.profiles          one row per account: username, email choices, 18+ confirmation
--   handle_new_user()        fills the profile automatically when someone signs up
--   username_available()     lets the sign-up form check a name before submitting
--   row level security       each player can read their own profile and change only their email choices

-- 1. Profiles -----------------------------------------------------------------

create table if not exists public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  username       text not null,
  email_pref     text not null default 'picked',
  email_topics   text[] not null default array[]::text[],
  age_confirmed  boolean not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint username_format check (username ~ '^[A-Za-z0-9_]{3,16}$'),
  constraint email_pref_valid check (email_pref in ('picked', 'all')),
  constraint email_topics_valid check (email_topics <@ array['alpha', 'competitions', 'updates']::text[]),
  constraint must_be_adult check (age_confirmed)
);

comment on table public.profiles is 'LuckieLynx player profiles, one per auth user.';
comment on column public.profiles.email_pref is 'picked = only the topics in email_topics; all = every email we send.';

-- Usernames are unique regardless of upper/lower case (Lynx and lynx are the same name).
create unique index if not exists profiles_username_lower_idx on public.profiles (lower(username));

-- 2. Keep updated_at current ---------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- 3. Create the profile when someone signs up ------------------------------------
-- The website sends username, email_pref, email_topics and age_confirmed as sign-up metadata.
-- If any of it is invalid or the username is taken, the insert fails and so does the sign-up.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, username, email_pref, email_topics, age_confirmed)
  values (
    new.id,
    meta ->> 'username',
    coalesce(meta ->> 'email_pref', 'picked'),
    coalesce(
      array(select jsonb_array_elements_text(
        case when jsonb_typeof(meta -> 'email_topics') = 'array' then meta -> 'email_topics' else '[]'::jsonb end
      )),
      array[]::text[]
    ),
    coalesce((meta ->> 'age_confirmed')::boolean, false)
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4. Username check for the sign-up form ------------------------------------------

create or replace function public.username_available(name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select name ~ '^[A-Za-z0-9_]{3,16}$'
     and not exists (select 1 from public.profiles p where lower(p.username) = lower(name));
$$;

revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- 5. Access rules ----------------------------------------------------------------

alter table public.profiles enable row level security;

-- Nobody signed out can touch profiles. Signed-in players can read their own row
-- and change only their email choices. Usernames and the 18+ flag can't be edited from the site.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (email_pref, email_topics) on public.profiles to authenticated;

drop policy if exists "Players read their own profile" on public.profiles;
create policy "Players read their own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "Players update their own email choices" on public.profiles;
create policy "Players update their own email choices"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- 6. Mailing lists (for you, in the SQL Editor) -------------------------------------
-- Everyone who wants to hear about a topic, only confirmed emails:
--
--   select u.email, p.username
--   from public.profiles p join auth.users u on u.id = p.id
--   where u.email_confirmed_at is not null
--     and (p.email_pref = 'all' or 'competitions' = any (p.email_topics));
--
-- Swap 'competitions' for 'alpha' or 'updates'.
