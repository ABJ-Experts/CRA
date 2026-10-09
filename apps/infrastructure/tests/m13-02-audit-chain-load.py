#!/usr/bin/env python3
"""Bounded append/read measurements in a disposable restored CRA database only."""
import concurrent.futures
import json
import math
import os
from pathlib import Path
import re
import statistics
import subprocess
import time
import uuid

DATABASE = os.environ.get('M13_TEST_DATABASE', '')
if not re.fullmatch(r'm13_test_[a-z0-9_]+', DATABASE):
    raise SystemExit('M13_TEST_DATABASE must name a disposable m13_test_* database')
CONTAINER = 'supabase_db_cra'
WRITERS = 12
BATCHES = 10
EVENTS_PER_BATCH = 20
ROOT = Path(__file__).resolve().parents[3]
ARTIFACT = ROOT / 'artifacts/m13-02/load.json'

def sql(statement):
    result = subprocess.run(['docker', 'exec', '-i', CONTAINER, 'psql', '-X', '-U', 'postgres', '-d', DATABASE, '-v', 'ON_ERROR_STOP=1', '-qAt'], input=statement, text=True, capture_output=True, check=True)
    return result.stdout

def distribution(values):
    values = sorted(values)
    def percentile(p):
        return round(values[min(len(values)-1, max(0, math.ceil(len(values)*p)-1))], 3)
    return {'samples':len(values), 'p50_ms':percentile(.50), 'p95_ms':percentile(.95), 'p99_ms':percentile(.99), 'max_ms':round(values[-1],3), 'mean_ms':round(statistics.mean(values),3)}

def writer(org, index):
    statements = ['\\timing on']
    for batch in range(BATCHES):
        statements += [f'\\echo batch:{batch}', 'begin;', "set local statement_timeout='30s';", f"insert into public.audit_logs(organization_id,action,changes) select '{org}'::uuid,'test.chain.load',jsonb_build_object('writer',{index},'batch',{batch},'counter',n,'description',repeat('load',64)) from generate_series(1,{EVENTS_PER_BATCH}) n;", 'commit;']
    output = sql('\n'.join(statements))
    timings = [float(x) for x in re.findall(r'Time: ([0-9.]+) ms', output)]
    if len(timings) != BATCHES*4:
        raise RuntimeError(f'Unexpected timing samples: {len(timings)}')
    return [timings[i+2]+timings[i+3] for i in range(0,len(timings),4)], [timings[i+3] for i in range(0,len(timings),4)]

def fixture():
    org = str(uuid.uuid4())
    sql(f"insert into public.organizations(id,name,slug) values('{org}','M13 isolated load','m13-load-{org}');")
    return org

def scenario(name, organizations):
    start = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=WRITERS) as executor:
        results = list(executor.map(lambda x: writer(organizations[x % len(organizations)], x), range(WRITERS)))
    elapsed = time.monotonic()-start
    integrity = sql("select count(*),bool_and(a.chain_sequence=expected_sequence and a.previous_hash=expected_previous),bool_and(a.content_hash=encode(extensions.digest(decode(a.previous_hash,'hex')||convert_to(a.canonical_content,'UTF8'),'sha256'),'hex')) from (select audit_logs.*,row_number() over(partition by organization_id order by chain_sequence) expected_sequence,lag(content_hash,1,repeat('0',64)) over(partition by organization_id order by chain_sequence) expected_previous from public.audit_logs where organization_id in ("+','.join("'"+o+"'::uuid" for o in organizations)+")) a;").strip()
    expected = WRITERS*BATCHES*EVENTS_PER_BATCH
    if integrity != f'{expected}|t|t':
        raise RuntimeError(f'Failed integrity check: {integrity}')
    return {'name':name,'organizations':organizations,'writers':WRITERS,'transactions':WRITERS*BATCHES,'events':expected,'events_per_transaction':EVENTS_PER_BATCH,'elapsed_seconds':round(elapsed,3),'events_per_second_including_client_startup':round(expected/elapsed,2),'insert_plus_commit':distribution([v for r in results for v in r[0]]),'commit_finalizer':distribution([v for r in results for v in r[1]]),'integrity':integrity}

single = scenario('same_tenant', [fixture()])
multi = scenario('independent_tenants', [fixture() for _ in range(WRITERS)])
org = single['organizations'][0]
commands = ['\\timing on']
for _ in range(20):
    commands.append(f"select octet_length(public.m13_02_audit_chain_page('{org}','0','2400',1000)::text);")
response = sql('\n'.join(commands))
read_timings = [float(x) for x in re.findall(r'Time: ([0-9.]+) ms',response)]
response_bytes = [int(x) for x in response.splitlines() if x.isdigit()]
if not response_bytes or max(response_bytes)>16777216:
    raise RuntimeError('Verification response exceeded 16MiB')
artifact = {'database':DATABASE,'measurement':'PostgreSQL psql execution timing; not end-to-end API latency or process-memory measurement','payload':'20 legacy-format redacted events per transaction with 256-byte description','scenarios':[single,multi],'verification':{'organization_id':org,'page_limit':1000,'upper_sequence':'2400','response_bytes':max(response_bytes),'response_cap_bytes':16777216,'latency':distribution(read_timings)},'cleanup':'No audit rows were deleted. Fixture organizations exist only in the disposable database; drop that database after review.'}
ARTIFACT.parent.mkdir(parents=True,exist_ok=True)
ARTIFACT.write_text(json.dumps(artifact,indent=2)+'\n')
print(json.dumps({**artifact,'scenarios':[{k:v for k,v in s.items() if k!='organizations'} for s in artifact['scenarios']]},indent=2))
