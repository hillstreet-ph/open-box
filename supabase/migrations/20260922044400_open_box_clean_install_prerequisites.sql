-- Open-Box clean-install prerequisites.
-- This migration must run before 20260922044500_open_box_roles_storage_vectors_and_rls.sql.
-- It is intentionally idempotent so it is safe on the canonical open-platform project,
-- where these objects may already have been created by the platform baseline.

create schema if not exists open_box;

create table if not exists open_box.artifacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  artifact_type text not null check (
    artifact_type in ('binary','document','image','model','dataset','config','other')
  ),
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  r2_bucket text,
  r2_key text,
  checksum text,
  metadata jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}'::text[],
  owner_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table open_box.artifacts enable row level security;

create table if not exists open_box.artifact_versions (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references open_box.artifacts(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  r2_key text not null,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  checksum text,
  changelog text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (artifact_id, version_number)
);
alter table open_box.artifact_versions enable row level security;

create table if not exists open_box.access_grants (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references open_box.artifacts(id) on delete cascade,
  grantee_id uuid references auth.users(id) on delete cascade,
  grantee_type text not null check (grantee_type in ('user','role','public')),
  permission text not null check (permission in ('read','write','admin')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (grantee_type = 'public' and grantee_id is null)
    or (grantee_type <> 'public' and grantee_id is not null)
  )
);
alter table open_box.access_grants enable row level security;

create index if not exists artifacts_owner_idx
  on open_box.artifacts(owner_id);
create index if not exists access_grants_artifact_idx
  on open_box.access_grants(artifact_id);
create index if not exists access_grants_grantee_idx
  on open_box.access_grants(grantee_id);

grant usage on schema open_box to authenticated, service_role;
grant all on all tables in schema open_box to service_role;
