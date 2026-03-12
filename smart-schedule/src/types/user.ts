export type UserRole = "super_admin" | "site_admin" | "member";

export interface User {
  id: string;
  siteId: string;
  externalId: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  active: boolean;
  preferences: UserPreferences;
  createdAt: string;
  updatedAt: string;
}

export interface UserPreferences {
  sidebarCollapsed?: boolean;
  scheduleHorizon?: number;
  [key: string]: unknown;
}
