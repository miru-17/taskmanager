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
  /** fieldId → stored value (see CustomField for the type) */
  customFields: Record<string, unknown>;
  attachmentCount: number;
  isRecurring: boolean;
  seriesId: string | null;
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
  recurrence: Recurrence | null;
  previousOccurrence: { id: number; key: string } | null;
  nextOccurrence: { id: number; key: string } | null;
  attachments: Attachment[];
  approvals: ApprovalRequest[];
  /** The project requires an approved request before a task can be completed */
  approvalRequired: boolean;
}

export type Frequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export interface Recurrence {
  id: string;
  frequency: Frequency;
  interval: number;
  /** 0 = Monday … 6 = Sunday */
  weekdays: number[];
  monthDay: number | null;
  endsOn: string | null;
  maxOccurrences: number | null;
  occurrences: number;
  active: boolean;
  summary: string;
}

export interface Attachment {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  uploadedBy: UserRef | null;
}

export type ApprovalState = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
export interface ApprovalRequest {
  id: string;
  rule: "ANY" | "ALL";
  status: ApprovalState;
  note: string | null;
  createdAt: string;
  decidedAt: string | null;
  consumedAt: string | null;
  requestedBy: UserRef | null;
  steps: { decision: "PENDING" | "APPROVED" | "REJECTED"; comment: string | null; decidedAt: string | null; approver: UserRef }[];
}

/** An approval as listed in the inbox, with its task */
export interface ApprovalListItem extends ApprovalRequest {
  task: { id: number; key: string; number: number; title: string; status: TaskStatus; dueDate: string | null; project: { id: string; key: string; name: string; color: string } };
}

export type CustomFieldType = "TEXT" | "NUMBER" | "DATE" | "SELECT" | "MULTI_SELECT" | "CHECKBOX" | "URL" | "USER";
export const FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  TEXT: "Text",
  NUMBER: "Number",
  DATE: "Date",
  SELECT: "Single select",
  MULTI_SELECT: "Multi select",
  CHECKBOX: "Checkbox",
  URL: "Link",
  USER: "Person",
};
export interface FieldOption {
  id: string;
  label: string;
  color: string;
}
export interface CustomField {
  id: string;
  projectId: string;
  name: string;
  type: CustomFieldType;
  options: FieldOption[] | null;
  required: boolean;
  description: string | null;
  position: number;
}

export interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
  projectId: string | null;
  subtaskCount: number;
  checklistCount: number;
  createdBy?: UserRef | null;
  payload: { title: string; priority: Priority; dueInDays?: number | null; checklist: string[]; subtasks: { title: string }[] };
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
  completionApproval: "NONE" | "REQUIRED";
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

// ─── Phase 4: collaboration ──────────────────────────────────────────────────

export const REACTIONS = ["👍", "👎", "🎉", "❤️", "😄", "👀", "🚀", "✅"] as const;
export type Reaction = (typeof REACTIONS)[number];

export interface Comment {
  id: string;
  parentId: string | null;
  /** Text with a small markdown subset; mentions are @[Name](user:ID) */
  body: string;
  deleted: boolean;
  editedAt: string | null;
  createdAt: string;
  author: UserRef | null;
  reactions: { emoji: Reaction; count: number; mine: boolean }[];
}
export interface CommentThread extends Comment {
  replies: Comment[];
}

export type NotificationType = "MENTIONED" | "COMMENTED" | "ASSIGNED" | "STATUS_CHANGED" | "APPROVAL_REQUESTED" | "APPROVAL_DECIDED" | "DUE_SOON";
export const NOTIFICATION_LABELS: Record<NotificationType, string> = {
  MENTIONED: "Someone mentions you",
  COMMENTED: "New comments on tasks you watch",
  ASSIGNED: "A task is assigned to you",
  STATUS_CHANGED: "Status changes on tasks you watch",
  APPROVAL_REQUESTED: "Your approval is requested",
  APPROVAL_DECIDED: "Your approval request is decided",
  DUE_SOON: "A task assigned to you is due tomorrow",
};

export interface AppNotification {
  id: string;
  type: NotificationType;
  taskId: number | null;
  readAt: string | null;
  createdAt: string;
  actor: UserRef | null;
  data: {
    key: string;
    title: string;
    projectId: string;
    projectName: string;
    actorName: string;
    excerpt?: string;
    from?: TaskStatus;
    to?: TaskStatus;
    outcome?: "APPROVED" | "REJECTED";
    completed?: boolean;
  };
}

export type FeedItem =
  | { kind: "activity"; id: string; type: string; changes: Record<string, unknown> | null; createdAt: string; actor: UserRef | null; task: { id: number; key: string; title: string } }
  | { kind: "comment"; id: string; excerpt: string; createdAt: string; actor: UserRef | null; task: { id: number; key: string; title: string } };

// ─── Phase 5: analytics ──────────────────────────────────────────────────────

export interface AnalyticsRange {
  from: string;
  to: string;
  tz: string;
  days: number;
}
export interface AnalyticsSummary {
  range: AnalyticsRange;
  open: number;
  overdue: number;
  created: number;
  completed: number;
  cycleTime: { averageDays: number | null; medianDays: number | null; sample: number };
  onTime: { rate: number | null; onTime: number; withDueDate: number };
  hours: { estimated: number; actual: number; sample: number };
  byStatus: { key: TaskStatus; count: number }[];
  byPriority: { key: Priority; count: number }[];
}
export interface TrendPoint {
  start: string;
  created: number;
  completed: number;
  scope: number;
  done: number;
  remaining: number;
}
export interface AnalyticsTrend {
  range: AnalyticsRange;
  bucket: "day" | "week";
  points: TrendPoint[];
}
export interface WorkloadRow {
  user: { id: number; name: string | null; email: string } | null;
  open: number;
  overdue: number;
  dueSoon: number;
  openHours: number;
  unestimated: number;
  completed: number;
}
export interface ProjectAnalytics {
  id: string;
  key: string;
  name: string;
  color: string;
  status: ProjectStatus;
  stats: ProjectStats;
  completedInRange: number;
  health: ProjectHealth;
}
