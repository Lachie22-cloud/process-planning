-- 007_seed.sql: Rocklea site seed data
-- Site, resources (43 mixers, 16 dispersers, pot groups),
-- default substitution rules, roles, permissions, super_admin user

BEGIN;

-- ============================================================
-- 1. CREATE ROCKLEA SITE
-- ============================================================
INSERT INTO sites (id, name, code, timezone, week_end_day, schedule_horizon, active)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Rocklea',
  'RKL',
  'Australia/Brisbane',
  5,     -- Friday
  7,     -- 7-day view
  TRUE
);

-- ============================================================
-- 2. SEED ROLES
-- ============================================================
INSERT INTO roles (id, code, name, scope) VALUES
  ('00000000-0000-0000-0000-000000000101', 'super_admin', 'Super Admin', 'platform'),
  ('00000000-0000-0000-0000-000000000102', 'site_admin',  'Site Admin',  'site'),
  ('00000000-0000-0000-0000-000000000103', 'member',      'Member',      'site');

-- ============================================================
-- 3. SEED PERMISSIONS
-- ============================================================
INSERT INTO permissions (id, code, description) VALUES
  ('00000000-0000-0000-0000-000000000201', 'batches.read',       'View batch schedule'),
  ('00000000-0000-0000-0000-000000000202', 'batches.write',      'Create and edit batches'),
  ('00000000-0000-0000-0000-000000000203', 'batches.delete',     'Delete batches'),
  ('00000000-0000-0000-0000-000000000204', 'batches.import',     'Import batches from files'),
  ('00000000-0000-0000-0000-000000000205', 'batches.move',       'Move batches between resources/dates'),
  ('00000000-0000-0000-0000-000000000206', 'batches.status',     'Change batch status'),
  ('00000000-0000-0000-0000-000000000211', 'resources.read',     'View resources'),
  ('00000000-0000-0000-0000-000000000212', 'resources.write',    'Create and edit resources'),
  ('00000000-0000-0000-0000-000000000213', 'resources.delete',   'Delete resources'),
  ('00000000-0000-0000-0000-000000000221', 'rules.read',         'View schedule rules'),
  ('00000000-0000-0000-0000-000000000222', 'rules.write',        'Create and edit schedule rules'),
  ('00000000-0000-0000-0000-000000000223', 'rules.delete',       'Delete schedule rules'),
  ('00000000-0000-0000-0000-000000000231', 'users.read',         'View users'),
  ('00000000-0000-0000-0000-000000000232', 'users.write',        'Manage users'),
  ('00000000-0000-0000-0000-000000000241', 'alerts.read',        'View alerts'),
  ('00000000-0000-0000-0000-000000000242', 'alerts.write',       'Create and edit alerts'),
  ('00000000-0000-0000-0000-000000000251', 'audit.read',         'View audit logs'),
  ('00000000-0000-0000-0000-000000000261', 'notifications.read', 'View notifications'),
  ('00000000-0000-0000-0000-000000000271', 'site.read',          'View site settings'),
  ('00000000-0000-0000-0000-000000000272', 'site.write',         'Edit site settings'),
  ('00000000-0000-0000-0000-000000000281', 'blocks.read',        'View resource blocks'),
  ('00000000-0000-0000-0000-000000000282', 'blocks.write',       'Create and edit resource blocks'),
  ('00000000-0000-0000-0000-000000000291', 'statistics.read',    'View statistics/KPIs');

-- ============================================================
-- 4. SEED ROLE_PERMISSIONS
-- super_admin gets all, site_admin gets all, member gets read-only + status + move
-- ============================================================

-- super_admin: all permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-000000000101', id FROM permissions;

-- site_admin: all permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-000000000102', id FROM permissions;

-- member: read permissions + batch status/move
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-000000000103', id FROM permissions
WHERE code IN (
  'batches.read', 'batches.status', 'batches.move',
  'resources.read', 'rules.read', 'alerts.read',
  'audit.read', 'notifications.read', 'site.read',
  'blocks.read', 'statistics.read'
);

-- ============================================================
-- 5. CREATE SUPER ADMIN USER
-- ============================================================
INSERT INTO site_users (id, site_id, external_id, email, display_name, role)
VALUES (
  '00000000-0000-0000-0000-000000000901',
  '00000000-0000-0000-0000-000000000001',
  'seed:super_admin',
  'admin@smartschedule.local',
  'System Admin',
  'super_admin'
);

