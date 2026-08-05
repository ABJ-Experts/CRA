-- Step 4 — let a user read their OWN user_account row by their JWT subject, so
-- the auth pipeline can resolve user_account.id before an organisation is active.
-- Adds an app.supabase_user_id transaction-local setting to the policy.
drop policy tenant_isolation on user_account;
create policy tenant_isolation on user_account
  using (
    id = nullif(current_setting('app.user_id', true), '')::uuid
    or supabase_user_id = nullif(current_setting('app.supabase_user_id', true), '')::uuid
    or exists (
      select 1 from org_member m
      where m.user_account_id = user_account.id
        and m.organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
    )
  );
