#!/usr/bin/env python3
"""Disposable M15-05 metadata benchmark; refuses original containers.

Run M15_05_BENCH_CONTAINER=cra_m15_05_source_db python3 .../m15-05-metadata-load.py.
Only task-owned backup fixture rows are removed. PostgreSQL pgbench measures SQL
RPC latency; HTTP/TLS/browser timings must be reported separately.
"""
import json
import math
import os
import subprocess
import uuid
from pathlib import Path

container = os.environ.get("M15_05_BENCH_CONTAINER", "")
if not container.startswith("cra_m15_05_"):
    raise SystemExit("A disposable cra_m15_05_* container is required")
instance = "15000000-0000-4000-8000-000000001000"
run_token=uuid.uuid4().hex[:12]

def sql(query):
    return subprocess.check_output(["docker", "exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-v", "ON_ERROR_STOP=1"], input=query.encode()).decode().strip()

if sql(f"select exists(select 1 from public.backup_policies where instance_id='{instance}')") != "f":
    raise SystemExit("Benchmark instance already exists; refusing fixture collision")
actors = json.loads(sql("select json_agg(x) from (select organization_id,user_id from public.organization_members order by organization_id limit 2)x"))
if len(actors) != 2:
    raise SystemExit("Two task-only tenant actors are required")
configuration = json.dumps({"sourceAlias":"source","repositoryAlias":"off-host","stagingAlias":"private-ram","keyAlias":"backup-key","targetProfile":"isolated-saas","residency":"eu","schedulingEnabled":False,"checkpointIntervalMinutes":30,"baseIntervalHours":24,"verificationIntervalDays":30,"retentionDays":30,"pauseLimitSeconds":120})
fixture = f"""
insert into public.backup_policies(instance_id,configuration,configuration_digest,approved_by,mutation_key,mutation_digest)
 values('{instance}','{configuration}','{'a'*64}','benchmark',gen_random_uuid(),repeat('a',64));
insert into public.backup_runs(instance_id,kind,state,stage,configuration_revision,configuration,configuration_digest,idempotency_key,request_digest,actor_id,created_at,completed_at,failure_code,covered_organization_ids)
 select '{instance}','capture','failed','failed',1,'{configuration}',repeat('a',64),gen_random_uuid(),repeat('a',64),'benchmark',clock_timestamp()-make_interval(secs=>n),clock_timestamp()-make_interval(secs=>n),'object_missing',array[case when n<=25 then '{actors[1]['organization_id']}'::uuid else '{actors[0]['organization_id']}'::uuid end] from generate_series(1,10000)n;
analyze public.backup_runs;
"""
queries = [
    ("operator_history", f"select public.m15_05_backup_control('{instance}','backup-benchmark','run/list','{{\"limit\":25}}');"),
    ("tenant_large", f"select public.m15_05_backup_assurance('{actors[0]['organization_id']}','{actors[0]['user_id']}',25);"),
    ("tenant_small", f"select public.m15_05_backup_assurance('{actors[1]['organization_id']}','{actors[1]['user_id']}',25);"),
]
try:
    sql(fixture)
    results = []
    for label, query in queries:
        remote = f"/tmp/m15-05-bench-{run_token}-{label}.sql"
        subprocess.run(["docker", "exec", "-i", container, "sh", "-c", 'umask 077; cat > "$1"', "sh", remote], input=query.encode(), check=True)
    # All three traffic classes run together; two clients each avoid tenant starvation.
    processes=[]
    for label, _ in queries:
        processes.append((label,subprocess.Popen(["docker","exec",container,"pgbench","-U","postgres","-d","postgres","-n","-c","2","-j","2","-T","5","-l",f"--log-prefix=/tmp/m15-05-bench-{run_token}-{label}","-f",f"/tmp/m15-05-bench-{run_token}-{label}.sql"],stdout=subprocess.PIPE,stderr=subprocess.PIPE)))
    for label, process in processes:
        output,error=process.communicate()
        if process.returncode:
            raise RuntimeError(error.decode())
        # pgbench logs contain transaction duration in microseconds; no row data.
        logs=subprocess.check_output(["docker","exec",container,"sh","-c",'cat /tmp/m15-05-bench-"$1"-"$2".[0-9]*',"sh",run_token,label]).decode()
        latencies=sorted(float(line.split()[2])/1000 for line in logs.splitlines() if len(line.split())>=3)
        percentile=lambda p: latencies[min(len(latencies)-1,math.ceil(len(latencies)*p)-1)]
        results.append({"traffic":label,"clients":2,"transactions":len(latencies),"p95Ms":round(percentile(.95),3),"p99Ms":round(percentile(.99),3),"maxMs":round(latencies[-1],3),"p95TargetMet":percentile(.95)<400,"p99TargetMet":percentile(.99)<1000})
    print(json.dumps({"rows":10000,"concurrentClients":6,"durationSeconds":5,"measurement":"PostgreSQL RPC only; excludes HTTP/TLS", "results":results},indent=2))
finally:
    sql(f"delete from public.backup_runs where instance_id='{instance}';delete from public.backup_policies where instance_id='{instance}';")
