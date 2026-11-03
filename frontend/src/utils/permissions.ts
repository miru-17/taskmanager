import type { Permission } from "../types/auth";
import type { Task } from "../types/Task";

/** UI hint only — mirrors the server's resource-level rule, which is what actually protects data. */
export const canModifyTask = (
  permissions: Permission[],
  userId: number | undefined,
  task: Pick<Task, "createdById">,
  action: "update" | "delete"
): boolean =>
  permissions.includes(`tasks:${action}_any`) ||
  (permissions.includes(`tasks:${action}_own`) && task.createdById === userId);
