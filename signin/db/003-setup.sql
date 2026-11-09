-- The setup page (/setup): people marked setup_admin can add logins and choose which apps, firms and
-- roles each person has. The first one is set by hand on the server (deploy/RUNBOOK.md).
BEGIN;
ALTER TABLE identity.accounts ADD COLUMN IF NOT EXISTS setup_admin boolean NOT NULL DEFAULT false;
GRANT UPDATE (display_name, active, setup_admin) ON identity.accounts TO rule29_signin_app;
COMMIT;
