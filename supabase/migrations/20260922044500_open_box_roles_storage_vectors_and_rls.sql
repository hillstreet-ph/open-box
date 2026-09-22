-- Open-Box production isolation: roles, private storage, vector search, and RLS repair.
create extension if not exists vector with schema extensions;

create table if not exists open_box.memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','member')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table open_box.memberships enable row level security;

create or replace function open_box.current_role()
returns text language sql stable security definer
set search_path = open_box, pg_temp
as $$
  select role from open_box.memberships
  where user_id = (select auth.uid()) and active
$$;
revoke all on function open_box.current_role() from public;
grant execute on function open_box.current_role() to authenticated, service_role;

drop policy if exists "Members can read own membership" on open_box.memberships;
create policy "Members can read own membership"
on open_box.memberships for select to authenticated
using (user_id = (select auth.uid()) or open_box.current_role() in ('owner','admin'));

drop policy if exists "Owners and admins manage memberships" on open_box.memberships;
create policy "Owners and admins manage memberships"
on open_box.memberships for all to authenticated
using (open_box.current_role() in ('owner','admin'))
with check (open_box.current_role() in ('owner','admin'));

drop policy if exists "Service role manages memberships" on open_box.memberships;
create policy "Service role manages memberships"
on open_box.memberships for all to service_role
using (true) with check (true);

insert into open_box.memberships (user_id, role)
select id, case lower(email)
  when 'tanauancharles1@gmail.com' then 'owner'
  when 'kairocasino8@gmail.com' then 'admin'
  when 'huxleysee@gmail.com' then 'member'
end
from auth.users
where lower(email) in (
  'tanauancharles1@gmail.com',
  'kairocasino8@gmail.com',
  'huxleysee@gmail.com'
)
on conflict (user_id) do update
set role=excluded.role, active=true, updated_at=now();

create table if not exists open_box.artifact_embeddings (
  artifact_id uuid primary key references open_box.artifacts(id) on delete cascade,
  embedding extensions.vector(1536) not null,
  model text not null default 'text-embedding-3-small',
  content_hash text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table open_box.artifact_embeddings enable row level security;

drop policy if exists "Artifact owners read embeddings" on open_box.artifact_embeddings;
create policy "Artifact owners read embeddings"
on open_box.artifact_embeddings for select to authenticated
using (exists (
  select 1 from open_box.artifacts a
  where a.id=artifact_id
    and (a.owner_id=(select auth.uid()) or open_box.current_role() in ('owner','admin'))
));

drop policy if exists "Service role manages embeddings" on open_box.artifact_embeddings;
create policy "Service role manages embeddings"
on open_box.artifact_embeddings for all to service_role
using (true) with check (true);

drop policy if exists "Granted users can read artifacts" on open_box.artifacts;
create policy "Granted users can read artifacts"
on open_box.artifacts for select to authenticated
using (
  owner_id = (select auth.uid())
  or open_box.current_role() in ('owner','admin')
  or exists (
    select 1 from open_box.access_grants g
    where g.artifact_id = artifacts.id
      and (g.grantee_id = (select auth.uid()) or g.grantee_type='public')
      and (g.expires_at is null or g.expires_at > now())
  )
);

insert into storage.buckets (id, name, public)
values ('open-box-files','open-box-files',false),
       ('open-box-backups','open-box-backups',false)
on conflict (id) do update set public=false;

drop policy if exists "Open-Box members read files" on storage.objects;
create policy "Open-Box members read files"
on storage.objects for select to authenticated
using (bucket_id='open-box-files' and open_box.current_role() in ('owner','admin','member'));

drop policy if exists "Open-Box owners and admins manage files" on storage.objects;
create policy "Open-Box owners and admins manage files"
on storage.objects for all to authenticated
using (bucket_id='open-box-files' and open_box.current_role() in ('owner','admin'))
with check (bucket_id='open-box-files' and open_box.current_role() in ('owner','admin'));

grant usage on schema open_box to authenticated, service_role;
grant select on open_box.memberships, open_box.artifact_embeddings to authenticated;
grant all on all tables in schema open_box to service_role;
