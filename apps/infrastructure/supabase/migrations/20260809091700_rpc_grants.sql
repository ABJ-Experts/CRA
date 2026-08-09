-- =============================================================================
-- EXECUTE grants for the functions the API calls over PostgREST.
-- =============================================================================
-- WHY THIS MIGRATION EXISTS, AND THE BUG THAT PRODUCED IT
--
-- The baseline migration revokes function privileges from PUBLIC — which is
-- correct, and is the fix for the "REVOKE ... FROM anon is a no-op when the
-- privilege is held via PUBLIC" trap. But EXECUTE on a new function is granted
-- to PUBLIC by default and to nobody else, so revoking it from PUBLIC also
-- removed it from `service_role`, which only ever held it that way.
--
-- The symptom was silent and nasty: `supabase.rpc('record_login_failure', ...)`
-- returned an error the service ignored, so every failed sign-in was recorded
-- nowhere and the account lockout never triggered. The security control looked
-- present in the schema, had passing SQL-level tests, and did nothing at all
-- through the application. Caught by the end-to-end flow, not by unit tests —
-- which is the argument for having the end-to-end flow.
--
-- So: every function the API invokes by name is listed HERE, explicitly. One
-- place to read, one place to audit. A function absent from this list is not
-- callable over the wire, which is the correct default.
--
-- NOT listed, deliberately:
--   * set_updated_at, handle_new_user, handle_user_email_change,
--     enforce_last_owner, bump_permissions_version, init_permissions_version,
--     bump_session_epoch_for_member — trigger functions. Postgres executes a
--     trigger as the table owner, so they need no grant, and granting one would
--     let a client invoke them directly with forged arguments.
--   * the RLS helpers (user_is_member_of etc.) — granted to `authenticated` in
--     their own migration because policy expressions evaluate as the querying
--     role. service_role bypasses RLS and never calls them.
-- =============================================================================

grant execute on function
  public.record_login_failure(text, integer, interval, interval)
  to service_role;

grant execute on function public.is_login_locked(text)      to service_role;
grant execute on function public.clear_login_attempts(text) to service_role;
grant execute on function public.bump_session_epoch(uuid)   to service_role;
grant execute on function public.expire_stale_invitations()  to service_role;
