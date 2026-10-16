#!/usr/bin/env bash
# Synthetic schema-only database only. This never touches retained CRA evidence.
set -euo pipefail
range_database=${M13_RANGE_TEST_DATABASE:-m13_test_04_range_v2}
[[ "$range_database" == m13_test_04_range* ]] || { echo 'Disposable M13 range database required' >&2; exit 1; }
export M13_RANGE_TEST_DATABASE="$range_database"
python3 - <<'PY'
import os, subprocess, uuid, time
DB=os.environ['M13_RANGE_TEST_DATABASE']
BASE=['docker','exec','-i','supabase_db_cra','psql','-U','postgres','-d',DB,'-X','-qAt','-v','ON_ERROR_STOP=1']
def sql(query):
    return subprocess.run(BASE,input=query,text=True,capture_output=True,check=True).stdout.strip()
def check(name,condition):
    if not condition: raise AssertionError(name)
    print('PASS:',name)
org,org2,user=[str(uuid.uuid4()) for _ in range(3)]
sql(f"insert into public.organizations(id,name,slug) values('{org}','M13 concurrent fixture','m13-{org}'),('{org2}','M13 move fixture','m13-{org2}'); insert into public.users(id,email) values('{user}','{user}@m13.invalid'); insert into public.organization_members(organization_id,user_id,role) values('{org}','{user}','owner'),('{org2}','{user}','owner');")
substitute,absence=[str(uuid.uuid4()) for _ in range(2)]
sql(f"insert into public.users(id,email) values('{substitute}','{substitute}@m13.invalid'); insert into public.workflow_out_of_office(id,organization_id,user_id,substitute_user_id,starts_at,ends_at) values('{absence}','{org}','{user}','{substitute}',clock_timestamp(),clock_timestamp()+interval '1 day');")
def job():
    return sql(f"select public.m13_04_create_verification('{org}','{user}',gen_random_uuid(),'1',null,null,repeat('a',64))->>'id';")
def scope(j):
    return sql(f"select coalesce(public.m13_04_current_scope(j),'ok') from public.audit_verification_jobs j where id='{j}';")
def cancel(j):
    sql(f"select public.m13_04_control_verification('{org}','{user}','{j}',gen_random_uuid(),(select version from public.audit_verification_jobs where id='{j}'),'cancel');")