INSERT INTO user_site_roles (user_id, site_id, role_id)
VALUES (
  '00000000-0000-0000-0000-000000000901',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000101'
);

-- ============================================================
-- 6. SEED RESOURCES - MIXERS
-- ============================================================

-- Variable for site_id reference
-- Using the fixed Rocklea site_id throughout

-- TK1 - Solvent Based 5000L
INSERT INTO resources (site_id, resource_code, resource_type, display_name, trunk_line, group_name, min_capacity, max_capacity, max_batches_per_day, chemical_base, sort_order, config) VALUES
  ('00000000-0000-0000-0000-000000000001', 'MIXER6',  'mixer', 'Mixer 6',  'TK1', 'TK1_SB',       800,  5000, 1, 'solvent', 10, '{"colour_type": "CLEARS"}'),
  ('00000000-0000-0000-0000-000000000001', 'MIXER7',  'mixer', 'Mixer 7',  'TK1', 'TK1_SB',       800,  5000, 1, 'solvent', 11, '{"colour_type": "WHITE"}'),
  ('00000000-0000-0000-0000-000000000001', 'MIXER13', 'mixer', 'Mixer 13', 'TK1', 'TK1_SB',       800,  5000, 1, 'solvent', 12, '{"colour_type": "YELLOW"}'),
  ('00000000-0000-0000-0000-000000000001', 'MIXER14', 'mixer', 'Mixer 14', 'TK1', 'TK1_SB',       800,  5000, 1, 'solvent', 13, '{"colour_type": "CATALYST"}');

-- TK1 - Solvent Based 2500L (Small)
INSERT INTO resources (site_id, resource_code, resource_type, display_name, trunk_line, group_name, min_capacity, max_capacity, max_batches_per_day, chemical_base, sort_order, config) VALUES
  ('00000000-0000-0000-0000-000000000001', 'MIXER21', 'mixer', 'Mixer 21', 'TK1', 'TK1_SB_SMALL', 500,  2500, 1, 'solvent', 20, '{"colour_type": "CATALYST"}'),
  ('00000000-0000-0000-0000-000000000001', 'MIXER22', 'mixer', 'Mixer 22', 'TK1', 'TK1_SB_SMALL', 500,  2500, 1, 'solvent', 21, '{"colour_type": "MIO"}'),
  ('00000000-0000-0000-0000-000000000001', 'MIXER23', 'mixer', 'Mixer 23', 'TK1', 'TK1_SB_SMALL', 500,  2500, 1, 'solvent', 22, '{"colour_type": "ETCH"}'),
  ('00000000-0000-0000-0000-000000000001', 'MIXER24', 'mixer', 'Mixer 24', 'TK1', 'TK1_SB_SMALL', 500,  2500, 1, 'solvent', 23, '{"colour_type": "SILVER"}');

-- TK3 - Solvent Based (AVS Clear)
INSERT INTO resources (site_id, resource_code, resource_type, display_name, trunk_line, group_name, min_capacity, max_capacity, max_batches_per_day, chemical_base, sort_order, config) VALUES
  ('00000000-0000-0000-0000-000000000001', 'MIXER5',  'mixer', 'Mixer 5',  'TK3', 'TK3_SB',       800,  5000,  1, 'solvent', 30, '{"colour_type": "AVS CLR"}'),
  ('00000000-0000-0000-0000-000000000001', 'MIXER1',  'mixer', 'Mixer 1',  'TK3', 'TK3_SB',       3000, 20000, 1, 'solvent', 31, '{"colour_type": "AVS CLR"}');

