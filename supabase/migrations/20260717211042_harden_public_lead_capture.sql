-- Lead creation and profile corrections now pass through contact-capture.
-- Browser clients no longer need direct table privileges.
revoke all on table public.leads from anon, authenticated;
grant all on table public.leads to service_role;
