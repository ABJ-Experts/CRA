-- Make rejected sync-run transitions diagnosable without exposing connector
-- payloads: state names are safe operational metadata and preserve the cause
-- when a durable commit moves through a retry path.
create or replace function public.enforce_sync_run_status_transition()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = old.status then return new; end if;
  if not (
    (old.status = 'queued' and new.status in ('running', 'canceled', 'failed'))
    or (old.status = 'running' and new.status in ('waiting_for_review', 'queued', 'completed', 'retrying', 'failed', 'canceled'))
    or (old.status = 'waiting_for_review' and new.status in ('queued', 'canceled'))
    or (old.status = 'retrying' and new.status in ('running', 'canceled', 'failed'))
    or (old.status = 'failed' and new.status = 'queued')
  ) then
    raise exception using
      errcode = '23514',
      message = 'invalid sync run status transition',
      detail = format('sync run state transition %s -> %s is not permitted', old.status, new.status);
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_sync_run_status_transition() from public, anon, authenticated;
grant execute on function public.enforce_sync_run_status_transition() to service_role;