-- TK2 - Water Based 5000L
INSERT INTO resources (site_id, resource_code, resource_type, display_name, trunk_line, group_name, min_capacity, max_capacity, max_batches_per_day, chemical_base, sort_order, config) VALUES
  ('00000000-0000-0000-0000-000000000001', 'MIXER2',  'mixer', 'Mixer 2',  'TK2', 'TK2_WB',       800,  5000, 1, 'water', 40, '{"colour_type": "WHITE"}'),
  ('00000000-0000-0000-0000-000000000001', 'MIXER3',  'mixer', 'Mixer 3',  'TK2', 'TK2_WB',       800,  5000, 1, 'water', 41, '{"colour_type": "WHITE"}'),
  ('00000000-0000-0000-0000-000000000001', 'MIXER4',  'mixer', 'Mixer 4',  'TK2', 'TK2_WB',       800,  5000, 1, 'water', 42, '{"colour_type": "COLOUR"}'),
  ('00000000-0000-0000-0000-000000000001', 'MIXER9',  'mixer', 'Mixer 9',  'TK2', 'TK2_WB',       800,  5000, 1, 'water', 43, '{"colour_type": "WHITE"}'),
  ('00000000-0000-0000-0000-000000000001', 'MIXER10', 'mixer', 'Mixer 10', 'TK2', 'TK2_WB',       800,  5000, 1, 'water', 44, '{"colour_type": "WHITE"}'),
  ('00000000-0000-0000-0000-000000000001', 'MIXER11', 'mixer', 'Mixer 11', 'TK2', 'TK2_WB',       800,  5000, 1, 'water', 45, '{"colour_type": "WHITE"}'),
  ('00000000-0000-0000-0000-000000000001', 'MIXER12', 'mixer', 'Mixer 12', 'TK2', 'TK2_WB',       800,  5000, 1, 'water', 46, '{"colour_type": "BLACK"}'),
  ('00000000-0000-0000-0000-000000000001', 'MIXER8',  'mixer', 'Mixer 8',  'TK2', 'TK2_WB',       800,  5000, 1, 'water', 47, '{"colour_type": "WHITE"}');

-- TK2 - Water Based 2250L (Small)
INSERT INTO resources (site_id, resource_code, resource_type, display_name, trunk_line, group_name, min_capacity, max_capacity, max_batches_per_day, chemical_base, sort_order, config) VALUES
  ('00000000-0000-0000-0000-000000000001', 'MIXER16', 'mixer', 'Mixer 16', 'TK2', 'TK2_WB_SMALL', 500,  2250, 1, 'water', 50, '{"colour_type": "COLOUR"}'),
  ('00000000-0000-0000-0000-000000000001', 'MIXER17', 'mixer', 'Mixer 17', 'TK2', 'TK2_WB_SMALL', 500,  2250, 1, 'water', 51, '{"colour_type": "YELLOW"}'),
  ('00000000-0000-0000-0000-000000000001', 'MIXER18', 'mixer', 'Mixer 18', 'TK2', 'TK2_WB_SMALL', 500,  2250, 1, 'water', 52, '{"colour_type": "WHITE"}'),
  ('00000000-0000-0000-0000-000000000001', 'MIXER15', 'mixer', 'Mixer 15', 'TK2', 'TK2_WB_SMALL', 500,  2250, 1, 'water', 55, '{"colour_type": "COLOUR"}');

-- TK2 - Water Based 2500L (Small)
INSERT INTO resources (site_id, resource_code, resource_type, display_name, trunk_line, group_name, min_capacity, max_capacity, max_batches_per_day, chemical_base, sort_order, config) VALUES
  ('00000000-0000-0000-0000-000000000001', 'MIXER19', 'mixer', 'Mixer 19', 'TK2', 'TK2_WB_SMALL', 500,  2500, 1, 'water', 53, '{"colour_type": "WHITE"}'),
  ('00000000-0000-0000-0000-000000000001', 'MIXER20', 'mixer', 'Mixer 20', 'TK2', 'TK2_WB_SMALL', 500,  2500, 1, 'water', 54, '{"colour_type": "SILVER"}');

