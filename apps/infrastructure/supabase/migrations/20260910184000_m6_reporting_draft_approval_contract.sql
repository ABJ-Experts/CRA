-- Keep the draft-read approval companion aligned with the shared Zod wire
-- contract. Approval remains an immutable fact; this only corrects its read
-- projection and does not rewrite submitted records.
create or replace function public.m6_reporting_draft_json(
  p_organization_id uuid,
  p_draft_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.m6_reporting_draft_json_base(p_organization_id, p_draft_id)
    || jsonb_build_object(
      'approval',
      (
        select jsonb_build_object(
          'id', a.id,
          'draftId', a.draft_id,
          'draftRevision', a.draft_revision,
          'draftHash', a.draft_hash,
          'state', 'approved',
          'requestedBy', jsonb_build_object(
            'userId', d.created_by_user_id,
            'displayName', public.m6_actor_display_name(d.created_by_user_id)
          ),
          'requestedAt', public.m6_utc_second_z(d.created_at),
          'decidedBy', jsonb_build_object(
            'userId', a.approved_by_user_id,
            'displayName', public.m6_actor_display_name(a.approved_by_user_id)
          ),
          'decidedAt', public.m6_utc_second_z(a.approved_at),
          'segregationOfDutiesOverrideReason',
            a.segregation_of_duties_override_reason
        )
        from public.reporting_stage_approvals a
        join public.reporting_stage_drafts d
          on d.organization_id = a.organization_id and d.id = a.draft_id
        where a.organization_id = p_organization_id
          and a.draft_id = p_draft_id
          and a.draft_revision = d.version
          and a.draft_hash = public.m6_reporting_draft_hash(d)
        order by a.approved_at desc
        limit 1
      )
    );
$$;

alter function public.m6_reporting_draft_json(uuid, uuid) owner to postgres;
revoke all on function public.m6_reporting_draft_json(uuid, uuid) from public, anon, authenticated;
