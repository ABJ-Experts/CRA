#!/usr/bin/env python3
"""Actual M15-03 metadata RPC deadline, disposable-source actor only.

Uses task-owned source + credentials referenced by its private profile. It never
prints secrets or metadata. A temporary trigger blocks only this random fixture
operator's metadata audit append; all other writes and operators are unaffected.
"""
import json,os,subprocess,time,urllib.request,urllib.error,urllib.parse,uuid
from pathlib import Path
container=os.environ.get('M15_05_TEST_CONTAINER','')
if not container.startswith('cra_m15_05_'):raise SystemExit('Task-owned container required')
config=json.loads(Path('.superpowers/sdd/m15-05/operator-server.private.json').read_text())
endpoint=urllib.parse.urlparse(config['databaseOrigin'])
if endpoint.scheme!='http' or endpoint.hostname not in ('127.0.0.1','localhost') or endpoint.port==54321:raise SystemExit('Dedicated local task endpoint required')
runtime=json.loads(Path('.superpowers/sdd/m15-05/mounted-runtime.private.json').read_text())
if not any(s['databaseContainer']==container for s in runtime['sources'].values()):raise SystemExit('Mounted source binding required')
reader=Path(config['readerJwtFile']).read_text().strip();anon=Path(config['projectApiKeyFile']).read_text().strip()
actor=str(uuid.uuid4());latch=uuid.uuid4().int%(2**62)
def sql(query):return subprocess.check_output(['docker','exec','-i',container,'psql','-X','-U','supabase_admin','-d','postgres','-Atq','-v','ON_ERROR_STOP=1'],input=query.encode(),stderr=subprocess.PIPE).decode().strip()
def request():
 data={'p_operator_id':actor,'p_request_id':str(uuid.uuid4()),'p_instance_ids':[config['instanceId']],'p_tenant_ids':[],'p_kind':'instances','p_instance_id':None,'p_after_id':None,'p_limit':25}
 r=urllib.request.Request(config['databaseOrigin']+'/rest/v1/rpc/m15_03_operator_read',method='POST',headers={'Content-Type':'application/json','apikey':anon,'Authorization':'Bearer '+reader},data=json.dumps(data).encode())
 start=time.monotonic()
 try:
  with urllib.request.urlopen(r,timeout=8) as result:return result.status,json.loads(result.read()),round((time.monotonic()-start)*1000,3)
 except urllib.error.HTTPError as error:return error.code,json.loads(error.read()),round((time.monotonic()-start)*1000,3)
def blocked_request():
 hold=subprocess.Popen(['docker','exec','-i',container,'psql','-X','-U','supabase_admin','-d','postgres','-Atq','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 try:
  hold.stdin.write(f'begin;select pg_advisory_xact_lock({latch});select \'READY\';select pg_sleep(1.5);rollback;\n');hold.stdin.close()
  while hold.stdout.readline().strip()!='READY':
   if hold.poll() is not None:raise RuntimeError('fixture_latch_unavailable')
  return request()
 finally:
  hold.wait(timeout=5)
created=False
try:
 sql(f"""begin;create function public.m15_05_registry_timeout_fixture() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$begin
 if new.action='operator.metadata.read' and new.actor_id='{actor}' then perform pg_advisory_xact_lock({latch});end if;return new;end$$;
 revoke all on function public.m15_05_registry_timeout_fixture() from public,anon,authenticated,service_role;
 create trigger m15_05_registry_timeout_fixture before insert on public.audit_logs for each row execute function public.m15_05_registry_timeout_fixture();commit;""")
 created=True
 result=blocked_request()
 assert result[0]>=400 and result[1].get('code')=='57014' and 100<=result[2]<1250,{'status':result[0],'code':result[1].get('code'),'elapsed':result[2]}
 assert sql(f"select count(*) from public.audit_logs where actor_id='{actor}'")=='0','timed-out metadata must not disclose or append partial receipt'
 print(json.dumps({'actualRpc':'m15_03_operator_read','fixtureActorOnly':True,'boundedMetadataError':True,'roleConfiguredTimeout':sql("select array_to_string(rolconfig,',') from pg_roles where rolname='cra_operator_registry_reader'"),'httpStatus':result[0],'safeErrorCode':result[1].get('code') if isinstance(result[1],dict) else None,'blockedReadElapsedMs':result[2],'auditFailureClosesDisclosure':True,'sourceRowsChanged':0},indent=2))
finally:
 if created:sql('drop trigger m15_05_registry_timeout_fixture on public.audit_logs;drop function public.m15_05_registry_timeout_fixture();')
