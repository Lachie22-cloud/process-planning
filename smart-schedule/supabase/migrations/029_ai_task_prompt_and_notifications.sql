-- 029_ai_task_prompt_and_notifications.sql
-- Add configurable prompt + notification recipients for scheduled AI tasks.

ALTER TABLE ai_scheduled_tasks
  ADD COLUMN IF NOT EXISTS custom_prompt TEXT,
  ADD COLUMN IF NOT EXISTS notify_user_ids UUID[] NOT NULL DEFAULT '{}';

