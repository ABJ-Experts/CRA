-- Repair the source-review row lock in the immediately preceding local
-- hardening function. CREATE OR REPLACE retains its signature/privileges; the
-- replacement is derived from that just-installed function so clean local
-- migration replay and the current local database receive the same body.
do $m7_repair$
declare
  function_definition text;
begin
  select replace(
    pg_get_functiondef(
      'public.create_technical_file_snapshot_atomic(uuid,uuid,uuid,integer,text,uuid,text,uuid)'::regprocedure
    ),
    'review.section_source_id',
    'review.source_id'
  ) into function_definition;
  execute function_definition;
end
$m7_repair$;

revoke all on function public.create_technical_file_snapshot_atomic(uuid,uuid,uuid,integer,text,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.create_technical_file_snapshot_atomic(uuid,uuid,uuid,integer,text,uuid,text,uuid) to service_role;
alter function public.create_technical_file_snapshot_atomic(uuid,uuid,uuid,integer,text,uuid,text,uuid) owner to postgres;

notify pgrst, 'reload schema';
