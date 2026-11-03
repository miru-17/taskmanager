export type TaskStatus = "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE";
export type Priority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type ProjectStatus = "PLANNING" | "ACTIVE" | "ON_HOLD" | "COMPLETED" | "ARCHIVED";
export type ProjectVisibility = "ORGANIZATION" | "PRIVATE";
export type ProjectRole = "MANAGER" | "MEMBER" | "VIEWER";
export type ProjectHealth = "on_track" | "at_risk" | "off_track" | "completed" | "on_hold";
export type EditScope = "any" | "own" | "none";

export const STATUSES: TaskStatus[] = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"];
export const PRIORITIES: Priority[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

export const STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  IN_REVIEW: "In review",
  DONE: "Done",
};
export const PRIORITY_LABELS: Record<Priority, string> = { CRITICAL: "Critical", HIGH: "High", MEDIUM: "Medium", LOW: "Low" };
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  PLANNING: "Planning",
  ACTIVE: "Active",
  ON_HOLD: "On hold",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
};
export const HEALTH_LABELS: Record<ProjectHealth, string> = {
  on_track: "On track",
  at_risk: "At risk",
  off_track: "Off track",
  completed: "Completed",
  on_hold: "On hold",
};

export interface UserRef {
  id: number;
  email: string;
  name: string | null;
}

export interface LabelRef {
  id: string;
  name: string;
  color: string;
}

export interface Task {
  id: number;
  number: number;
  key: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  startDate: string | null;
  dueDate: string | null;
  estimateHours: number | null;
  actualHours: number | null;
  position: number;
  completedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  organizationId: string;
  projectId: string;
  parentId: number | null;
  milestoneId: string | null;
  createdById: number | null;
  assigneeId: number | null;
  project: { id: string; key: string; name: string; color: string };
  createdBy: UserRef | null;
  assignee: UserRef | null;
  milestone: { id: string; name: string } | null;
  labels: LabelRef[];
  checklistTotal: number;
  checklistDone: number;
  subtaskCount: number;
  dependsOnIds: number[];
  blockedBy: number[];
  isBlocked: boolean;
}

export interface TaskRef {
  id: number;
  key: string;
  title: string;
  status: TaskStatus;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
  position: number;
}

export interface Activity {
  id: string;
  type: string;
  changes: Record<string, unknown> | null;
  createdAt: string;
  actor: UserRef | null;
}

export interface TaskDetail extends Task {
  parent: TaskRef | null;
  subtasks: Task[];
  checklist: ChecklistItem[];
  dependencies: TaskRef[];
  blocking: TaskRef[];
  watchers: UserRef[];
  isWatching: boolean;
  activity: Activity[];
  permissions: { edit: boolean; delete: boolean; createSubtasks: boolean };
}

export interface TaskPage {
  items: Task[];
  total: number;
  limit: number;
  offset: number;
}

export interface ProjectStats {
  total: number;
  done: number;
  open: number;
  overdue: number;
  progress: number;
}

export interface ProjectCapabilities {
  projectId: string;
  manage: boolean;
  createTasks: boolean;
  editTasks: EditScope;
  deleteTasks: EditScope;
  projectRole: ProjectRole | null;
}

export interface Project {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  visibility: ProjectVisibility;
  color: string;
  startDate: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  owner: UserRef | null;
  team: { id: string; name: string } | null;
  stats: ProjectStats;
  health: ProjectHealth;
  capabilities?: ProjectCapabilities;
}

export interface Milestone {
  id: string;
  name: string;
  description: string | null;
  dueDate: string | null;
  completedAt: string | null;
  stats: ProjectStats;
}

export interface ProjectMember {
  userId: number;
  email: string;
  name: string | null;
  role: ProjectRole;
}

export interface OrgMember {
  userId: number;
  email: string;
  name: string | null;
  role: import("./auth").OrgRole;
}

export interface TeamSummary {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  projectCount: number;
  myRole: "LEAD" | "MEMBER" | null;
}

export interface TeamDetail {
  id: string;
  name: string;
  description: string | null;
  members: { role: "LEAD" | "MEMBER"; user: UserRef }[];
  projects: { id: string; key: string; name: string; color: string }[];
}

export interface SavedView {
  id: string;
  name: string;
  viewType: "board" | "list" | "calendar" | "gantt" | "my-tasks";
  projectId: string | null;
  filters: Record<string, string | string[] | boolean | null>;
  shared: boolean;
  userId: number;
  user: UserRef;
}

/** Display name for a user: their name, else the part of the email before @. */
export const displayName = (u: UserRef | { name: string | null; email: string } | null | undefined) =>
  u ? u.name || u.email.split("@")[0] : "Unassigned";
