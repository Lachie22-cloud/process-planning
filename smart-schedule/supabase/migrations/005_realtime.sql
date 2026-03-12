-- 005_realtime.sql: Supabase Realtime publications
-- Enable realtime for tables that need live updates

ALTER PUBLICATION supabase_realtime ADD TABLE batches;
ALTER PUBLICATION supabase_realtime ADD TABLE audit_log;
ALTER PUBLICATION supabase_realtime ADD TABLE bulk_alerts;
ALTER PUBLICATION supabase_realtime ADD TABLE resource_blocks;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE resources;
