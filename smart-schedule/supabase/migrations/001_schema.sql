-- 001_schema.sql: Core auth & tenant tables
-- Sites, site_users, roles, permissions, role_permissions, user_site_roles

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- SITES (Tenant Definition)
-- ============================================================
CREATE TABLE sites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,
  code          TEXT NOT NULL UNIQUE,
  timezone      TEXT NOT NULL DEFAULT 'Australia/Brisbane',
  week_end_day  INTEGER NOT NULL DEFAULT 5,        -- 5=Friday (ISO day)
  schedule_horizon INTEGER NOT NULL DEFAULT 7,     -- 5 or 7 day view
  config        JSONB NOT NULL DEFAULT '{}',       -- site-specific settings
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SITE_USERS (User-Site Membership)
-- ============================================================
CREATE TABLE site_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  external_id   TEXT NOT NULL,                     -- OIDC subject / Azure AD object ID
  email         TEXT NOT NULL,
  display_name  TEXT,
  role          TEXT NOT NULL DEFAULT 'member',    -- 'super_admin', 'site_admin', 'member'
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  preferences   JSONB NOT NULL DEFAULT '{}',       -- sidebar state, view prefs
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_site_users_site_external UNIQUE (site_id, external_id)
);

-- ============================================================
-- ROLES (RBAC Role Definitions)
-- ============================================================
CREATE TABLE roles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,              -- 'super_admin', 'site_admin', 'member'
  name          TEXT NOT NULL,                     -- display name
  scope         TEXT NOT NULL,                     -- 'platform' or 'site'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- PERMISSIONS (Permission Action Definitions)
-- ============================================================
CREATE TABLE permissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,              -- e.g. 'batches.read', 'rules.write'
  description   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ROLE_PERMISSIONS (Role-Permission Mapping)
-- ============================================================
CREATE TABLE role_permissions (
  role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (role_id, permission_id)
);

-- ============================================================
-- USER_SITE_ROLES (User-Role Assignment)
-- ============================================================
CREATE TABLE user_site_roles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES site_users(id) ON DELETE CASCADE,
  site_id       UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_user_site_roles UNIQUE (user_id, site_id, role_id)
);

-- ============================================================
-- INDEXES for auth tables
-- ============================================================
CREATE INDEX idx_site_users_site_id_external_id ON site_users(site_id, external_id);
CREATE INDEX idx_site_users_email ON site_users(email);
