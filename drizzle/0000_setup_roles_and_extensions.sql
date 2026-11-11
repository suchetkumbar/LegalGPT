-- pgvector, used from Phase 1 for clause embeddings.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint

-- app_user is the role every request-scoped query runs as (via SET LOCAL ROLE).
-- It cannot log in and does not bypass row-level security, unlike the Neon owner role.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
END
$$;--> statement-breakpoint

-- Let the migrating (owner) role switch into app_user.
DO $$
BEGIN
  EXECUTE format('GRANT app_user TO %I', current_user);
END
$$;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO app_user;--> statement-breakpoint

-- Tables and sequences created by later migrations are granted automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
