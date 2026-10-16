#!/usr/bin/env python3
"""Real overlapping PostgreSQL sessions against a disposable schema-only clone.

The source database is read only. Fixtures are committed exclusively inside a
new random test database because MVCC cannot share uncommitted rows between
connections. Every connection and the entire new database are removed in finally.
No existing database, table, worker or source row is reset or reprioritized.
"""
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import time
import uuid

CONTAINER = "supabase_db_cra"
DATABASE = "m14_04_concurrency_" + uuid.uuid4().hex
ROOT = Path(__file__).resolve().parents[1]
PROCESSES: list[subprocess.Popen[str]] = []


def command(database: str) -> list[str]:
    return ["docker", "exec", "-i", CONTAINER, "psql", "-X", "-q", "-At", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1"]


def sql(statement: str, database: str = DATABASE) -> str:
    result = subprocess.run(command(database), input="set statement_timeout='30s'; set lock_timeout='10s';\n" + statement, text=True, capture_output=True, timeout=120)
    if result.returncode:
        raise RuntimeError(result.stderr[-6000:])
    return result.stdout.strip()


def literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def overlap(first_expression: str, second_expression: str) -> tuple[dict, dict, float]:
    """First RPC finishes while holding its transaction locks for two seconds."""
    first = subprocess.Popen(command(DATABASE), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    PROCESSES.append(first)
    assert first.stdin is not None and first.stdout is not None
    first.stdin.write("set statement_timeout='30s'; set lock_timeout='10s';\nbegin;\nselect jsonb_build_object('result'," + first_expression + ");\n\\echo LOCK_HELD\nselect pg_sleep(2);\ncommit;\n")
    first.stdin.flush()
    first.stdin.close()
    first.stdin = None
    result = None
    while True:
        line = first.stdout.readline()
        if not line:
            raise RuntimeError("first connection ended before lock marker: " + (first.stderr.read() if first.stderr else ""))
        if line.startswith("{"):
            result = json.loads(line)["result"]
        if line.strip() == "LOCK_HELD":
            break
    started = time.monotonic()
    second = json.loads(sql("begin; select jsonb_build_object('result'," + second_expression + "); commit;"))["result"]
    duration = time.monotonic() - started
    _, error = first.communicate(timeout=10)
    if first.returncode:
        raise RuntimeError(error)
    assert result is not None
    return result, second, duration


def main() -> None:
    created = False
    try:
        # Only DDL is copied; the new database starts with zero application rows.
        schema = subprocess.run(["docker", "exec", CONTAINER, "pg_dump", "-U", "postgres", "-d", "postgres", "--schema-only"], capture_output=True, check=True, timeout=120).stdout
        subprocess.run(["docker", "exec", CONTAINER, "createdb", "-U", "postgres", "--template=template0", DATABASE], check=True, capture_output=True)
        created = True
        restore_command = command(DATABASE)
        restore_command[restore_command.index("-U") + 1] = "supabase_admin"
        restore = subprocess.run(restore_command, input=schema, capture_output=True, timeout=120)
        if restore.returncode:
            raise RuntimeError(restore.stderr.decode()[-6000:])
        # Allows the test before the follow-on migration is deployed locally.
        if sql("select count(*) from information_schema.columns where table_schema='public' and table_name='report_run_recipients' and column_name='last_claimed_at';") == "0":
            sql((ROOT / "supabase/migrations/20261012073440_m14_04_report_recovery_fairness.sql").read_text())
        org_a, org_b, actor_a, actor_b = [str(uuid.uuid4()) for _ in range(4)]
        config = lambda actor: json.dumps({"title": "Concurrency fixture", "report": {"kind": "list", "source": "products.registry", "format": "csv", "filters": {}, "context": {}}, "schedule": {"frequency": "daily", "timezone": "UTC", "localTime": "09:00"}, "dateWindow": {"kind": "fixed"}, "recipientUserIds": [actor], "emailEnabled": False})
        for org, actor, count, age in [(org_a, actor_a, 20, 3), (org_b, actor_b, 1, 2)]:
            c = literal(config(actor)) + "::jsonb"
            sql(f"""insert into public.users(id,email,is_active,email_verified_at) values('{actor}','fixture-{actor}@example.test',true,clock_timestamp());
insert into public.organizations(id,name,slug) values('{org}','Report concurrency fixture','m14-concurrency-{org}');
insert into public.organization_members(organization_id,user_id,role) values('{org}','{actor}','owner');
insert into public.report_definitions(organization_id,owner_user_id,state,config,config_digest,source_schema_digest,create_key,next_due_at)
select '{org}','{actor}','active',{c},public.m14_04_digest({c}),public.m14_04_digest(public.m14_03_source_policy('products.registry')),gen_random_uuid(),clock_timestamp()-interval '{age} days' from generate_series(1,{count});""")
        scheduled_a, scheduled_b, schedule_wait = overlap("public.m14_04_schedule_due('scheduler-a',100)", "public.m14_04_schedule_due('scheduler-b',100)")
        assert scheduled_a == 21 and scheduled_b == 0, (scheduled_a, scheduled_b)
        assert sql("select count(*)||':'||count(distinct (organization_id,definition_id,occurrence_key)) from public.report_runs;") == "21:21"
        assert sql("select public.m14_04_schedule_due('scheduler-restart',100);") == "0"
        claim_a, claim_b, recipient_wait = overlap("public.m14_04_claim_recipient('recipient-a')", "public.m14_04_claim_recipient('recipient-b')")
        assert claim_a["organizationId"] == org_a and claim_b["organizationId"] == org_b, (claim_a, claim_b)
        assert recipient_wait >= 1, recipient_wait
        # Dense A's remaining 19 older rows did not consume B's tenant turn.
        for claim in [claim_a, claim_b]:
            context = literal(json.dumps({"_sourceSchemaDigest": claim["sourceSchemaDigest"]}))
            sql(f"select public.m14_04_admit_export('{claim['organizationId']}','{claim['recipientId']}','{claim['workerId']}',{claim['version']},{context}::jsonb);")
        export_a, export_b, export_wait = overlap("public.m14_04_claim_export('renderer-a')", "public.m14_04_claim_export('renderer-b')")
        assert export_a["organizationId"] != export_b["organizationId"]
        assert export_wait >= 1, export_wait
        assert sql("select coalesce(max(n),0) from (select count(*) n from public.export_jobs where state in ('capturing','audit_pending','rendering') group by organization_id) s;") == "1"
        # Real expired-lease takeover: the old renderer cannot heartbeat or read.
        job_id = export_a["publicJob"]["id"]
        org = export_a["organizationId"]
        sql(f"update public.export_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where organization_id='{org}' and id='{job_id}';")
        replacement = json.loads(sql("select public.m14_04_claim_export('renderer-replacement');"))
        assert replacement["publicJob"]["id"] == job_id and replacement["version"] > export_a["version"]
        sql(f"""do $$begin
begin perform public.m14_03_heartbeat_export('{org}','{job_id}','renderer-a',{export_a['version']});raise exception 'old renderer accepted';exception when serialization_failure then if sqlerrm<>'export_worker_conflict' then raise;end if;end;
end$$;""")
        # Recipient takeover is independently fenced from the export lease.
        sql(f"update public.report_run_recipients set lease_expires_at=clock_timestamp()-interval '1 second' where organization_id='{org_a}' and id='{claim_a['recipientId']}';")
        recipient_replacement = json.loads(sql("select public.m14_04_claim_recipient('recipient-replacement');"))
        assert recipient_replacement["recipientId"] == claim_a["recipientId"]
        sql(f"""do $$begin
begin perform public.m14_04_heartbeat_recipient('{org_a}','{claim_a['recipientId']}','recipient-a',{claim_a['version']});raise exception 'old recipient worker accepted';exception when raise_exception then if sqlerrm<>'report_worker_conflict' then raise;end if;end;
end$$;""")
        print(json.dumps({"scheduler": {"overlap_seconds": round(schedule_wait, 3), "first_created": scheduled_a, "second_created": scheduled_b, "distinct_occurrences": 21}, "recipient_claim": {"overlap_wait_seconds": round(recipient_wait, 3), "dense_tenant_waiting": 19, "next_claim_served_other_tenant": True}, "export_claim": {"overlap_wait_seconds": round(export_wait, 3), "maximum_running_per_tenant": 1}, "old_export_lease_rejected": True, "old_recipient_lease_rejected": True}, indent=2))
    finally:
        for process in PROCESSES:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=10)
        if created:
            sql("drop database " + DATABASE + " with (force);", "postgres")
            assert sql("select count(*) from pg_database where datname=" + literal(DATABASE) + ";", "postgres") == "0"
            print("Disposed test database; source database unchanged.")


if __name__ == "__main__":
    main()
