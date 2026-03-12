export interface Notification {
  id: string;
  siteId: string;
  userId: string | null;
  title: string | null;
  message: string | null;
  type: "warning" | "info" | "error" | null;
  read: boolean;
  batchId: string | null;
  createdAt: string;
}
