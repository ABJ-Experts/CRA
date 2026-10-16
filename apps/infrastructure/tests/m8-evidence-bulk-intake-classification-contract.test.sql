begin;
create extension if not exists pgtap;
select plan(5);

select ok(to_regprocedure('public.create_evidence_bulk_intake_batch_atomic(uuid,uuid,uuid,jsonb,uuid)') is not null,
  'bulk batch creation RPC exists');
select ok(position('m8_06_bulk_suggested_class' in pg_get_functiondef(
  'public.create_evidence_bulk_intake_batch_atomic(uuid,uuid,uuid,jsonb,uuid)'::regprocedure)) > 0,
  'bulk classification is derived by the server');
select ok(position('x->''classification''' in pg_get_functiondef(
  'public.create_evidence_bulk_intake_batch_atomic(uuid,uuid,uuid,jsonb,uuid)'::regprocedure)) = 0,
  'contract-shaped items need not carry a client classification payload');
select ok(position('p_failure_code not in' in pg_get_functiondef(
  'public.complete_evidence_bulk_intake_item_atomic(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,text,uuid,text)'::regprocedure)) > 0,
  'bulk completion accepts only a bounded inspected failure-code allowlist');
select ok(position('error_code=case when r.outcome=''failed''' in pg_get_functiondef(
  'public.complete_evidence_bulk_intake_item_atomic(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,text,uuid,text)'::regprocedure)) > 0,
  'a failed bulk completion durably records a safe item error code');

select * from finish();
rollback;
