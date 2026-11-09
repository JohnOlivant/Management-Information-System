-- Quoting gives one person several roles at a firm and the sign-in keeps them as one comma-separated
-- list ("estimator,approver,rate_admin,..."), which did not fit in 40 characters.
BEGIN;
ALTER TABLE identity.app_access DROP CONSTRAINT IF EXISTS app_access_role_check;
ALTER TABLE identity.app_access ADD CONSTRAINT app_access_role_check CHECK (length(role) <= 400);
COMMIT;
