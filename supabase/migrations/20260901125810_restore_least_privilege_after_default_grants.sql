-- Restore the intended Supabase API privilege boundary after provider default
-- grants were reapplied. OpenList uses its direct PostgreSQL connection for x_*
-- tables; browser clients must never receive privileges on those internal tables.

revoke all on table
  public.x_storages, public.x_users, public.x_meta, public.x_setting_items,
  public.x_search_nodes, public.x_task_items, public.x_ssh_public_keys,
  public.x_sharing_dbs, public.openbox_job_runs, public.openbox_backup_manifest
from anon, authenticated;

revoke all on table
  public.openbox_profiles, public.openbox_integrations,
  public.openbox_files, public.openbox_embeddings
from anon, authenticated;

-- Authenticated REST clients receive only the operations protected by the
-- existing per-user RLS policies. Do not grant schema-management privileges.
grant select, update on table public.openbox_profiles to authenticated;
grant select, insert, update, delete on table public.openbox_integrations to authenticated;
grant select, insert, update, delete on table public.openbox_files to authenticated;
grant select, insert, update, delete on table public.openbox_embeddings to authenticated;

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.openbox_handle_new_user() from public, anon, authenticated;
grant execute on function public.openbox_handle_new_user() to postgres, supabase_auth_admin;
