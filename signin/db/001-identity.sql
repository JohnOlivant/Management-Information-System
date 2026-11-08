-- Shared sign-in for the suite: one account per person, used by Quoting, Scheduling, Timesheets and the MIS.
-- Each app still owns its data and its roles; this schema only says who someone is and which apps
-- (and which firm in each app) they may open.
BEGIN;
CREATE SCHEMA IF NOT EXISTS identity;

CREATE TABLE identity.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(email) AND length(email) <= 254),
  display_name text NOT NULL DEFAULT '' CHECK (length(display_name) <= 120),
  password_hash text NOT NULL,
  must_change_password boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Which app, and which firm in that app, an account may open. tenant_id is text on purpose: quoting
-- calls the firm company_id and the timesheet calls it client_id (MIS gap G5). Until one tenant
-- identity is chosen, each row carries the id the app itself uses.
CREATE TABLE identity.app_access (
  account_id uuid NOT NULL REFERENCES identity.accounts(id) ON DELETE CASCADE,
  app text NOT NULL CHECK (app ~ '^[a-z][a-z0-9-]{1,30}$'),
  tenant_id text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 100),
  tenant_name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT '' CHECK (length(role) <= 40),
  PRIMARY KEY (account_id, app, tenant_id)
);

CREATE TABLE identity.sessions (
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES identity.accounts(id) ON DELETE CASCADE,
  csrf_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expiry ON identity.sessions (expires_at);
CREATE INDEX sessions_account ON identity.sessions (account_id);

CREATE TABLE identity.login_limits (
  identity_hash text PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rule29_signin_app') THEN
    CREATE ROLE rule29_signin_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END $$;
GRANT USAGE ON SCHEMA identity TO rule29_signin_app;
GRANT SELECT ON ALL TABLES IN SCHEMA identity TO rule29_signin_app;
GRANT UPDATE (password_hash, must_change_password) ON identity.accounts TO rule29_signin_app;
GRANT INSERT, DELETE ON identity.sessions TO rule29_signin_app;
GRANT INSERT, UPDATE, DELETE ON identity.login_limits TO rule29_signin_app;
REVOKE ALL ON ALL TABLES IN SCHEMA identity FROM PUBLIC;
COMMIT;
