-- 063_expire_stuck_scans.sql
-- Mark any scans stuck in pending/running for more than 30 minutes as failed.
-- This is a one-time cleanup for the scan that has been stuck for 16+ hours.

UPDATE ai_scans
SET status = 'failed',
    error_message = 'Auto-expired: scan exceeded 30-minute timeout',
    completed_at = NOW()
WHERE status IN ('pending', 'running')
  AND created_at < NOW() - INTERVAL '30 minutes';
