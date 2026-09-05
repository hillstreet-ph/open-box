-- Allow one user to register multiple isolated accounts for the same provider.
-- Credentials remain indirect references to a server-side secret store.

alter table public.openbox_integrations
  add column if not exists account_key text,
  add column if not exists display_name text,
  add column if not exists account_type text,
  add column if not exists services text[] not null default '{}',
  add column if not exists scopes text[] not null default '{}';

update public.openbox_integrations
set account_key = coalesce(
  nullif(metadata ->> 'account_key', ''),
  provider || '-01'
)
where account_key is null;

alter table public.openbox_integrations
  alter column account_key set not null;

alter table public.openbox_integrations
  drop constraint if exists openbox_integrations_user_id_provider_key;

create unique index if not exists openbox_integrations_user_provider_account_key
  on public.openbox_integrations(user_id, provider, account_key);

alter table public.openbox_integrations
  drop constraint if exists openbox_integrations_account_key_format;

alter table public.openbox_integrations
  add constraint openbox_integrations_account_key_format
  check (account_key ~ '^[a-z0-9][a-z0-9-]{0,62}$');

comment on column public.openbox_integrations.account_key is
  'Stable per-user account slug used in mount paths; never contains a secret.';
comment on column public.openbox_integrations.credential_ref is
  'Opaque reference to a server-side secret; never an OAuth token or password.';
comment on column public.openbox_integrations.services is
  'Enabled service capabilities such as drive, docs, sheets, or gmail.';
comment on column public.openbox_integrations.scopes is
  'Granted least-privilege OAuth scope identifiers; contains no credentials.';
