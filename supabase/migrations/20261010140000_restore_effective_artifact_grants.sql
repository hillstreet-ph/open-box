-- Restore effective artifact reads without exposing access_grants rows.
--
-- access_grants has RLS enabled and intentionally has no authenticated SELECT
-- policy. The artifact SELECT policy therefore cannot inspect grant rows as the
-- caller. This SECURITY DEFINER helper returns only a boolean and keeps grant
-- metadata behind the existing RLS boundary.

create or replace function open_box.has_effective_artifact_grant(
  target_artifact_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = open_box, pg_temp
as $$
  select exists (
    select 1
    from open_box.access_grants as grant_row
    where grant_row.artifact_id = target_artifact_id
      and (
        grant_row.grantee_id = (select auth.uid())
        or grant_row.grantee_type = 'public'
      )
      and grant_row.permission in ('read', 'write', 'admin')
      and (
        grant_row.expires_at is null
        or grant_row.expires_at > now()
      )
  )
$$;

revoke all on function open_box.has_effective_artifact_grant(uuid)
  from public, anon, authenticated;
grant execute on function open_box.has_effective_artifact_grant(uuid)
  to authenticated, service_role;

drop policy if exists "Granted users can read artifacts" on open_box.artifacts;
create policy "Granted users can read artifacts"
on open_box.artifacts for select to authenticated
using (
  owner_id = (select auth.uid())
  or open_box.current_role() in ('owner', 'admin')
  or open_box.has_effective_artifact_grant(id)
);

-- Reviewed rollback (run only as an explicit, separately approved migration):
--   drop policy if exists "Granted users can read artifacts" on open_box.artifacts;
--   drop function if exists open_box.has_effective_artifact_grant(uuid);
--   create policy "Granted users can read artifacts"
--   on open_box.artifacts for select to authenticated
--   using (
--     owner_id = (select auth.uid())
--     or open_box.current_role() in ('owner', 'admin')
--     or exists (
--       select 1 from open_box.access_grants as grant_row
--       where grant_row.artifact_id = artifacts.id
--         and (
--           grant_row.grantee_id = (select auth.uid())
--           or grant_row.grantee_type = 'public'
--         )
--         and (
--           grant_row.expires_at is null
--           or grant_row.expires_at > now()
--         )
--     )
--   );
