\set ON_ERROR_STOP on

-- Run with psql against a disposable, otherwise empty PostgreSQL database.
-- The migration under test is included directly and every fixture change is
-- rolled back. This test must never be pointed at a shared or production DB.
begin;

do $$
begin
  if exists (select 1 from pg_namespace where nspname in ('auth', 'open_box')) then
    raise exception 'artifact grant test requires a disposable empty database';
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

alter role service_role bypassrls;

create schema auth;
create schema open_box;
create schema open_box_test;

create table auth.users (
  id uuid primary key,
  email text
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth to public;
grant execute on function auth.uid() to public;

create table open_box.artifacts (
  id uuid primary key,
  name text not null,
  owner_id uuid references auth.users(id)
);
alter table open_box.artifacts enable row level security;

create table open_box.access_grants (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references open_box.artifacts(id) on delete cascade,
  grantee_id uuid references auth.users(id) on delete cascade,
  grantee_type text not null check (grantee_type in ('user', 'role', 'public')),
  permission text not null check (permission in ('read', 'write', 'admin')),
  expires_at timestamptz,
  check (
    (grantee_type = 'public' and grantee_id is null)
    or (grantee_type <> 'public' and grantee_id is not null)
  )
);
alter table open_box.access_grants enable row level security;

create table open_box.memberships (
  user_id uuid primary key references auth.users(id),
  role text not null check (role in ('owner', 'admin', 'member')),
  active boolean not null default true
);
alter table open_box.memberships enable row level security;

create or replace function open_box.current_role()
returns text
language sql
stable
security definer
set search_path = open_box, pg_temp
as $$
  select role
  from open_box.memberships
  where user_id = (select auth.uid()) and active
$$;

revoke all on function open_box.current_role() from public;
grant execute on function open_box.current_role() to authenticated, service_role;

create policy "Granted users can read artifacts"
on open_box.artifacts for select to authenticated
using (
  owner_id = (select auth.uid())
  or open_box.current_role() in ('owner', 'admin')
  or exists (
    select 1
    from open_box.access_grants as grant_row
    where grant_row.artifact_id = artifacts.id
      and (
        grant_row.grantee_id = (select auth.uid())
        or grant_row.grantee_type = 'public'
      )
      and (
        grant_row.expires_at is null
        or grant_row.expires_at > now()
      )
  )
);

grant usage on schema open_box to authenticated, service_role;
grant select on open_box.artifacts, open_box.access_grants, open_box.memberships
  to authenticated;
grant all on all tables in schema open_box to service_role;

create or replace function open_box_test.assert_count(
  check_name text,
  expected bigint,
  actual bigint
)
returns void
language plpgsql
as $$
begin
  if actual is distinct from expected then
    raise exception '%: expected %, got %', check_name, expected, actual;
  end if;
end
$$;

revoke all on function open_box_test.assert_count(text, bigint, bigint) from public;
grant usage on schema open_box_test to authenticated, service_role;
grant execute on function open_box_test.assert_count(text, bigint, bigint)
  to authenticated, service_role;

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner@example.invalid'),
  ('22222222-2222-4222-8222-222222222222', 'member@example.invalid'),
  ('33333333-3333-4333-8333-333333333333', 'unassigned@example.invalid');

insert into open_box.memberships (user_id, role) values
  ('11111111-1111-4111-8111-111111111111', 'owner'),
  ('22222222-2222-4222-8222-222222222222', 'member');

insert into open_box.artifacts (id, name, owner_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'owned',
   '22222222-2222-4222-8222-222222222222'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'public grant',
   '11111111-1111-4111-8111-111111111111'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'user grant',
   '11111111-1111-4111-8111-111111111111'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'expired grant',
   '11111111-1111-4111-8111-111111111111'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'unrelated',
   '11111111-1111-4111-8111-111111111111');

insert into open_box.access_grants (
  artifact_id,
  grantee_id,
  grantee_type,
  permission,
  expires_at
) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', null, 'public', 'read', null),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   '22222222-2222-4222-8222-222222222222', 'user', 'read', null),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd',
   '22222222-2222-4222-8222-222222222222', 'user', 'read', now() - interval '1 hour');

-- Execute the exact forward migration under test.
\ir ../migrations/20261010140000_restore_effective_artifact_grants.sql

do $$
begin
  if has_function_privilege(
    'anon',
    'open_box.has_effective_artifact_grant(uuid)',
    'execute'
  ) then
    raise exception 'anon unexpectedly has helper execute privilege';
  end if;
  if not has_function_privilege(
    'authenticated',
    'open_box.has_effective_artifact_grant(uuid)',
    'execute'
  ) then
    raise exception 'authenticated lacks helper execute privilege';
  end if;
  if has_table_privilege('anon', 'open_box.artifacts', 'select') then
    raise exception 'anon unexpectedly has artifact SELECT privilege';
  end if;
end
$$;

set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '22222222-2222-4222-8222-222222222222',
  false
);
select open_box_test.assert_count(
  'member reads owned artifact',
  1,
  (select count(*) from open_box.artifacts
   where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
);
select open_box_test.assert_count(
  'member reads user-granted artifact',
  1,
  (select count(*) from open_box.artifacts
   where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')
);
select open_box_test.assert_count(
  'expired grant stays denied',
  0,
  (select count(*) from open_box.artifacts
   where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')
);
select open_box_test.assert_count(
  'unrelated artifact stays denied',
  0,
  (select count(*) from open_box.artifacts
   where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')
);
select open_box_test.assert_count(
  'grant metadata stays hidden from member',
  0,
  (select count(*) from open_box.access_grants)
);

select set_config(
  'request.jwt.claim.sub',
  '33333333-3333-4333-8333-333333333333',
  false
);
select open_box_test.assert_count(
  'public grant reaches an authenticated principal without membership',
  1,
  (select count(*) from open_box.artifacts
   where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
);
select open_box_test.assert_count(
  'another user grant stays denied',
  0,
  (select count(*) from open_box.artifacts
   where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')
);
select open_box_test.assert_count(
  'public grant metadata stays hidden',
  0,
  (select count(*) from open_box.access_grants)
);

select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  false
);
select open_box_test.assert_count(
  'owner continuity',
  5,
  (select count(*) from open_box.artifacts)
);
reset role;

set role service_role;
select open_box_test.assert_count(
  'service role continuity',
  5,
  (select count(*) from open_box.artifacts)
);
reset role;

-- Exercise the documented rollback and verify the prior behavior returns.
drop policy if exists "Granted users can read artifacts" on open_box.artifacts;
drop function if exists open_box.has_effective_artifact_grant(uuid);
create policy "Granted users can read artifacts"
on open_box.artifacts for select to authenticated
using (
  owner_id = (select auth.uid())
  or open_box.current_role() in ('owner', 'admin')
  or exists (
    select 1
    from open_box.access_grants as grant_row
    where grant_row.artifact_id = artifacts.id
      and (
        grant_row.grantee_id = (select auth.uid())
        or grant_row.grantee_type = 'public'
      )
      and (
        grant_row.expires_at is null
        or grant_row.expires_at > now()
      )
  )
);

set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '33333333-3333-4333-8333-333333333333',
  false
);
select open_box_test.assert_count(
  'rollback restores prior blocked public-grant behavior',
  0,
  (select count(*) from open_box.artifacts
   where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
);
reset role;

rollback;
