-- Bind each copied artifact ledger row to the exact object frozen by the
-- materializer. A path alone can be overwritten between snapshot and copy.
do $$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(
    'public.complete_organization_export_atomic(uuid,uuid,uuid,integer,integer,text,text,text)'::regprocedure
  ) into v_definition;

  v_old := 'and artifacts.metadata->>''sourcePath'' = inventory.item->>''sourcePath''';
  v_new := v_old || E'\n             and artifacts.metadata->>''objectId'' = inventory.item->>''objectId''\n             and artifacts.metadata->>''version'' = inventory.item->>''version''\n             and artifacts.metadata->>''updatedAt'' = inventory.item->>''updatedAt''';
  if position('artifacts.metadata->>''objectId'' = inventory.item->>''objectId''' in v_definition) = 0 then
    if position(v_old in v_definition) = 0 then
      raise exception 'M1 frozen artifact identity completion anchor missing';
    end if;
    v_definition := replace(v_definition, v_old, v_new);
  end if;

  v_old := 'and inventory.item->>''sourcePath'' = artifacts.metadata->>''sourcePath''';
  v_new := v_old || E'\n               and inventory.item->>''objectId'' = artifacts.metadata->>''objectId''\n               and inventory.item->>''version'' = artifacts.metadata->>''version''\n               and inventory.item->>''updatedAt'' = artifacts.metadata->>''updatedAt''';
  if position('inventory.item->>''objectId'' = artifacts.metadata->>''objectId''' in v_definition) = 0 then
    if position(v_old in v_definition) = 0 then
      raise exception 'M1 reverse artifact identity completion anchor missing';
    end if;
    v_definition := replace(v_definition, v_old, v_new);
  end if;

  execute v_definition;
end $$;

alter function public.complete_organization_export_atomic(
  uuid, uuid, uuid, integer, integer, text, text, text
) owner to postgres;
revoke all on function public.complete_organization_export_atomic(
  uuid, uuid, uuid, integer, integer, text, text, text
) from public, anon, authenticated;
grant execute on function public.complete_organization_export_atomic(
  uuid, uuid, uuid, integer, integer, text, text, text
) to service_role;
