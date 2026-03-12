-- 020_ai_task_runs_service_write_only.sql
-- Restrict ai_task_runs mutation access to service_role only.
-- Admin users can still read runs via RLS.

DROP POLICY IF EXISTS ai_task_runs_insert ON ai_task_runs;
DROP POLICY IF EXISTS ai_task_runs_update ON ai_task_runs;
DROP POLICY IF EXISTS ai_task_runs_delete ON ai_task_runs;

CREATE POLICY ai_task_runs_insert ON ai_task_runs FOR INSERT
  TO service_role
  WITH CHECK (TRUE);

CREATE POLICY ai_task_runs_update ON ai_task_runs FOR UPDATE
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

CREATE POLICY ai_task_runs_delete ON ai_task_runs FOR DELETE
  TO service_role
  USING (TRUE);
