-- Change default schedule horizon from 7 (Sat–Fri) to 5 (Mon–Fri)
-- so the schedule view displays a standard Monday-to-Friday work week.

ALTER TABLE sites ALTER COLUMN schedule_horizon SET DEFAULT 5;

UPDATE sites SET schedule_horizon = 5 WHERE schedule_horizon = 7;