-- TK4 - Solvent Colour 5000L
INSERT INTO resources (site_id, resource_code, resource_type, display_name, trunk_line, group_name, min_capacity, max_capacity, max_batches_per_day, chemical_base, sort_order, config) VALUES
  ('00000000-0000-0000-0000-000000000001', 'MIXER25', 'mixer', 'Mixer 25', 'TK4', 'TK4_SB',       800,  5000, 1, 'solvent', 60, '{"colour_type": "COLOUR"}'),
  ('00000000-0000-0000-0000-000000000001', 'MIXER26', 'mixer', 'Mixer 26', 'TK4', 'TK4_SB',       800,  5000, 1, 'solvent', 61, '{"colour_type": "COLOUR"}'),
  ('00000000-0000-0000-0000-000000000001', 'MIXER27', 'mixer', 'Mixer 27', 'TK4', 'TK4_SB',       800,  5000, 1, 'solvent', 62, '{"colour_type": "WHITE"}'),
  ('00000000-0000-0000-0000-000000000001', 'MIXER31', 'mixer', 'Mixer 31', 'TK4', 'TK4_SB',       800,  5000, 1, 'solvent', 63, '{"colour_type": "COLOUR"}'),
  ('00000000-0000-0000-0000-000000000001', 'MIXER32', 'mixer', 'Mixer 32', 'TK4', 'TK4_SB',       800,  5000, 1, 'solvent', 64, '{"colour_type": "SS COLOUR"}'),
  ('00000000-0000-0000-0000-000000000001', 'MIXER33', 'mixer', 'Mixer 33', 'TK4', 'TK4_SB',       800,  5000, 1, 'solvent', 65, '{"colour_type": "WHITE"}'),
  ('00000000-0000-0000-0000-000000000001', 'MIXER28', 'mixer', 'Mixer 28', 'TK4', 'TK4_SB',       800,  5000, 1, 'solvent', 66, '{"colour_type": "COLOUR"}'),
  ('00000000-0000-0000-0000-000000000001', 'MIXER29', 'mixer', 'Mixer 29', 'TK4', 'TK4_SB',       800,  5000, 1, 'solvent', 67, '{"colour_type": "WHITE"}'),
  ('00000000-0000-0000-0000-000000000001', 'MIXER30', 'mixer', 'Mixer 30', 'TK4', 'TK4_SB',       800,  5000, 1, 'solvent', 68, '{"colour_type": "COLOUR"}');

-- TK5 - Solvent Large White 9500L
INSERT INTO resources (site_id, resource_code, resource_type, display_name, trunk_line, group_name, min_capacity, max_capacity, max_batches_per_day, chemical_base, sort_order, config) VALUES
  ('00000000-0000-0000-0000-000000000001', 'MIXER38', 'mixer', 'Mixer 38', 'TK5', 'TK5_SB',       2000, 9500, 1, 'solvent', 70, '{"colour_type": "WHITE"}'),
  ('00000000-0000-0000-0000-000000000001', 'MIXER39', 'mixer', 'Mixer 39', 'TK5', 'TK5_SB',       2000, 9500, 1, 'solvent', 71, '{"colour_type": "WHITE"}'),
  ('00000000-0000-0000-0000-000000000001', 'MIXER40', 'mixer', 'Mixer 40', 'TK5', 'TK5_SB',       2000, 9500, 1, 'solvent', 72, '{"colour_type": "WHITE"}'),
  ('00000000-0000-0000-0000-000000000001', 'MIXER34', 'mixer', 'Mixer 34', 'TK5', 'TK5_SB',       2000, 9500, 1, 'solvent', 73, '{"colour_type": "WHITE"}');

-- TK6 - Water Large
INSERT INTO resources (site_id, resource_code, resource_type, display_name, trunk_line, group_name, min_capacity, max_capacity, max_batches_per_day, chemical_base, sort_order, config) VALUES
  ('00000000-0000-0000-0000-000000000001', 'MIXER36', 'mixer', 'Mixer 36', 'TK6', 'TK6_WB',       3000, 19000, 1, 'water', 80, '{"colour_type": "BLACK"}'),
  ('00000000-0000-0000-0000-000000000001', 'MIXER41', 'mixer', 'Mixer 41', 'TK6', 'TK6_WB',       2000, 9500,  1, 'water', 81, '{"colour_type": "HARDROCK"}'),
  ('00000000-0000-0000-0000-000000000001', 'MIXER42', 'mixer', 'Mixer 42', 'TK6', 'TK6_WB',       2000, 9500,  1, 'water', 82, '{"colour_type": "COLOUR"}'),
  ('00000000-0000-0000-0000-000000000001', 'MIXER43', 'mixer', 'Mixer 43', 'TK6', 'TK6_WB',       2000, 9500,  1, 'water', 83, '{"colour_type": "WHITE"}');

-- Thinners
INSERT INTO resources (site_id, resource_code, resource_type, display_name, trunk_line, group_name, min_capacity, max_capacity, max_batches_per_day, chemical_base, sort_order, config) VALUES
  ('00000000-0000-0000-0000-000000000001', 'MIXER37A', 'mixer', 'Mixer 37A', 'THINNERS', 'THINNERS', 800, 5000, 1, 'solvent', 90, '{"colour_type": "THINNERS"}'),
  ('00000000-0000-0000-0000-000000000001', 'MIXER37B', 'mixer', 'Mixer 37B', 'THINNERS', 'THINNERS', 800, 5000, 1, 'solvent', 91, '{"colour_type": "THINNERS"}');

