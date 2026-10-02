-- Durable, tenant-scoped delivery lease for content-minimal quarantine mail.
create index evidence_notification_outbox_claim_idx
  on public.evidence_document_notification_outbox(status,next_attempt_at,organization_id,created_at);

create or replace function public.claim_evidence_document_notification_atomic(
  p_organization_id uuid, p_worker_id uuid, p_lease_seconds integer
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare n public.evidence_document_notification_outbox%rowtype; v_email text;
begin
  if p_worker_id is null or p_lease_seconds not between 30 and 900 then return null; end if;
  select * into n from public.evidence_document_notification_outbox x
    where x.organization_id=p_organization_id and x.status in ('queued','leased')
      and x.next_attempt_at<=clock_timestamp()
      and (x.status='queued' or x.lease_expires_at<=clock_timestamp())
    order by x.created_at,x.id for update skip locked limit 1;
  if not found then return null; end if;
  select u.email into v_email from public.users u join public.organization_members m
    on m.user_id=u.id and m.organization_id=p_organization_id
    where u.id=n.owner_user_id and u.is_active limit 1;
  if v_email is null then
    update public.evidence_document_notification_outbox set status='sent',sent_at=clock_timestamp(),last_error='owner unavailable',lease_owner=null,lease_expires_at=null where id=n.id;
    return null;
  end if;
  update public.evidence_document_notification_outbox set status='leased',lease_owner=p_worker_id,
    lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),attempt_count=attempt_count+1
    where id=n.id returning * into n;
  return jsonb_build_object('outboxId',n.id,'email',v_email);
end $$;

create or replace function public.complete_evidence_document_notification_atomic(
  p_organization_id uuid, p_worker_id uuid, p_outbox_id uuid, p_outcome text, p_error text default null
) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare n public.evidence_document_notification_outbox%rowtype;
begin
  select * into n from public.evidence_document_notification_outbox
    where organization_id=p_organization_id and id=p_outbox_id for update;
  if not found then return 'not_found'; end if;
  if n.status='sent' then return 'replayed'; end if;
  if n.status<>'leased' or n.lease_owner<>p_worker_id or n.lease_expires_at<clock_timestamp() then return 'lease_lost'; end if;
  if p_outcome='sent' then
    update public.evidence_document_notification_outbox set status='sent',sent_at=clock_timestamp(),last_error=null,lease_owner=null,lease_expires_at=null where id=n.id;
    return 'sent';
  end if;
  if p_outcome='retry' then
    update public.evidence_document_notification_outbox set status='queued',lease_owner=null,lease_expires_at=null,
      next_attempt_at=clock_timestamp()+make_interval(secs=>least(3600,greatest(30,30*(2^least(n.attempt_count,6))::integer))),
      last_error=left(coalesce(p_error,'notification delivery unavailable'),1000) where id=n.id;
    return 'queued';
  end if;
  return 'invalid_request';
end $$;

revoke all on function public.claim_evidence_document_notification_atomic(uuid,uuid,integer), public.complete_evidence_document_notification_atomic(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_evidence_document_notification_atomic(uuid,uuid,integer), public.complete_evidence_document_notification_atomic(uuid,uuid,uuid,text,text) to service_role;
notify pgrst, 'reload schema';
