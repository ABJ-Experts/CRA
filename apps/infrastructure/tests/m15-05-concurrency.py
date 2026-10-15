#!/usr/bin/env python3
"""Real two-connection races. Run only in a task-owned disposable source.

Durable audit receipts remain for inspection. Only generated test rows in the
two new backup tables are removed; pre-existing application data is untouched.
"""
import concurrent.futures
import json
import os
import subprocess
import uuid

container=os.environ.get('M15_05_TEST_CONTAINER','')
if not container.startswith('cra_m15_05_'):
    raise SystemExit('A task-owned cra_m15_05_* container is required')
instance=str(uuid.uuid4());actor=str(uuid.uuid4());request_key=str(uuid.uuid4())
def control(action,payload):
    args=[instance,actor,action,json.dumps(payload)]
    literals=["'"+x.replace("'","''")+"'" for x in args]
    query='select public.m15_05_backup_control('+','.join(literals)+');'
    result=subprocess.check_output(['docker','exec','-i',container,'psql','-U','postgres','-d','postgres','-Atq','-v','ON_ERROR_STOP=1'],input=query.encode()).decode().strip()
    return json.loads(result)
def parallel(action,payloads):
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        return list(pool.map(lambda p:control(action,p),payloads))
configuration={'sourceAlias':'source','repositoryAlias':'off-host','stagingAlias':'private-ram','keyAlias':'backup-key','targetProfile':'isolated-saas','residency':'eu','schedulingEnabled':False,'checkpointIntervalMinutes':30,'baseIntervalHours':24,'verificationIntervalDays':30,'retentionDays':30,'pauseLimitSeconds':120}
validation=control('policy/validate',{'configuration':configuration})
assert control('policy/validated',{'configurationDigest':validation['result']['configurationDigest']})['outcome']=='ok'
assert control('policy/update',{'expectedVersion':0,'idempotencyKey':str(uuid.uuid4()),'configuration':configuration})['outcome']=='ok'
request={'expectedVersion':1,'idempotencyKey':request_key,'kind':'capture'}
created=parallel('run/create',[request,request])
assert all(x['outcome']=='ok' for x in created)
assert created[0]['result']['id']==created[1]['result']['id']
assert control('run/create',{**request,'kind':'verification'})['outcome']=='conflict'
claims=parallel('run/claim',[{'workerId':'worker-one','kind':'capture'},{'workerId':'worker-two','kind':'capture'}])
assert sorted(x['outcome'] for x in claims)==['empty','ok']
claim=next(x for x in claims if x['outcome']=='ok')['result']
worker='worker-one' if claims[0]['outcome']=='ok' else 'worker-two'
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    heartbeat=pool.submit(control,'run/heartbeat',{'runId':claim['id'],'workerId':worker,'expectedVersion':claim['version']})
    cancel=pool.submit(control,'run/cancel',{'runId':claim['id'],'idempotencyKey':str(uuid.uuid4()),'expectedVersion':claim['version']})
    outcomes=[heartbeat.result()['outcome'],cancel.result()['outcome']]
assert sorted(outcomes)==['conflict','ok']
subprocess.run(['docker','exec','-i',container,'psql','-U','postgres','-d','postgres','-Atq','-v','ON_ERROR_STOP=1'],input=f"delete from public.backup_runs where instance_id='{instance}';delete from public.backup_policies where instance_id='{instance}';".encode(),check=True)
print(json.dumps({'instanceId':instance,'tests':{'duplicateCreation':'passed','changedPayload':'passed','singleLeaseWinner':'passed','concurrentVersionConflict':'passed'},'auditFixturesRetained':True,'taskBackupRowsRemoved':True},indent=2))