-- Mixer count: 4 + 4 + 2 + 8 + 4 + 2 + 9 + 4 + 4 + 2 = 43 mixer resources

-- ============================================================
-- 7. SEED RESOURCES - POTS
-- ============================================================

-- TK1 - Solvent Pots (900L, multiple per day)
INSERT INTO resources (site_id, resource_code, resource_type, display_name, trunk_line, group_name, min_capacity, max_capacity, max_batches_per_day, chemical_base, sort_order, config) VALUES
  ('00000000-0000-0000-0000-000000000001', 'SBPOT1', 'pot', 'SB Pot 1', 'TK1', 'POT', 100, 900, 4, 'solvent', 100, '{"pot_group": "SB_POT"}'),
  ('00000000-0000-0000-0000-000000000001', 'SBPOT2', 'pot', 'SB Pot 2', 'TK1', 'POT', 100, 900, 4, 'solvent', 101, '{"pot_group": "SB_POT"}'),
  ('00000000-0000-0000-0000-000000000001', 'SBPOT3', 'pot', 'SB Pot 3', 'TK1', 'POT', 100, 900, 4, 'solvent', 102, '{"pot_group": "SB_POT"}');

-- TK2 - Water Pots (900L, multiple per day)
INSERT INTO resources (site_id, resource_code, resource_type, display_name, trunk_line, group_name, min_capacity, max_capacity, max_batches_per_day, chemical_base, sort_order, config) VALUES
  ('00000000-0000-0000-0000-000000000001', 'WBPOT1', 'pot', 'WB Pot 1', 'TK2', 'POT', 100, 900, 4, 'water', 110, '{"pot_group": "WB_POT"}'),
  ('00000000-0000-0000-0000-000000000001', 'WBPOT2', 'pot', 'WB Pot 2', 'TK2', 'POT', 100, 900, 4, 'water', 111, '{"pot_group": "WB_POT"}'),
  ('00000000-0000-0000-0000-000000000001', 'WBPOT3', 'pot', 'WB Pot 3', 'TK2', 'POT', 100, 900, 4, 'water', 112, '{"pot_group": "WB_POT"}'),
  ('00000000-0000-0000-0000-000000000001', 'WBPOT4', 'pot', 'WB Pot 4', 'TK2', 'POT', 100, 900, 4, 'water', 113, '{"pot_group": "WB_POT"}');

-- TK2 - SS Pots (900L, multiple per day)
INSERT INTO resources (site_id, resource_code, resource_type, display_name, trunk_line, group_name, min_capacity, max_capacity, max_batches_per_day, chemical_base, sort_order, config) VALUES
  ('00000000-0000-0000-0000-000000000001', 'SSPOT1', 'pot', 'SS Pot 1', 'TK2', 'POT', 100, 900, 4, 'water', 120, '{"pot_group": "SS_POT"}'),
  ('00000000-0000-0000-0000-000000000001', 'SSPOT2', 'pot', 'SS Pot 2', 'TK2', 'POT', 100, 900, 4, 'water', 121, '{"pot_group": "SS_POT"}');

-- Total pots: 3 + 4 + 2 = 9
-- Total mixer resources: 43
-- Total mixer + pot resources: 43 + 9 = 52

