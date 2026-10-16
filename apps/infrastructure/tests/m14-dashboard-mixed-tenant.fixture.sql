-- Synthetic second tenant for concurrent isolated-dashboard benchmarks.
-- Bootstrap and benchmark databases contain no retained development data.
begin;
do $$
begin
  if current_database()<>'cra_m14_benchmark' then
    raise exception 'M14 mixed fixture requires isolated cra_m14_benchmark database';
  end if;
  if not exists(select 1 from public.users where id='00000000-0000-4000-8000-0000000000cb'and email='owner@cra.test')then
    raise exception 'M14 mixed fixture requires synthetic bootstrap actor';
  end if;
end $$;
insert into public.organizations(id,name,slug)
values('00000000-0000-4000-8000-0000000000da','M14 synthetic second benchmark tenant','m14-synthetic-second-tenant');
insert into public.organization_members(organization_id,user_id,role)
values('00000000-0000-4000-8000-0000000000da','00000000-0000-4000-8000-0000000000cb','owner');
insert into public.organization_legal_entities(
  id,organization_id,identifier,display_name,legal_name,registered_address_line_1,
  registered_address_locality,registered_address_postal_code,registered_address_country,
  main_establishment_country,manufacturer_contact_name,manufacturer_contact_email,
  completion_status,status,is_default,created_by,updated_by
)values(
  '00000000-0000-4000-8000-0000000000dc','00000000-0000-4000-8000-0000000000da',
  'synthetic-second','Synthetic Second Entity','Synthetic Second Entity',
  '2 Synthetic Fixture Street','Synthetic City','10000','DE','DE',
  'Synthetic Fixture Contact','synthetic-second@example.invalid','complete','active',true,
  '00000000-0000-4000-8000-0000000000cb','00000000-0000-4000-8000-0000000000cb'
);
insert into public.products(
  id,organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,
  name,internal_code,product_type,responsible_owner_id,created_by,updated_by
)select
  '00000000-0000-4000-8000-0000000000dd',e.organization_id,e.id,e.version,to_jsonb(e),
  'Synthetic Second Product','synthetic-second-product','standalone_software',
  '00000000-0000-4000-8000-0000000000cb','00000000-0000-4000-8000-0000000000cb',
  '00000000-0000-4000-8000-0000000000cb'
from public.organization_legal_entities e where e.id='00000000-0000-4000-8000-0000000000dc';
insert into public.product_releases(
  id,organization_id,product_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,
  label,release_version,lifecycle,placed_on_market_at,created_by,updated_by
)select
  '00000000-0000-4000-8000-0000000000de',p.organization_id,p.id,p.legal_entity_id,
  p.legal_entity_version,p.legal_entity_snapshot,'Synthetic second release',
  'synthetic-second-release','placed_on_market',statement_timestamp(),p.created_by,p.updated_by
from public.products p where p.id='00000000-0000-4000-8000-0000000000dd';
do $$
declare j jsonb;
begin
  j:=public.get_dashboard_projection('00000000-0000-4000-8000-0000000000da','00000000-0000-4000-8000-0000000000cb','overview','{}');
  if j->>'outcome'<>'found' or j#>>'{result,organizationId}'<>'00000000-0000-4000-8000-0000000000da'
    or (j#>>'{result,products,data,totalProducts}')::integer<>1
    or (j#>>'{result,findings,data,openCount}')::integer<>0
    or exists(select 1 from jsonb_each(j->'result')v where v.value->>'state'='unavailable')then
    raise exception 'Synthetic second tenant dashboard scope failed';
  end if;
end $$;
commit;
