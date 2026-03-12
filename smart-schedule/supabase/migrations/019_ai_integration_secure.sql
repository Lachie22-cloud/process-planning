-- 019_ai_integration_secure.sql
-- AI Agent Integration: secure schema, encrypted credentials, RBAC-enforced RLS policies,
-- wiki text storage, chat sessions, scans, drafts, and timezone-safe scheduled tasks.
--
-- Permissions used:
--   admin.settings  → AI config, wiki, scheduled tasks (admin-only)
--   planning.ai     → chat, scans, viewing scan outputs
--   planning.vet    → draft approval/rejection/application

-- =====================================================
-- 1. EXTENSION: pgcrypto for credential encryption
-- =====================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================================================
-- 2. TABLE: ai_config
--    Per-site AI credential storage with AES-256-GCM encryption.
--    The credential_encrypted column holds the raw encrypted bytes;
--    decryption happens only in the ai-agent service layer using
--    a server-side AI_ENCRYPTION_KEY (never exposed to frontend).
-- =====================================================
CREATE TABLE IF NOT EXISTS ai_config (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  key_type    TEXT NOT NULL CHECK (key_type IN ('anthropic_api_key', 'claude_auth_token')),
  credential_encrypted TEXT NOT NULL,
  credential_hint TEXT,          -- e.g. "sk-ant-...7xQ" (masked)
  credential_status TEXT NOT NULL DEFAULT 'unknown'
                    CHECK (credential_status IN ('valid', 'invalid', 'expired', 'unknown')),
  credential_expires_at   TIMESTAMPTZ,
  credential_last_validated_at TIMESTAMPTZ,
  key_version INTEGER NOT NULL DEFAULT 1,
  enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  UUID REFERENCES site_users(id) ON DELETE SET NULL,
  updated_by  UUID REFERENCES site_users(id) ON DELETE SET NULL,

  CONSTRAINT uq_ai_config_site UNIQUE (site_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_config_site ON ai_config(site_id);

-- =====================================================
-- 3. TABLE: wiki_articles
--    Rich-text wiki entries per site.  RAG retrieval queries
--    this table's content column (no file uploads needed).
-- =====================================================
CREATE TABLE IF NOT EXISTS wiki_articles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  category    TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  UUID REFERENCES site_users(id) ON DELETE SET NULL,
  updated_by  UUID REFERENCES site_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_wiki_articles_site ON wiki_articles(site_id);
CREATE INDEX IF NOT EXISTS idx_wiki_articles_site_category ON wiki_articles(site_id, category);

-- Full-text search index for wiki RAG
CREATE INDEX IF NOT EXISTS idx_wiki_articles_fts
  ON wiki_articles
  USING GIN (to_tsvector('english', title || ' ' || content));

-- =====================================================
-- 4. TABLE: ai_chat_sessions
--    One session per user conversation.  Claude Code uses
--    session_resume_id for headless session continuity.
-- =====================================================
CREATE TABLE IF NOT EXISTS ai_chat_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id             UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES site_users(id) ON DELETE CASCADE,
  title               TEXT,
  session_resume_id   TEXT,          -- Claude Code session ID for resume
  status              TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'archived')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_site_user
  ON ai_chat_sessions(site_id, user_id);
CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_status
  ON ai_chat_sessions(site_id, status);

-- =====================================================
-- 5. TABLE: ai_chat_messages
--    Individual messages within a chat session.
-- =====================================================
CREATE TABLE IF NOT EXISTS ai_chat_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
  site_id     UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content     TEXT NOT NULL,
  metadata    JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_session
  ON ai_chat_messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_site
  ON ai_chat_messages(site_id);

-- =====================================================
-- 6. TABLE: ai_scans
--    Manual or scheduled scan runs with structured results.
-- =====================================================
CREATE TABLE IF NOT EXISTS ai_scans (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  scan_type   TEXT NOT NULL CHECK (scan_type IN (
                'schedule_optimization', 'rule_analysis', 'capacity_check', 'full_audit'
              )),
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  triggered_by UUID REFERENCES site_users(id) ON DELETE SET NULL,
  scheduled_task_id UUID,         -- FK added after ai_scheduled_tasks created
  report      JSONB DEFAULT '{}'::jsonb,
  error_message TEXT,
  started_at  TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_scans_site_status
  ON ai_scans(site_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_scans_site_created
  ON ai_scans(site_id, created_at DESC);

-- =====================================================
-- 7. TABLE: ai_drafts
--    AI-generated proposals. Only status flow mutations
--    happen here; actual schedule changes go through
--    existing batch/resource APIs after approval.
-- =====================================================
CREATE TABLE IF NOT EXISTS ai_drafts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  scan_id     UUID REFERENCES ai_scans(id) ON DELETE SET NULL,
  draft_type  TEXT NOT NULL CHECK (draft_type IN (
                'schedule_change', 'rule_suggestion', 'resource_rebalance'
              )),
  title       TEXT NOT NULL,
  description TEXT,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'approved', 'rejected', 'applied')),
  created_by  UUID REFERENCES site_users(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES site_users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_comment TEXT,
  applied_by  UUID REFERENCES site_users(id) ON DELETE SET NULL,
  applied_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_drafts_site_status
  ON ai_drafts(site_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_drafts_scan
  ON ai_drafts(scan_id);

-- =====================================================
-- 8. TABLE: ai_scheduled_tasks
--    Admin-configurable cron jobs with timezone support
--    and robustness controls.
-- =====================================================
CREATE TABLE IF NOT EXISTS ai_scheduled_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  task_type       TEXT NOT NULL CHECK (task_type IN (
                    'schedule_optimization', 'rule_analysis', 'capacity_check', 'full_audit'
                  )),
  cron_expression TEXT NOT NULL,
  timezone        TEXT NOT NULL DEFAULT 'UTC',     -- IANA timezone
  misfire_policy  TEXT NOT NULL DEFAULT 'skip_if_missed'
                  CHECK (misfire_policy IN ('skip_if_missed', 'run_once_on_recovery')),
  lock_ttl_seconds    INTEGER NOT NULL DEFAULT 300,     -- lease duration for distributed lock
  retry_max           INTEGER NOT NULL DEFAULT 3,       -- max retry attempts on failure
  retry_backoff_seconds INTEGER NOT NULL DEFAULT 60,    -- backoff between retries
  enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  lock_key        TEXT,                            -- advisory lock identifier
  last_run_at     TIMESTAMPTZ,
  next_run_at     TIMESTAMPTZ,
  last_error      TEXT,
  last_run_duration_ms INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID REFERENCES site_users(id) ON DELETE SET NULL,
  updated_by      UUID REFERENCES site_users(id) ON DELETE SET NULL,

  CONSTRAINT uq_ai_scheduled_tasks_site_name UNIQUE (site_id, name)
);

CREATE INDEX IF NOT EXISTS idx_ai_scheduled_tasks_site_enabled
  ON ai_scheduled_tasks(site_id, enabled);
CREATE INDEX IF NOT EXISTS idx_ai_scheduled_tasks_next_run
  ON ai_scheduled_tasks(next_run_at)
  WHERE enabled = TRUE;

-- =====================================================
-- 8b. TABLE: ai_task_runs
--     Individual execution records for scheduled tasks.
--     Idempotency key prevents duplicate runs for the
--     same task + scheduled window (restart-safe).
-- =====================================================
CREATE TABLE IF NOT EXISTS ai_task_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID NOT NULL REFERENCES ai_scheduled_tasks(id) ON DELETE CASCADE,
  site_id         UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  scheduled_for   TIMESTAMPTZ NOT NULL,           -- the cron window this run covers
  idempotency_key TEXT NOT NULL,                   -- deterministic: task_id + scheduled_for
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  attempt         INTEGER NOT NULL DEFAULT 1,
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_ai_task_runs_idempotency UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_ai_task_runs_task_scheduled
  ON ai_task_runs(task_id, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_ai_task_runs_site_status
  ON ai_task_runs(site_id, status);

-- Add FK from ai_scans.scheduled_task_id now that the table exists
ALTER TABLE ai_scans
  ADD CONSTRAINT fk_ai_scans_scheduled_task
  FOREIGN KEY (scheduled_task_id)
  REFERENCES ai_scheduled_tasks(id)
  ON DELETE SET NULL;

-- =====================================================
-- 9. ENABLE RLS ON ALL AI TABLES
-- =====================================================
ALTER TABLE ai_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE wiki_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_scheduled_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_task_runs ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- 10. RLS POLICIES: ai_config (admin.settings only)
-- =====================================================
DROP POLICY IF EXISTS ai_config_select ON ai_config;
DROP POLICY IF EXISTS ai_config_insert ON ai_config;
DROP POLICY IF EXISTS ai_config_update ON ai_config;
DROP POLICY IF EXISTS ai_config_delete ON ai_config;

CREATE POLICY ai_config_select ON ai_config FOR SELECT
  USING (auth.has_permission('admin.settings', site_id));

CREATE POLICY ai_config_insert ON ai_config FOR INSERT
  WITH CHECK (auth.has_permission('admin.settings', site_id));

CREATE POLICY ai_config_update ON ai_config FOR UPDATE
  USING (auth.has_permission('admin.settings', site_id))
  WITH CHECK (auth.has_permission('admin.settings', site_id));

CREATE POLICY ai_config_delete ON ai_config FOR DELETE
  USING (auth.has_permission('admin.settings', site_id));

-- =====================================================
-- 11. RLS POLICIES: wiki_articles
--     admin.settings for write; planning.ai for read
-- =====================================================
DROP POLICY IF EXISTS wiki_articles_select ON wiki_articles;
DROP POLICY IF EXISTS wiki_articles_insert ON wiki_articles;
DROP POLICY IF EXISTS wiki_articles_update ON wiki_articles;
DROP POLICY IF EXISTS wiki_articles_delete ON wiki_articles;

CREATE POLICY wiki_articles_select ON wiki_articles FOR SELECT
  USING (
    auth.has_permission('planning.ai', site_id)
    OR auth.has_permission('admin.settings', site_id)
  );

CREATE POLICY wiki_articles_insert ON wiki_articles FOR INSERT
  WITH CHECK (auth.has_permission('admin.settings', site_id));

CREATE POLICY wiki_articles_update ON wiki_articles FOR UPDATE
  USING (auth.has_permission('admin.settings', site_id))
  WITH CHECK (auth.has_permission('admin.settings', site_id));

CREATE POLICY wiki_articles_delete ON wiki_articles FOR DELETE
  USING (auth.has_permission('admin.settings', site_id));

-- =====================================================
-- 12. RLS POLICIES: ai_chat_sessions
--     planning.ai to use; users see only their own sessions
-- =====================================================
DROP POLICY IF EXISTS ai_chat_sessions_select ON ai_chat_sessions;
DROP POLICY IF EXISTS ai_chat_sessions_insert ON ai_chat_sessions;
DROP POLICY IF EXISTS ai_chat_sessions_update ON ai_chat_sessions;
DROP POLICY IF EXISTS ai_chat_sessions_delete ON ai_chat_sessions;

CREATE POLICY ai_chat_sessions_select ON ai_chat_sessions FOR SELECT
  USING (
    auth.has_permission('planning.ai', site_id)
    AND (user_id = auth.current_user_id() OR auth.is_super_admin())
  );

CREATE POLICY ai_chat_sessions_insert ON ai_chat_sessions FOR INSERT
  WITH CHECK (
    auth.has_permission('planning.ai', site_id)
    AND user_id = auth.current_user_id()
  );

CREATE POLICY ai_chat_sessions_update ON ai_chat_sessions FOR UPDATE
  USING (
    auth.has_permission('planning.ai', site_id)
    AND (user_id = auth.current_user_id() OR auth.is_super_admin())
  )
  WITH CHECK (
    auth.has_permission('planning.ai', site_id)
    AND (user_id = auth.current_user_id() OR auth.is_super_admin())
  );

CREATE POLICY ai_chat_sessions_delete ON ai_chat_sessions FOR DELETE
  USING (
    user_id = auth.current_user_id()
    OR auth.is_super_admin()
  );

-- =====================================================
-- 13. RLS POLICIES: ai_chat_messages
--     planning.ai; scoped to own session
-- =====================================================
DROP POLICY IF EXISTS ai_chat_messages_select ON ai_chat_messages;
DROP POLICY IF EXISTS ai_chat_messages_insert ON ai_chat_messages;
DROP POLICY IF EXISTS ai_chat_messages_delete ON ai_chat_messages;

CREATE POLICY ai_chat_messages_select ON ai_chat_messages FOR SELECT
  USING (
    auth.has_permission('planning.ai', site_id)
    AND EXISTS (
      SELECT 1 FROM ai_chat_sessions s
      WHERE s.id = ai_chat_messages.session_id
        AND (s.user_id = auth.current_user_id() OR auth.is_super_admin())
    )
  );

CREATE POLICY ai_chat_messages_insert ON ai_chat_messages FOR INSERT
  WITH CHECK (
    auth.has_permission('planning.ai', site_id)
    AND EXISTS (
      SELECT 1 FROM ai_chat_sessions s
      WHERE s.id = ai_chat_messages.session_id
        AND s.user_id = auth.current_user_id()
    )
  );

-- Messages are immutable (no update policy); delete cascades from session
CREATE POLICY ai_chat_messages_delete ON ai_chat_messages FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM ai_chat_sessions s
      WHERE s.id = ai_chat_messages.session_id
        AND (s.user_id = auth.current_user_id() OR auth.is_super_admin())
    )
  );

-- =====================================================
-- 14. RLS POLICIES: ai_scans
--     planning.ai for read + trigger; admin.settings for delete
-- =====================================================
DROP POLICY IF EXISTS ai_scans_select ON ai_scans;
DROP POLICY IF EXISTS ai_scans_insert ON ai_scans;
DROP POLICY IF EXISTS ai_scans_update ON ai_scans;
DROP POLICY IF EXISTS ai_scans_delete ON ai_scans;

CREATE POLICY ai_scans_select ON ai_scans FOR SELECT
  USING (auth.has_permission('planning.ai', site_id));

CREATE POLICY ai_scans_insert ON ai_scans FOR INSERT
  WITH CHECK (auth.has_permission('planning.ai', site_id));

-- Updates (status changes) allowed by planning.ai (for the ai-agent service role)
CREATE POLICY ai_scans_update ON ai_scans FOR UPDATE
  USING (auth.has_permission('planning.ai', site_id))
  WITH CHECK (auth.has_permission('planning.ai', site_id));

CREATE POLICY ai_scans_delete ON ai_scans FOR DELETE
  USING (auth.has_permission('admin.settings', site_id));

-- =====================================================
-- 15. RLS POLICIES: ai_drafts
--     planning.ai for read/create;
--     planning.vet for approve/reject/apply (status mutations)
-- =====================================================
DROP POLICY IF EXISTS ai_drafts_select ON ai_drafts;
DROP POLICY IF EXISTS ai_drafts_insert ON ai_drafts;
DROP POLICY IF EXISTS ai_drafts_update ON ai_drafts;
DROP POLICY IF EXISTS ai_drafts_delete ON ai_drafts;

CREATE POLICY ai_drafts_select ON ai_drafts FOR SELECT
  USING (
    auth.has_permission('planning.ai', site_id)
    OR auth.has_permission('planning.vet', site_id)
  );

CREATE POLICY ai_drafts_insert ON ai_drafts FOR INSERT
  WITH CHECK (auth.has_permission('planning.ai', site_id));

-- Status transitions require planning.vet (approve/reject/apply)
CREATE POLICY ai_drafts_update ON ai_drafts FOR UPDATE
  USING (
    auth.has_permission('planning.vet', site_id)
    OR auth.has_permission('admin.settings', site_id)
  )
  WITH CHECK (
    auth.has_permission('planning.vet', site_id)
    OR auth.has_permission('admin.settings', site_id)
  );

CREATE POLICY ai_drafts_delete ON ai_drafts FOR DELETE
  USING (auth.has_permission('admin.settings', site_id));

-- =====================================================
-- 16. RLS POLICIES: ai_scheduled_tasks (admin.settings only)
-- =====================================================
DROP POLICY IF EXISTS ai_scheduled_tasks_select ON ai_scheduled_tasks;
DROP POLICY IF EXISTS ai_scheduled_tasks_insert ON ai_scheduled_tasks;
DROP POLICY IF EXISTS ai_scheduled_tasks_update ON ai_scheduled_tasks;
DROP POLICY IF EXISTS ai_scheduled_tasks_delete ON ai_scheduled_tasks;

CREATE POLICY ai_scheduled_tasks_select ON ai_scheduled_tasks FOR SELECT
  USING (auth.has_permission('admin.settings', site_id));

CREATE POLICY ai_scheduled_tasks_insert ON ai_scheduled_tasks FOR INSERT
  WITH CHECK (auth.has_permission('admin.settings', site_id));

CREATE POLICY ai_scheduled_tasks_update ON ai_scheduled_tasks FOR UPDATE
  USING (auth.has_permission('admin.settings', site_id))
  WITH CHECK (auth.has_permission('admin.settings', site_id));

CREATE POLICY ai_scheduled_tasks_delete ON ai_scheduled_tasks FOR DELETE
  USING (auth.has_permission('admin.settings', site_id));

-- =====================================================
-- 16b. RLS POLICIES: ai_task_runs (admin.settings for read; service_role for write)
-- =====================================================
DROP POLICY IF EXISTS ai_task_runs_select ON ai_task_runs;
DROP POLICY IF EXISTS ai_task_runs_insert ON ai_task_runs;
DROP POLICY IF EXISTS ai_task_runs_update ON ai_task_runs;
DROP POLICY IF EXISTS ai_task_runs_delete ON ai_task_runs;

CREATE POLICY ai_task_runs_select ON ai_task_runs FOR SELECT
  USING (auth.has_permission('admin.settings', site_id));

-- Inserts/updates are done by service_role (ai-agent scheduler);
-- authenticated users with admin.settings can view but not modify runs
CREATE POLICY ai_task_runs_insert ON ai_task_runs FOR INSERT
  WITH CHECK (auth.has_permission('admin.settings', site_id));

CREATE POLICY ai_task_runs_update ON ai_task_runs FOR UPDATE
  USING (auth.has_permission('admin.settings', site_id))
  WITH CHECK (auth.has_permission('admin.settings', site_id));

CREATE POLICY ai_task_runs_delete ON ai_task_runs FOR DELETE
  USING (auth.has_permission('admin.settings', site_id));

-- =====================================================
-- 17. TABLE GRANTS
--     Minimal grants: authenticated users get access only
--     through RLS policies above.  service_role bypasses RLS
--     (used by ai-agent container only).
-- =====================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_config TO authenticated;
GRANT ALL ON ai_config TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON wiki_articles TO authenticated;
GRANT ALL ON wiki_articles TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ai_chat_sessions TO authenticated;
GRANT ALL ON ai_chat_sessions TO service_role;

GRANT SELECT, INSERT, DELETE ON ai_chat_messages TO authenticated;
GRANT ALL ON ai_chat_messages TO service_role;

GRANT SELECT, INSERT, UPDATE ON ai_scans TO authenticated;
GRANT ALL ON ai_scans TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ai_drafts TO authenticated;
GRANT ALL ON ai_drafts TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ai_scheduled_tasks TO authenticated;
GRANT ALL ON ai_scheduled_tasks TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ai_task_runs TO authenticated;
GRANT ALL ON ai_task_runs TO service_role;

-- =====================================================
-- 18. TRIGGER: auto-update updated_at columns
-- =====================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'ai_config', 'wiki_articles', 'ai_chat_sessions',
    'ai_drafts', 'ai_scheduled_tasks'
  ])
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I;
       CREATE TRIGGER trg_%s_updated_at
         BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();',
      t, t, t, t
    );
  END LOOP;
