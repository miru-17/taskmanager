import type { ProjectCapabilities, Task } from "../../types/Task";

/**
 * UI hint only (hides drag handles and checkboxes the server would refuse).
 * Mirrors core/access.ts canTouchTask: "own" = creator, or assignee for edits.
 */
export const canEditTask = (caps: ProjectCapabilities | undefined, userId: number | undefined, t: Pick<Task, "createdById" | "assigneeId">) => {
  if (!caps || caps.editTasks === "none") return false;
  if (caps.editTasks === "any") return true;
  return t.createdById === userId || t.assigneeId === userId;
};

export const canDeleteTask = (caps: ProjectCapabilities | undefined, userId: number | undefined, t: Pick<Task, "createdById">) => {
  if (!caps || caps.deleteTasks === "none") return false;
  return caps.deleteTasks === "any" || t.createdById === userId;
};
