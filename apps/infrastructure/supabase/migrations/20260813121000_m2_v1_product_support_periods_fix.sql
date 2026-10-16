-- Roll-forward correction for runtime SQL resolution in the additive M2 V1 migration.

create or replace function public.m2_support_preview_json(
  p_organization_id uuid,
  p_product_id uuid,
  p_release_id uuid,
  p_current public.product_support_periods,
  p_support_starts_at timestamptz,
  p_support_ends_at timestamptz,
  p_expected_lifetime_justification text
) returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare v_current jsonb; v_proposed jsonb; v_lowering boolean; v_blocked jsonb := '[]'::jsonb;
  v_categories jsonb := jsonb_build_array('support_alerts','retention_dates'); v_digest text;
begin
  v_current := public.m2_support_period_json(p_current);
  v_proposed := jsonb_build_object('supportStartsAt',public.m2_utc_z(p_support_starts_at),'supportEndsAt',public.m2_utc_z(p_support_ends_at),'expectedLifetimeJustification',btrim(p_expected_lifetime_justification));
  v_lowering := p_current is not null and p_support_ends_at < p_current.support_ends_at;
  if exists(select 1 from public.product_lifecycle_dependency_facts facts where facts.organization_id=p_organization_id and facts.product_id=p_product_id and facts.active and facts.authority_kind='legal_hold') then
    v_blocked := v_blocked || jsonb_build_array('active_legal_hold');
  end if;
  if exists(select 1 from public.product_lifecycle_dependency_facts facts where facts.organization_id=p_organization_id and facts.product_id=p_product_id and facts.active and facts.authority_kind='retention') then
    v_categories := v_categories || jsonb_build_array('legal_floors','registered_evidence');
  end if;
  v_digest := encode(extensions.digest(jsonb_build_object('productId',p_product_id,'releaseId',p_release_id,'activeScopeRevision',coalesce(p_current.scope_revision,0),'current',v_current,'proposed',v_proposed)::text,'sha256'),'hex');
  return jsonb_build_object('current',v_current,'proposed',v_proposed,'lowering',v_lowering,'previewDigest',v_digest,
    'activeScopeRevision',coalesce(p_current.scope_revision,0),'isShortening',v_lowering,
    'retentionProtectionWouldReduce',v_lowering,'blockedReasons',v_blocked,'affectedCategories',v_categories,
    'currentRetentionUntil',null,'proposedRetentionUntil',null);
end $$;

create or replace function public.claim_product_support_alert_atomic(
  p_organization_id uuid, p_lease_owner uuid, p_lease_seconds integer
) returns table(outcome text, delivery_id uuid, lease_owner uuid, checkpoint_version integer, event jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_event public.product_regulatory_outbox_events%rowtype; v_product public.products%rowtype; v_period public.product_support_periods%rowtype;
begin
  if p_lease_seconds not between 1 and 3600 then return query select 'invalid_state'::text,null::uuid,null::uuid,null::integer,null::jsonb; return; end if;
  select * into v_event from public.product_regulatory_outbox_events queued_event
   where queued_event.organization_id=p_organization_id and queued_event.event_type='support_period.alert'
     and ((queued_event.delivery_state in ('scheduled','retrying','recipient_unavailable') and queued_event.due_at<=clock_timestamp()) or (queued_event.delivery_state='leased' and queued_event.lease_expires_at<=clock_timestamp()))
   order by queued_event.due_at,queued_event.id for update skip locked limit 1;
  if not found then return query select 'none_available'::text,null::uuid,null::uuid,null::integer,null::jsonb; return; end if;
  update public.product_regulatory_outbox_events queued_event set delivery_state='leased',lease_owner=p_lease_owner,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),checkpoint_version=queued_event.checkpoint_version+1,delivery_attempts=queued_event.delivery_attempts+1,last_delivery_error=null,last_error_code=null where queued_event.id=v_event.id returning * into v_event;
  select * into v_product from public.products where organization_id=p_organization_id and id=v_event.product_id;
  select * into v_period from public.product_support_periods where organization_id=p_organization_id and id=v_event.support_period_id;
  return query select 'claimed'::text,v_event.id,v_event.lease_owner,v_event.checkpoint_version,
    jsonb_build_object('organizationId',p_organization_id,'productId',v_event.product_id,'releaseId',v_event.release_id,'eventType','support_period.alert','eventKey',v_event.event_key,'supportPeriodId',v_event.support_period_id,'supportPeriodRevision',v_event.support_period_revision,'thresholdDays',v_event.alert_threshold_days,'supportEndsAt',public.m2_utc_z(v_period.support_ends_at),'dueAt',public.m2_utc_z(v_event.due_at),'deliveryState',case when v_event.missed then 'missed_catch_up' else 'current' end,'productName',v_product.name);
end $$;

alter function public.m2_support_preview_json(uuid,uuid,uuid,public.product_support_periods,timestamptz,timestamptz,text) owner to postgres;
alter function public.claim_product_support_alert_atomic(uuid,uuid,integer) owner to postgres;
revoke all on function public.m2_support_preview_json(uuid,uuid,uuid,public.product_support_periods,timestamptz,timestamptz,text) from public, anon, authenticated;