END;
$$;

-- =====================================================
-- 19. HELPER: wiki full-text search function
--     Used by the AI agent for RAG retrieval.
-- =====================================================
CREATE OR REPLACE FUNCTION public.search_wiki(
  p_site_id UUID,
  p_query TEXT,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  content TEXT,
  category TEXT,
  rank REAL
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    wa.id,
    wa.title,
    wa.content,
    wa.category,
    ts_rank(
      to_tsvector('english', wa.title || ' ' || wa.content),
      plainto_tsquery('english', p_query)
    ) AS rank
  FROM wiki_articles wa
  WHERE wa.site_id = p_site_id
    AND to_tsvector('english', wa.title || ' ' || wa.content)
        @@ plainto_tsquery('english', p_query)
  ORDER BY rank DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_wiki(UUID, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_wiki(UUID, TEXT, INTEGER) TO service_role;

-- =====================================================
-- 20. HELPER: encrypt/decrypt credential functions
--     These use pgcrypto's symmetric encryption.
--     The encryption key is passed as a parameter by
--     the ai-agent service (never stored in DB).
-- =====================================================
CREATE OR REPLACE FUNCTION public.encrypt_ai_credential(
  p_plaintext TEXT,
  p_key TEXT
)
RETURNS BYTEA
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN pgp_sym_encrypt(p_plaintext, p_key);
END;
$$;

CREATE OR REPLACE FUNCTION public.decrypt_ai_credential(
  p_encrypted BYTEA,
  p_key TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN pgp_sym_decrypt(p_encrypted, p_key);
END;
$$;

-- Only service_role can call encrypt/decrypt (ai-agent backend only)
REVOKE EXECUTE ON FUNCTION public.encrypt_ai_credential(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.decrypt_ai_credential(BYTEA, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encrypt_ai_credential(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.decrypt_ai_credential(BYTEA, TEXT) TO service_role;

-- =====================================================
-- 22. RPC: apply_ai_draft
--     Atomic transaction that locks the draft row,
--     verifies status='approved', validates the payload,
--     applies domain mutations, marks draft as applied,
--     and writes an audit row.
--
--     Returns JSON: { success, draft_id, applied_at }
--     Raises EXCEPTION on stale status (caught as 409)
--     or internal failure (caught as 500).
-- =====================================================
CREATE OR REPLACE FUNCTION public.apply_ai_draft(
  p_draft_id UUID,
  p_user_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draft RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_payload JSONB;
  v_changes JSONB[];
  v_change JSONB;
  v_batch_id UUID;
  v_resource_id UUID;
  v_source_id UUID;
  v_target_id UUID;
  v_conditions JSONB;
BEGIN
  -- Step 1: Lock the draft row FOR UPDATE (prevents concurrent apply)
  SELECT * INTO v_draft
  FROM ai_drafts
  WHERE id = p_draft_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DRAFT_NOT_FOUND: Draft % does not exist', p_draft_id;
  END IF;

  -- Step 2: Verify status = 'approved'
  IF v_draft.status <> 'approved' THEN
    RAISE EXCEPTION 'DRAFT_STATUS_CONFLICT: Draft % has status %, expected approved',
      p_draft_id, v_draft.status;
  END IF;

  v_payload := v_draft.payload;

  -- Step 3: Validate payload structure based on draft_type
  CASE v_draft.draft_type
    WHEN 'schedule_change' THEN
      -- Payload must have "changes" array, each with batch_id and at least one mutation field
      IF v_payload IS NULL OR v_payload->'changes' IS NULL
         OR jsonb_typeof(v_payload->'changes') <> 'array'
         OR jsonb_array_length(v_payload->'changes') = 0 THEN
        RAISE EXCEPTION 'PAYLOAD_INVALID: schedule_change requires non-empty "changes" array';
      END IF;
      -- Validate each change has batch_id
      FOR v_change IN SELECT jsonb_array_elements(v_payload->'changes')
      LOOP
        IF v_change->>'batch_id' IS NULL THEN
          RAISE EXCEPTION 'PAYLOAD_INVALID: each schedule_change entry requires "batch_id"';
        END IF;
      END LOOP;

    WHEN 'rule_suggestion' THEN
      -- Payload must have "rules" array, each with source_resource_id and target_resource_id
      IF v_payload IS NULL OR v_payload->'rules' IS NULL
         OR jsonb_typeof(v_payload->'rules') <> 'array'
         OR jsonb_array_length(v_payload->'rules') = 0 THEN
        RAISE EXCEPTION 'PAYLOAD_INVALID: rule_suggestion requires non-empty "rules" array';
      END IF;
      FOR v_change IN SELECT jsonb_array_elements(v_payload->'rules')
      LOOP
        IF v_change->>'source_resource_id' IS NULL OR v_change->>'target_resource_id' IS NULL THEN
          RAISE EXCEPTION 'PAYLOAD_INVALID: each rule_suggestion entry requires "source_resource_id" and "target_resource_id"';
        END IF;
      END LOOP;

    WHEN 'resource_rebalance' THEN
      -- Payload must have "assignments" array, each with batch_id and new_resource_id
      IF v_payload IS NULL OR v_payload->'assignments' IS NULL
         OR jsonb_typeof(v_payload->'assignments') <> 'array'
         OR jsonb_array_length(v_payload->'assignments') = 0 THEN
        RAISE EXCEPTION 'PAYLOAD_INVALID: resource_rebalance requires non-empty "assignments" array';
      END IF;
      FOR v_change IN SELECT jsonb_array_elements(v_payload->'assignments')
      LOOP
        IF v_change->>'batch_id' IS NULL OR v_change->>'new_resource_id' IS NULL THEN
          RAISE EXCEPTION 'PAYLOAD_INVALID: each resource_rebalance entry requires "batch_id" and "new_resource_id"';
        END IF;
      END LOOP;

    ELSE
      RAISE EXCEPTION 'PAYLOAD_INVALID: unknown draft_type %', v_draft.draft_type;
  END CASE;

  -- Step 4: Apply domain mutations based on draft_type
  CASE v_draft.draft_type
    WHEN 'schedule_change' THEN
      FOR v_change IN SELECT jsonb_array_elements(v_payload->'changes')
      LOOP
        v_batch_id := (v_change->>'batch_id')::UUID;
        -- Verify batch exists and belongs to the same site
        IF NOT EXISTS (
          SELECT 1 FROM batches WHERE id = v_batch_id AND site_id = v_draft.site_id
        ) THEN
          RAISE EXCEPTION 'DOMAIN_ERROR: batch % not found in site %', v_batch_id, v_draft.site_id;
        END IF;
        -- Apply optional mutations: plan_date, plan_resource_id, status
        UPDATE batches SET
          plan_date = COALESCE((v_change->>'plan_date')::DATE, plan_date),
          plan_resource_id = COALESCE((v_change->>'plan_resource_id')::UUID, plan_resource_id),
          status = COALESCE(v_change->>'status', status),
          updated_at = v_now
        WHERE id = v_batch_id AND site_id = v_draft.site_id;
      END LOOP;

    WHEN 'rule_suggestion' THEN
      FOR v_change IN SELECT jsonb_array_elements(v_payload->'rules')
      LOOP
        v_source_id := (v_change->>'source_resource_id')::UUID;
        v_target_id := (v_change->>'target_resource_id')::UUID;
        v_conditions := COALESCE(v_change->'conditions', '{}'::JSONB);
        -- Verify both resources exist and belong to the same site
        IF NOT EXISTS (
          SELECT 1 FROM resources WHERE id = v_source_id AND site_id = v_draft.site_id
        ) THEN
          RAISE EXCEPTION 'DOMAIN_ERROR: source resource % not found in site %', v_source_id, v_draft.site_id;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM resources WHERE id = v_target_id AND site_id = v_draft.site_id
        ) THEN
          RAISE EXCEPTION 'DOMAIN_ERROR: target resource % not found in site %', v_target_id, v_draft.site_id;
        END IF;
        -- Insert substitution rule
        INSERT INTO substitution_rules (site_id, source_resource_id, target_resource_id, conditions, enabled, created_by)
        VALUES (v_draft.site_id, v_source_id, v_target_id, v_conditions, TRUE, p_user_id);
      END LOOP;

    WHEN 'resource_rebalance' THEN
      FOR v_change IN SELECT jsonb_array_elements(v_payload->'assignments')
      LOOP
        v_batch_id := (v_change->>'batch_id')::UUID;
        v_resource_id := (v_change->>'new_resource_id')::UUID;
        -- Verify batch and resource exist and belong to the same site
        IF NOT EXISTS (
          SELECT 1 FROM batches WHERE id = v_batch_id AND site_id = v_draft.site_id
        ) THEN
          RAISE EXCEPTION 'DOMAIN_ERROR: batch % not found in site %', v_batch_id, v_draft.site_id;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM resources WHERE id = v_resource_id AND site_id = v_draft.site_id
        ) THEN
          RAISE EXCEPTION 'DOMAIN_ERROR: resource % not found in site %', v_resource_id, v_draft.site_id;
        END IF;
        -- Reassign batch to new resource
        UPDATE batches SET
          plan_resource_id = v_resource_id,
          updated_at = v_now
        WHERE id = v_batch_id AND site_id = v_draft.site_id;
      END LOOP;
  END CASE;

  -- Step 5: Mark draft as applied
  UPDATE ai_drafts SET
    status = 'applied',
    applied_by = p_user_id,
    applied_at = v_now,
    updated_at = v_now
  WHERE id = p_draft_id;

  -- Step 6: Insert audit log entry
  INSERT INTO audit_log (site_id, action, details, performed_by, performed_at)
  VALUES (
    v_draft.site_id,
    'ai_draft_applied',
    jsonb_build_object(
      'draft_id', p_draft_id,
      'draft_type', v_draft.draft_type,
      'title', v_draft.title,
      'mutations_applied', v_payload
    ),
    p_user_id,
    v_now
  );

  RETURN json_build_object(
    'success', TRUE,
    'draft_id', p_draft_id,
    'draft_type', v_draft.draft_type,
    'applied_at', v_now
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_ai_draft(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_ai_draft(UUID, UUID) TO service_role;

-- =====================================================
-- 21. HELPER: upsert AI config with encryption
--     Called by the ai-agent backend (service_role) only.
-- =====================================================
CREATE OR REPLACE FUNCTION public.upsert_ai_config(
  p_site_id UUID,
  p_key_type TEXT,
  p_credential TEXT,
  p_encryption_key TEXT,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hint TEXT;
  v_encrypted BYTEA;
  v_id UUID;
BEGIN
  -- Build masked hint: first 8 chars + "..." + last 3 chars
  IF LENGTH(p_credential) > 11 THEN
    v_hint := LEFT(p_credential, 8) || '...' || RIGHT(p_credential, 3);
  ELSE
    v_hint := '***';
  END IF;

  v_encrypted := pgp_sym_encrypt(p_credential, p_encryption_key);

  INSERT INTO ai_config (site_id, key_type, credential_encrypted, credential_hint, enabled, created_by, updated_by)
  VALUES (p_site_id, p_key_type, v_encrypted, v_hint, TRUE, p_user_id, p_user_id)
  ON CONFLICT ON CONSTRAINT uq_ai_config_site
  DO UPDATE SET
    key_type = EXCLUDED.key_type,
    credential_encrypted = EXCLUDED.credential_encrypted,
    credential_hint = EXCLUDED.credential_hint,
    enabled = TRUE,
    updated_by = EXCLUDED.updated_by
  RETURNING id INTO v_id;

  RETURN json_build_object(
    'success', TRUE,
    'id', v_id,
    'hint', v_hint
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.upsert_ai_config(UUID, TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_ai_config(UUID, TEXT, TEXT, TEXT, UUID) TO service_role;
