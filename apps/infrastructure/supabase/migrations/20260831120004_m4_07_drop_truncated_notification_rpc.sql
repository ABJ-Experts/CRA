-- Clean up the accidental PostgreSQL-truncated version of the due-notification
-- RPC. The supported worker boundary is the explicit short-name function.
drop function if exists public.list_due_vulnerability_finding_review_notification_organization(integer);
