-- Keep the OpenList runtime tables server-only even though they live in the
-- Data API's exposed public schema. The application connects directly as the
-- dedicated table owner, openbox_runtime, so ordinary (non-forced) RLS does
-- not change its access. No browser or shared-knowledge role receives a policy.

revoke all privileges on table
  public.x_storages,
  public.x_users,
  public.x_meta,
  public.x_setting_items,
  public.x_search_nodes,
  public.x_task_items,
  public.x_ssh_public_keys,
  public.x_sharing_dbs
from public, anon, authenticated, service_role;

alter table public.x_storages enable row level security;
alter table public.x_users enable row level security;
alter table public.x_meta enable row level security;
alter table public.x_setting_items enable row level security;
alter table public.x_search_nodes enable row level security;
alter table public.x_task_items enable row level security;
alter table public.x_ssh_public_keys enable row level security;
alter table public.x_sharing_dbs enable row level security;
