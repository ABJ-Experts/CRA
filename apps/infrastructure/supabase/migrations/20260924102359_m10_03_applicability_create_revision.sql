-- A first applicability command uses expected revision zero, while persisted
-- revisions begin at one. Preserve the published RPC and its idempotency key.
do $$
declare v_definition text;
begin
  select pg_get_functiondef(
    'public.m10_set_framework_applicability(uuid,uuid,uuid,text,text,text,boolean,text,integer,uuid)'::regprocedure)
  into v_definition;
  if position('p_expected_revision < 1' in v_definition)=0
    or position('not found and p_expected_revision is not null' in v_definition)=0 then
    raise exception 'M10 applicability revision anchor missing';
  end if;
  v_definition:=replace(v_definition,'p_expected_revision < 1','p_expected_revision < 0');
  v_definition:=replace(v_definition,
    'not found and p_expected_revision is not null',
    'not found and (p_expected_revision is not null and p_expected_revision <> 0)');
  execute v_definition;
end $$;
