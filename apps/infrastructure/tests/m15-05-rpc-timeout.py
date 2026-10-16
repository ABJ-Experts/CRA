#!/usr/bin/env python3
"""Prove PostgREST applies role deadlines before a statement, task-source only.

The fixture role and RPC are temporary. Secrets stay in memory and are never
printed. Original development containers and their data are refused.
"""
import base64
import hashlib
import hmac
import json
import os
import subprocess
import time
import urllib.request
import urllib.error
from pathlib import Path

container=os.environ.get('M15_05_TEST_CONTAINER','')
if not container.startswith('cra_m15_05_'):
    raise SystemExit('Task-owned cra_m15_05_* container required')
private=Path('.superpowers/sdd/m15-05')
config=json.loads((private/'operator-server.private.json').read_text())
origin=config['databaseOrigin'];anon=Path(config['projectApiKeyFile']).read_text().strip()
control=Path(config['backupControlJwtFile']).read_text().strip()
secret=(private/'fixture-jwt-secret.private').read_bytes().strip()
def b64(value):return base64.urlsafe_b64encode(value).decode().rstrip('=')
claims={'role':'cra_m15_05_timeout_probe','iss':'supabase','iat':int(time.time()),'exp':int(time.time())+300}
message=b64(b'{"alg":"HS256","typ":"JWT"}')+'.'+b64(json.dumps(claims,separators=(',',':')).encode())
token=message+'.'+b64(hmac.new(secret,message.encode(),hashlib.sha256).digest())
def sql(value):
    return subprocess.check_output(['docker','exec','-i',container,'psql','-U','supabase_admin','-d','postgres','-Atq','-v','ON_ERROR_STOP=1'],input=value.encode()).decode().strip()
def request(jwt,delay):
    req=urllib.request.Request(origin+'/rest/v1/rpc/m15_05_timeout_probe_fixture',method='POST',headers={'Content-Type':'application/json','apikey':anon,'Authorization':'Bearer '+jwt},data=json.dumps({'p_delay_ms':delay}).encode())
    start=time.monotonic()
    try:
        with urllib.request.urlopen(req,timeout=12) as response:return response.status,json.loads(response.read()),round((time.monotonic()-start)*1000,3)
    except urllib.error.HTTPError as error:return error.code,json.loads(error.read()),round((time.monotonic()-start)*1000,3)
created=False
try:
    sql("""begin;create role cra_m15_05_timeout_probe nologin noinherit nobypassrls;
grant cra_m15_05_timeout_probe to authenticator;
grant usage on schema public to cra_m15_05_timeout_probe;
alter role cra_m15_05_timeout_probe set statement_timeout='30ms';
create function public.m15_05_timeout_probe_fixture(p_delay_ms integer) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$begin
 if p_delay_ms not between 0 and 10000 then raise exception 'invalid_probe';end if;
 perform pg_sleep(p_delay_ms::numeric/1000);
 return jsonb_build_object('statementTimeout',current_setting('statement_timeout'),'role',current_setting('role'));
end$$;
revoke all on function public.m15_05_timeout_probe_fixture(integer) from public,anon,authenticated,service_role;
grant execute on function public.m15_05_timeout_probe_fixture(integer) to cra_m15_05_timeout_probe,cra_backup_control;
notify pgrst,'reload schema';notify pgrst,'reload config';commit;""")
    created=True
    # The schema notification is asynchronous; retry only this read-only fixture.
    for attempt in range(30):
        quick=request(token,0)
        if quick[0]==200:break
        time.sleep(.1)
    assert quick[0]==200 and quick[1]['statementTimeout']=='30ms',quick
    bounded=request(token,200)
    assert bounded[0]>=400 and bounded[1].get('code')=='57014',bounded
    role=request(control,200)
    assert role[0]==200 and role[1]['statementTimeout']=='35s',role
    print(json.dumps({'fixtureRoleTimeout':quick[1]['statementTimeout'],'fixtureSleepMs':200,'fixtureErrorCode':bounded[1]['code'],'fixtureElapsedMs':bounded[2],'controlRoleTimeout':role[1]['statementTimeout'],'controlSleepElapsedMs':role[2],'deadlineAppliedBeforeStatement':True},indent=2))
finally:
    if created:sql("drop function public.m15_05_timeout_probe_fixture(integer);revoke cra_m15_05_timeout_probe from authenticator;revoke usage on schema public from cra_m15_05_timeout_probe;drop role cra_m15_05_timeout_probe;notify pgrst,'reload schema';notify pgrst,'reload config';")