def writer(commit=True,subtransaction=False):
    application='m13_range_writer_'+uuid.uuid4().hex
    sub='savepoint source_scope;' if subtransaction else ''
    end='commit;' if commit else 'rollback;'
    query=f"begin; set local application_name='{application}'; {sub} update public.workflow_out_of_office set version=version+1 where id='{absence}'; select pg_current_xact_id(); select pg_sleep(2); {end}"
    process=subprocess.Popen(BASE,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    process.stdin.write(query);process.stdin.close()
    for _ in range(100):
        if sql(f"select count(*) from pg_stat_activity where application_name='{application}' and wait_event='PgSleep';")=='1': break
        time.sleep(.02)
    else: raise AssertionError('writer failed to enter sleep')
    return process
for commit,sub,name in [(True,False,'late committed source invalidates saved snapshot'),(True,True,'subtransaction receipt uses top-level xid'),(False,True,'rolled-back source preserves authorization')]:
    process=writer(commit,sub)
    j=job()
    check('uncommitted source not prematurely visible',scope(j)=='ok')
    output=process.stdout.read();error=process.stderr.read();status=process.wait()
    if status: raise RuntimeError(error)
    xid=output.splitlines()[0]
    check(name,scope(j)==('access_changed' if commit else 'ok'))
    if commit:
        check('receipt records top-level transaction',sql(f"select count(*)>0 from public.audit_logs where action='audit.range.scope_changed' and after_redacted->>'organizationId'='{org}' and after_redacted->>'xid'='{xid}';")=='t')
    cancel(j)
j=job()
sql(f"update public.audit_verification_jobs set scheduled_at='-infinity' where id='{j}';")
claim=sql("select public.m13_04_claim_verification('m13-concurrency')::text;")
import json
claimed=json.loads(claim)
check('claim synthetic target',claimed['id']==j)
cancel(j)
query=f"select public.m13_04_checkpoint_verification('{org}','{j}','m13-concurrency','{claimed['lease_token']}',{claimed['version']},null,null);"
failed=subprocess.run(BASE,input=query,text=True,capture_output=True)
check('cancelled worker fenced',failed.returncode!=0 and 'verification_lease_conflict' in failed.stderr)
check('cancel remains durable',sql(f"select state from public.audit_verification_jobs where id='{j}';")=='cancelled')
# An expired lease can be reclaimed, but its previous worker cannot publish.
j=job()
sql(f"update public.audit_verification_jobs set scheduled_at='-infinity' where id='{j}';")
old=json.loads(sql("select public.m13_04_claim_verification('m13-restart-old')::text;"))
sql(f"update public.audit_verification_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id='{j}';")
# Lock unrelated synthetic queue rows briefly rather than alter their priority/state.
locker_name='m13_range_queue_lock_'+uuid.uuid4().hex
locker=subprocess.Popen(BASE,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
locker.stdin.write(f"begin; set local application_name='{locker_name}'; select id from public.audit_verification_jobs where id<>'{j}' and state='queued' for update; select pg_sleep(2); rollback;");locker.stdin.close()
for _ in range(100):
    if sql(f"select count(*) from pg_stat_activity where application_name='{locker_name}' and wait_event='PgSleep';")=='1': break
    time.sleep(.02)
else: raise AssertionError('queue lock fixture did not enter sleep')
new=json.loads(sql("select public.m13_04_claim_verification('m13-restart-new')::text;"))
locker.stdout.read();locker_error=locker.stderr.read()
if locker.wait(): raise RuntimeError(locker_error)
check('expired lease restart preserves range',new['id']==j and new['from_sequence']==old['from_sequence'] and new['to_sequence']==old['to_sequence'] and new['version']>old['version'])
query=f"select public.m13_04_checkpoint_verification('{org}','{j}','m13-restart-old','{old['lease_token']}',{old['version']},null,null);"
failed=subprocess.run(BASE,input=query,text=True,capture_output=True)
check('restarted worker fences previous lease',failed.returncode!=0 and 'verification_lease_conflict' in failed.stderr)
cancel(j)
# Moving a dependency row emits receipts for both its old and new organizations.
# Membership uniqueness prevents moving the owner into its existing tenant; a fresh member provides a real move.
moving=str(uuid.uuid4())
sql(f"insert into public.users(id,email) values('{moving}','{moving}@m13.invalid'); insert into public.organization_members(organization_id,user_id,role) values('{org}','{moving}','viewer');")
move_xid=sql(f"begin; update public.organization_members set organization_id='{org2}' where organization_id='{org}' and user_id='{moving}'; select pg_current_xact_id(); commit;").splitlines()[0]
check('old/new organization scope receipts',sql(f"select count(distinct after_redacted->>'organizationId') from public.audit_logs where action='audit.range.scope_changed' and after_redacted->>'xid'='{move_xid}' and after_redacted->>'organizationId' in ('{org}','{org2}');")=='2')
# Two real connections reuse one logical read UUID while its receipt is uncommitted.
j=job()
read_id=str(uuid.uuid4())
application='m13_range_read_'+uuid.uuid4().hex
query=f"begin; set local application_name='{application}'; select public.m13_04_read_verification('{org}','{user}','{j}','{read_id}'); select pg_sleep(2); commit;"
reader=subprocess.Popen(BASE,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
reader.stdin.write(query);reader.stdin.close()
for _ in range(100):
    if sql(f"select count(*) from pg_stat_activity where application_name='{application}' and wait_event='PgSleep';")=='1': break
    time.sleep(.02)
else: raise AssertionError('read receipt transaction did not enter sleep')
replayed=sql(f"select public.m13_04_read_verification('{org}','{user}','{j}','{read_id}')->>'id';")
output=reader.stdout.read();error=reader.stderr.read();status=reader.wait()
check('concurrent logical read replay succeeds',status==0 and replayed==j)
if status: raise RuntimeError(error)
check('one immutable logical read receipt',sql(f"select count(*) from public.audit_logs where event_scope='security' and event_key='audit.range.status_read:{read_id}';")=='1')
cancel(j)
print('Synthetic fixtures retained only in disposable database:',DB)
PY
