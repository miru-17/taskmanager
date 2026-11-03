export interface Task {
  id: number;
  title: string;
  description?: string | null;
  status: "TODO" | "IN_PROGRESS" | "DONE";
  dueDate?: string | null;
  createdAt: string;
  updatedAt: string;
  organizationId?: string;
  createdById?: number | null;
  createdBy?: { id: number; email: string; name: string | null } | null;
}
