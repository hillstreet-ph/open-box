-- Reconcile Open-Box role, grant, and Storage behavior after the core migration.
-- Safe to rerun: every policy, trigger, and grant operation is idempotent.

drop policy if exists "openbox_files_read_own" on storage.objects;
drop policy if exists "openbox_files_insert_own" on storage.objects;
drop policy if exists "openbox_files_update_own" on storage.objects;
drop policy if exists "openbox_files_delete_own" on storage.objects;

grant usage on schema open_box to authenticated, service_role;
grant select on
  open_box.artifacts,
  open_box.artifact_versions,
  open_box.access_grants,
  open_box.memberships,
  open_box.artifact_embeddings
to authenticated;
grant insert, update, delete on open_box.memberships to authenticated;
grant all on all tables in schema open_box to service_role;

create or replace function open_box.sync_allowlisted_membership()
returns trigger
language plpgsql
security definer
set search_path = open_box, pg_temp
as $$
declare
  assigned_role text;
begin
  assigned_role := case lower(coalesce(new.email, ''))
    when 'tanauancharles1@gmail.com' then 'owner'
    when 'kairocasino8@gmail.com' then 'admin'
    when 'huxleysee@gmail.com' then 'member'
    else null
  end;

  if assigned_role is not null then
    insert into open_box.memberships (user_id, role, active)
    values (new.id, assigned_role, true)
    on conflict (user_id) do update
      set role = excluded.role,
          active = true,
          updated_at = now();
  elsif tg_op = 'UPDATE'
    and lower(coalesce(old.email, '')) in (
      'tanauancharles1@gmail.com',
      'kairocasino8@gmail.com',
      'huxleysee@gmail.com'
    )
  then
    update open_box.memberships
       set active = false,
           updated_at = now()
     where user_id = new.id;
  end if;

  return new;
end;
$$;

revoke all on function open_box.sync_allowlisted_membership()
  from public, anon, authenticated;
grant execute on function open_box.sync_allowlisted_membership()
  to postgres, supabase_auth_admin, service_role;

drop trigger if exists on_auth_user_open_box_membership on auth.users;
create trigger on_auth_user_open_box_membership
after insert or update of email on auth.users
for each row execute function open_box.sync_allowlisted_membership();

insert into open_box.memberships (user_id, role, active)
select
  id,
  case lower(email)
    when 'tanauancharles1@gmail.com' then 'owner'
    when 'kairocasino8@gmail.com' then 'admin'
    when 'huxleysee@gmail.com' then 'member'
  end,
  true
from auth.users
where lower(email) in (
  'tanauancharles1@gmail.com',
  'kairocasino8@gmail.com',
  'huxleysee@gmail.com'
)
on conflict (user_id) do update
set role = excluded.role,
    active = true,
    updated_at = now();
