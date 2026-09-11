-- M1 onboarding: organization creation inserts a completed organization-details
-- stage directly. Capture that durable completion fact in the same transaction
-- without duplicating the reconciliation audit used for later stage updates.

create or replace function public.audit_inserted_organization_onboarding_stage()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if new.status = 'completed' then
    insert into public.audit_logs (
      organization_id, user_id, action, entity_type, entity_id, changes
    ) values (
      new.organization_id, new.completed_by, 'onboarding.stage_completed',
      'organization_onboarding_stage', new.stage,
      jsonb_build_object('stage', new.stage, 'resourceId', new.organization_id)
    );
  end if;

  return new;
end;
$$;

alter function public.audit_inserted_organization_onboarding_stage()
  owner to postgres;
revoke all on function public.audit_inserted_organization_onboarding_stage()
  from public, anon, authenticated;

drop trigger if exists audit_inserted_organization_onboarding_stage
  on public.organization_onboarding_stages;
create trigger audit_inserted_organization_onboarding_stage
  after insert on public.organization_onboarding_stages
  for each row execute function public.audit_inserted_organization_onboarding_stage();
