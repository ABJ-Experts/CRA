-- Step 3 — Seed the nine role templates (§7.3). Permissions themselves live in
-- the shared TS catalog (@cras/schemas ROLE_PERMISSIONS, per BRD §7.2); MVP
-- resolves a member's permissions from their role key. The role_permission table
-- exists for custom per-org roles (V2 / FR-IAM-008) and stays empty in MVP.
insert into role (id, key, display_name, is_template) values
  ('01000000-0000-7000-8000-000000000001','owner','Organisation Owner',true),
  ('01000000-0000-7000-8000-000000000002','sys_admin','System Administrator',true),
  ('01000000-0000-7000-8000-000000000003','psm','Product Security Manager',true),
  ('01000000-0000-7000-8000-000000000004','sec_eng','Security Engineer',true),
  ('01000000-0000-7000-8000-000000000005','devops','Release / DevOps Engineer',true),
  ('01000000-0000-7000-8000-000000000006','qrm','Quality / Regulatory Manager',true),
  ('01000000-0000-7000-8000-000000000007','exec','Executive / Viewer',true),
  ('01000000-0000-7000-8000-000000000008','auditor','Auditor / Notified Body',true),
  ('01000000-0000-7000-8000-000000000009','supplier','Supplier (external)',true)
on conflict (key) do nothing;
