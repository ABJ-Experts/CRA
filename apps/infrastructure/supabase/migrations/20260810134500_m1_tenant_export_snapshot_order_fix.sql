-- The onboarding stage ledger is keyed by organization/stage rather than an
-- artificial id. Preserve its immutable canonical stage order in snapshots.
update public.organization_export_source_tables
   set record_order_column = 'stage_order'
 where source_id = 'organization_onboarding_stages'
   and table_name = 'organization_onboarding_stages';