-- ============================================================
-- 8. SEED RESOURCES - DISPERSERS (16 total)
-- ============================================================
INSERT INTO resources (site_id, resource_code, resource_type, display_name, trunk_line, group_name, min_capacity, max_capacity, max_batches_per_day, chemical_base, sort_order, config) VALUES
  ('00000000-0000-0000-0000-000000000001', 'BUEHLER2', 'disperser', 'Buehler 2',  NULL, 'DISPERSER', 200, 2000, 6, NULL, 200, '{"max_pmc_capacity": 6}'),
  ('00000000-0000-0000-0000-000000000001', 'ABI',      'disperser', 'ABI',        NULL, 'DISPERSER', 200, 1500, 6, NULL, 201, '{"max_pmc_capacity": 6}'),
  ('00000000-0000-0000-0000-000000000001', 'SUS',      'disperser', 'SUS',        NULL, 'DISPERSER', 200, 1500, 6, NULL, 202, '{"max_pmc_capacity": 6}'),
  ('00000000-0000-0000-0000-000000000001', 'BUEHLER',  'disperser', 'Buehler',    NULL, 'DISPERSER', 200, 1500, 6, NULL, 203, '{"max_pmc_capacity": 6}'),
  ('00000000-0000-0000-0000-000000000001', 'YSTRAL',   'disperser', 'Ystral',     NULL, 'DISPERSER', 200, 1500, 1, NULL, 204, '{"max_pmc_capacity": 1}'),
  ('00000000-0000-0000-0000-000000000001', 'ONS2',     'disperser', 'ONS 2',      NULL, 'DISPERSER', 100, 1000, 2, NULL, 205, '{"max_pmc_capacity": 2}'),
  ('00000000-0000-0000-0000-000000000001', 'ONS',      'disperser', 'ONS',        NULL, 'DISPERSER', 100, 1000, 3, NULL, 206, '{"max_pmc_capacity": 3}'),
  ('00000000-0000-0000-0000-000000000001', 'DUO',      'disperser', 'DUO',        NULL, 'DISPERSER', 100, 1000, 3, NULL, 207, '{"max_pmc_capacity": 3}'),
  ('00000000-0000-0000-0000-000000000001', 'NTZ1',     'disperser', 'NTZ 1',      NULL, 'DISPERSER', 200, 1500, 5, NULL, 208, '{"max_pmc_capacity": 5}'),
  ('00000000-0000-0000-0000-000000000001', 'NTZ2',     'disperser', 'NTZ 2',      NULL, 'DISPERSER', 200, 1500, 5, NULL, 209, '{"max_pmc_capacity": 5}'),
  ('00000000-0000-0000-0000-000000000001', 'HSD',      'disperser', 'HSD',        NULL, 'DISPERSER', 100, 1000, 6, NULL, 210, '{"max_pmc_capacity": 6}'),
  ('00000000-0000-0000-0000-000000000001', 'HSD5',     'disperser', 'HSD 5',      NULL, 'DISPERSER', 100, 1000, 6, NULL, 211, '{"max_pmc_capacity": 6}'),
  ('00000000-0000-0000-0000-000000000001', 'HSD2',     'disperser', 'HSD 2',      NULL, 'DISPERSER', 100, 1000, 6, NULL, 212, '{"max_pmc_capacity": 6}'),
  ('00000000-0000-0000-0000-000000000001', 'VSM',      'disperser', 'VSM',        NULL, 'DISPERSER', 100, 1000, 6, NULL, 213, '{"max_pmc_capacity": 6}'),
  ('00000000-0000-0000-0000-000000000001', 'MIX',      'disperser', 'Straight Mixes', NULL, 'DISPERSER_SPECIAL', NULL, NULL, 99, NULL, 214, '{"is_special": true}'),
  ('00000000-0000-0000-0000-000000000001', 'INTERS',   'disperser', 'Intermediates',  NULL, 'DISPERSER_SPECIAL', NULL, NULL, 99, NULL, 215, '{"is_special": true}');

-- ============================================================
-- 9. SEED SUBSTITUTION RULES
-- Using subqueries to reference resource IDs by code
-- ============================================================

-- Helper: get resource ID by code at Rocklea
-- TK1 - Solvent 5000L interchangeable (MIXER6, MIXER7, MIXER13)
INSERT INTO substitution_rules (site_id, source_resource_id, target_resource_id, conditions, enabled) VALUES
  -- MIXER6 → MIXER7, MIXER13
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER6'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER7'),
   NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER6'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER13'),
   NULL, TRUE),
  -- MIXER7 → MIXER6, MIXER13
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER7'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER6'),
   NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER7'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER13'),
   NULL, TRUE),
  -- MIXER13 → MIXER6, MIXER7
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER13'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER6'),
   NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER13'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER7'),
   NULL, TRUE),
  -- MIXER14 → MIXER21 (only for small batches)
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER14'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER21'),
   '{"maxVolume": 2500}', TRUE);

-- TK1 - Solvent 2500L fully interchangeable (MIXER21-24)
INSERT INTO substitution_rules (site_id, source_resource_id, target_resource_id, conditions, enabled) VALUES
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER21'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER22'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER21'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER23'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER21'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER24'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER22'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER21'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER22'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER23'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER22'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER24'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER23'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER21'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER23'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER22'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER23'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER24'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER24'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER21'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER24'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER22'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER24'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER23'), NULL, TRUE);

