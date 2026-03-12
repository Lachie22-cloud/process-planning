export const PERMISSIONS = {
  // Batches
  "batches.read": "View batch schedule",
  "batches.write": "Edit batch details",
  "batches.schedule": "Schedule/reschedule batches",
  "batches.status": "Change batch status",

  // Resources
  "resources.read": "View resources",
  "resources.write": "Edit resource configuration",

  // Rules
  "rules.read": "View scheduling rules",
  "rules.write": "Edit scheduling rules",

  // Planning
  "planning.import": "Import SAP data",
  "planning.coverage": "View coverage analysis",
  "planning.vet": "Approve or reject batch vetting",
  "planning.export": "Export planning data (CSV/Excel)",
  "planning.ai": "Use AI-assisted scheduling tools",

  // Admin
  "admin.users": "Manage site users",
  "admin.settings": "Edit site settings",
  "admin.sites": "Manage all sites (super admin)",

  // Alerts
  "alerts.read": "View alerts",
  "alerts.acknowledge": "Acknowledge alerts",
  "alerts.write": "Create and edit alerts",
} as const;

export type Permission = keyof typeof PERMISSIONS;
