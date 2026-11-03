import type { Project, Task, TaskDetail } from "../types/Task";

let n = 0;
export const makeTask = (o: Partial<Task> = {}): Task => {
  const id = o.id ?? ++n + 100;
  return {
    id,
    number: id,
    key: `GEN-${id}`,
    title: `Task ${id}`,
    description: null,
    status: "TODO",
    priority: "MEDIUM",
    startDate: null,
    dueDate: null,
    estimateHours: null,
    actualHours: null,
    position: id * 1024,
    completedAt: null,
    archivedAt: null,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
    organizationId: "org1",
    projectId: "p1",
    parentId: null,
    milestoneId: null,
    createdById: 1,
    assigneeId: null,
    project: { id: "p1", key: "GEN", name: "General", color: "#6366f1" },
    createdBy: { id: 1, email: "me@example.com", name: null },
    assignee: null,
    milestone: null,
    labels: [],
    checklistTotal: 0,
    checklistDone: 0,
    subtaskCount: 0,
    dependsOnIds: [],
    blockedBy: [],
    isBlocked: false,
    customFields: {},
    attachmentCount: 0,
    isRecurring: false,
    seriesId: null,
    ...o,
  };
};

export const makeDetail = (o: Partial<TaskDetail> = {}): TaskDetail => ({
  ...makeTask(o),
  parent: null,
  subtasks: [],
  checklist: [],
  dependencies: [],
  blocking: [],
  watchers: [],
  isWatching: false,
  activity: [],
  permissions: { edit: true, delete: true, createSubtasks: true },
  recurrence: null,
  previousOccurrence: null,
  nextOccurrence: null,
  attachments: [],
  approvals: [],
  approvalRequired: false,
  ...o,
});

export const makeProject = (o: Partial<Project> = {}): Project => ({
  id: "p1",
  key: "GEN",
  name: "General",
  description: null,
  status: "ACTIVE",
  visibility: "ORGANIZATION",
  color: "#6366f1",
  startDate: null,
  dueDate: null,
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
  owner: { id: 1, email: "me@example.com", name: null },
  team: null,
  stats: { total: 0, done: 0, open: 0, overdue: 0, progress: 0 },
  health: "on_track",
  completionApproval: "NONE",
  capabilities: { projectId: "p1", manage: true, createTasks: true, editTasks: "any", deleteTasks: "any", projectRole: "MANAGER" },
  ...o,
});

export const page = (items: Task[]) => ({ items, total: items.length, limit: 200, offset: 0 });

type Handler = (config?: { params?: Record<string, string> }) => unknown;

/** Routes mocked GETs by path (exact, or the first matching regex). Unknown paths reject with 404. */
export const routes = (table: [string | RegExp, Handler | unknown][]) => async (url: string, config?: { params?: Record<string, string> }) => {
  for (const [match, value] of table) {
    if (typeof match === "string" ? match === url : match.test(url)) {
      return { data: typeof value === "function" ? (value as Handler)(config) : value };
    }
  }
  return Promise.reject({ response: { status: 404, data: { message: `No mock for ${url}` } } });
};