-- TK3 - AVS Clear (MIXER5, MIXER1) conditional
INSERT INTO substitution_rules (site_id, source_resource_id, target_resource_id, conditions, enabled) VALUES
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER5'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER1'),
   '{"minVolume": 5000}', TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER1'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER5'),
   '{"maxVolume": 5000}', TRUE);

-- TK2 - Water 5000L White interchangeable (MIXER2, 3, 8, 9, 10, 11)
INSERT INTO substitution_rules (site_id, source_resource_id, target_resource_id, conditions, enabled) VALUES
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER2'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER3'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER2'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER8'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER2'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER9'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER2'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER10'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER2'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER11'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER3'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER2'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER3'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER8'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER3'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER9'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER3'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER10'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER3'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER11'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER8'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER2'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER8'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER3'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER8'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER9'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER8'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER10'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER8'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER11'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER9'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER2'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER9'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER3'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER9'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER8'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER9'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER10'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER9'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER11'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER10'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER2'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER10'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER3'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER10'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER8'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER10'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER9'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER10'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER11'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER11'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER2'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER11'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER3'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER11'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER8'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER11'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER9'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER11'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER10'), NULL, TRUE);

-- TK2 - Water Small interchangeable pairs
INSERT INTO substitution_rules (site_id, source_resource_id, target_resource_id, conditions, enabled) VALUES
  -- MIXER15 ↔ MIXER16
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER15'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER16'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER16'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER15'), NULL, TRUE),
  -- MIXER16 ↔ MIXER17
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER16'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER17'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER17'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER16'), NULL, TRUE),
  -- MIXER18 ↔ MIXER19
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER18'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER19'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER19'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER18'), NULL, TRUE),
  -- MIXER19 ↔ MIXER20
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER19'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER20'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER20'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER19'), NULL, TRUE);

-- TK4 - Solvent Colour interchangeable (MIXER25, 26, 28, 30, 31)
INSERT INTO substitution_rules (site_id, source_resource_id, target_resource_id, conditions, enabled) VALUES
  -- MIXER25 ↔ MIXER26, MIXER28, MIXER30, MIXER31
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER25'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER26'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER25'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER28'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER25'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER30'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER25'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER31'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER26'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER25'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER26'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER28'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER26'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER30'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER26'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER31'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER28'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER25'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER28'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER26'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER28'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER30'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER28'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER31'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER30'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER25'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER30'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER26'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER30'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER28'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER30'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER31'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER31'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER25'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER31'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER26'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER31'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER28'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER31'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER30'), NULL, TRUE),
  -- MIXER27 ↔ MIXER29 ↔ MIXER33 (White)
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER27'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER29'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER27'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER33'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER29'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER27'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER29'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER33'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER33'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER27'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER33'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER29'), NULL, TRUE);

-- TK5 - Solvent Large White fully interchangeable (MIXER34, 38, 39, 40)
INSERT INTO substitution_rules (site_id, source_resource_id, target_resource_id, conditions, enabled) VALUES
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER34'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER38'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER34'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER39'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER34'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER40'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER38'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER34'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER38'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER39'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER38'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER40'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER39'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER34'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER39'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER38'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER39'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER40'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER40'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER34'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER40'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER38'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER40'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER39'), NULL, TRUE);

-- TK6 - Water Large interchangeable (MIXER41, 42, 43) — MIXER36 has no substitutes
INSERT INTO substitution_rules (site_id, source_resource_id, target_resource_id, conditions, enabled) VALUES
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER41'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER42'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER41'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER43'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER42'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER41'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER42'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER43'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER43'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER41'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER43'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER42'), NULL, TRUE);

-- Thinners - fully interchangeable (MIXER37A, MIXER37B)
INSERT INTO substitution_rules (site_id, source_resource_id, target_resource_id, conditions, enabled) VALUES
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER37A'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER37B'), NULL, TRUE),
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER37B'),
   (SELECT id FROM resources WHERE site_id = '00000000-0000-0000-0000-000000000001' AND resource_code = 'MIXER37A'), NULL, TRUE);

COMMIT;
