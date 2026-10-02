-- Existing quarantine consumers remain compatible; the additional event type
-- lets the worker send an accurate integrity alert rather than a false malware
-- quarantine notice.
create or replace function public.claim_evidence_document_notification_atomic(
  p_organization_id uuid, p_worker_id uuid, p_lease_seconds integer
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare n public.evidence_document_notification_outbox%rowtype;
declare v_email text;
begin
  if p_worker_id is null or p_lease_seconds not between 30 and 900 then return null; end if;
  select * into n from public.evidence_document_notification_outbox x
    where x.organization_id = p_organization_id and x.status in ('queued','leased')
      and x.next_attempt_at <= clock_timestamp()
      and (x.status = 'queued' or x.lease_expires_at <= clock_timestamp())
    order by x.created_at, x.id for update skip locked limit 1;
  if not found then return null; end if;
  select u.email into v_email from public.users u join public.organization_members m
    on m.user_id = u.id and m.organization_id = p_organization_id
    where u.id = n.owner_user_id and u.is_active limit 1;
  if v_email is null then
    update public.evidence_document_notification_outbox set status = 'sent', sent_at = clock_timestamp(),
      last_error = 'owner unavailable', lease_owner = null, lease_expires_at = null where id = n.id;
    return null;
  end if;
  update public.evidence_document_notification_outbox set status = 'leased', lease_owner = p_worker_id,
    lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds), attempt_count = attempt_count + 1
    where id = n.id returning * into n;
  return jsonb_build_object('outboxId', n.id, 'email', v_email, 'eventType', n.event_type);
end $$;

notify pgrst, 'reload schema';
