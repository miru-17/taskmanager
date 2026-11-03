import { QueryClient, useMutation, useQuery, useQueryClient, keepPreviousData, type QueryKey } from "@tanstack/react-query";
import toast from "react-hot-toast";
import api from "../services/api";
import { getErrorMessage } from "./errors";
import type {
  Milestone,
  OrgMember,
  Project,
  ProjectMember,
  SavedView,
  Task,
  TaskDetail,
  TaskPage,
  TeamDetail,
  TeamSummary,
  LabelRef,
  CustomField,
  TemplateSummary,
  ApprovalListItem,
} from "../types/Task";
import { useAuth } from "../context/AuthContext";

export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        retry: (count, error) => {
          const status = (error as { response?: { status?: number } }).response?.status;
          // 4xx won't fix themselves
          return status !== undefined && status < 500 ? false : count < 2;
        },
      },
    },
  });

/** Everything is scoped by organisation so switching orgs never shows stale data from the other one. */
const useOrgKey = () => useAuth().organization?.id ?? "none";

// ─── Task filters ↔ query string ─────────────────────────────────────────────

export interface TaskFilters {
  projectId?: string;
  status?: string[];
  priority?: string[];
  assigneeId?: "me" | "none" | number;
  createdById?: "me" | number;
  labelId?: string;
  milestoneId?: string;
  parentId?: "none" | number;
  q?: string;
  dueFrom?: string;
  dueTo?: string;
  overdue?: boolean;
  archived?: "exclude" | "include" | "only";
  watching?: boolean;
  sort?: string;
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export const toParams = (f: TaskFilters): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    out[k] = Array.isArray(v) ? v.join(",") : String(v);
  }
  return out;
};

// ─── Tasks ───────────────────────────────────────────────────────────────────

export const taskKeys = {
  all: (org: string) => ["org", org, "tasks"] as const,
  list: (org: string, f: TaskFilters) => ["org", org, "tasks", "list", toParams(f)] as const,
  detail: (org: string, id: number) => ["org", org, "tasks", "detail", id] as const,
};

export const useTasks = (filters: TaskFilters, enabled = true) => {
  const org = useOrgKey();
  return useQuery({
    queryKey: taskKeys.list(org, filters),
    queryFn: async () => (await api.get<TaskPage>("/tasks", { params: toParams(filters) })).data,
    placeholderData: keepPreviousData,
    enabled,
  });
};

export const useTask = (id: number | null) => {
  const org = useOrgKey();
  return useQuery({
    queryKey: taskKeys.detail(org, id ?? 0),
    queryFn: async () => (await api.get<TaskDetail>(`/tasks/${id}`)).data,
    enabled: id !== null,
  });
};

/** After any task write: tasks, project stats and milestones may all have changed. */
const useInvalidateWork = () => {
  const qc = useQueryClient();
  const org = useOrgKey();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: taskKeys.all(org) }),
      qc.invalidateQueries({ queryKey: ["org", org, "projects"] }),
    ]);
};

export type TaskInput = Partial<{
  title: string;
  description: string | null;
  status: string;
  priority: string;
  projectId: string;
  assigneeId: number | null;
  parentId: number | null;
  milestoneId: string | null;
  startDate: string | null;
  dueDate: string | null;
  estimateHours: number | null;
  actualHours: number | null;
  position: number;
  labelIds: string[];
  customFields: Record<string, unknown>;
}>;

const onError = (fallback: string) => (err: unknown) => {
  toast.error(getErrorMessage(err, fallback));
};

export const useCreateTask = () => {
  const invalidate = useInvalidateWork();
  return useMutation({
    mutationFn: async (input: TaskInput) => (await api.post<Task>("/tasks", input)).data,
    onSuccess: () => invalidate(),
    onError: onError("Could not create the task"),
  });
};

/**
 * Optimistic: list caches update immediately (so a board drag lands instantly),
 * then roll back if the server refuses — e.g. 409 TASK_BLOCKED.
 */
export const useUpdateTask = () => {
  const qc = useQueryClient();
  const org = useOrgKey();
  const invalidate = useInvalidateWork();
  return useMutation({
    mutationFn: async ({ id, input }: { id: number; input: TaskInput }) => (await api.patch<Task>(`/tasks/${id}`, input)).data,
    onMutate: async ({ id, input }) => {
      await qc.cancelQueries({ queryKey: taskKeys.all(org) });
      const snapshots = qc.getQueriesData<TaskPage>({ queryKey: [...taskKeys.all(org), "list"] });
      const simple = Object.fromEntries(
        Object.entries(input).filter(([k]) => ["status", "priority", "position", "title", "dueDate", "startDate"].includes(k))
      );
      for (const [key, page] of snapshots) {
        if (!page) continue;
        qc.setQueryData<TaskPage>(key, { ...page, items: page.items.map((t) => (t.id === id ? { ...t, ...simple } : t)) });
      }
      return { snapshots };
    },
    onError: (err, _vars, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => qc.setQueryData(key as QueryKey, data));
      toast.error(getErrorMessage(err, "Could not update the task"));
    },
    onSettled: () => invalidate(),
  });
};

export const useTaskAction = <V,>(fn: (vars: V) => Promise<unknown>, fallback = "Something went wrong") => {
  const invalidate = useInvalidateWork();
  return useMutation({ mutationFn: fn, onSuccess: () => invalidate(), onError: onError(fallback) });
};

export const useDeleteTask = () => useTaskAction((id: number) => api.delete(`/tasks/${id}`), "Could not delete the task");

export const useBulk = () =>
  useTaskAction(
    (body: { ids: number[]; action: "update" | "archive" | "unarchive" | "delete"; data?: Record<string, unknown> }) => api.post("/tasks/bulk", body),
    "Bulk action failed"
  );

// ─── Projects ────────────────────────────────────────────────────────────────

export const useProjects = (includeArchived = false) => {
  const org = useOrgKey();
  return useQuery({
    queryKey: ["org", org, "projects", "list", includeArchived],
    queryFn: async () => (await api.get<Project[]>("/projects", { params: includeArchived ? { includeArchived: "true" } : {} })).data,
  });
};

export const useProject = (id: string | undefined) => {
  const org = useOrgKey();
  return useQuery({
    queryKey: ["org", org, "projects", "detail", id],
    queryFn: async () => (await api.get<Project>(`/projects/${id}`)).data,
    enabled: Boolean(id),
  });
};

export const useMilestones = (projectId: string | undefined) => {
  const org = useOrgKey();
  return useQuery({
    queryKey: ["org", org, "projects", "milestones", projectId],
    queryFn: async () => (await api.get<Milestone[]>(`/projects/${projectId}/milestones`)).data,
    enabled: Boolean(projectId),
  });
};

export const useProjectMembers = (projectId: string | undefined) => {
  const org = useOrgKey();
  return useQuery({
    queryKey: ["org", org, "projects", "members", projectId],
    queryFn: async () => (await api.get<ProjectMember[]>(`/projects/${projectId}/members`)).data,
    enabled: Boolean(projectId),
  });
};

export const useProjectAction = <V, R = unknown>(fn: (vars: V) => Promise<R>, fallback = "Something went wrong") => {
  const qc = useQueryClient();
  const org = useOrgKey();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org", org] }),
    onError: onError(fallback),
  });
};

// ─── People, labels, teams, views ────────────────────────────────────────────

export const useOrgMembers = () => {
  const org = useOrgKey();
  const { can } = useAuth();
  return useQuery({
    queryKey: ["org", org, "members"],
    queryFn: async () => (await api.get<OrgMember[]>("/orgs/current/members")).data,
    enabled: can("members:read"),
    staleTime: 120_000,
  });
};

export const useLabels = () => {
  const org = useOrgKey();
  const { can } = useAuth();
  return useQuery({
    queryKey: ["org", org, "labels"],
    queryFn: async () => (await api.get<LabelRef[]>("/labels")).data,
    enabled: can("tasks:read"),
    staleTime: 120_000,
  });
};

export const useTeams = (enabled = true) => {
  const org = useOrgKey();
  return useQuery({
    queryKey: ["org", org, "teams", "list"],
    queryFn: async () => (await api.get<TeamSummary[]>("/teams")).data,
    enabled,
  });
};

export const useTeam = (id: string | null) => {
  const org = useOrgKey();
  return useQuery({
    queryKey: ["org", org, "teams", "detail", id],
    queryFn: async () => (await api.get<TeamDetail>(`/teams/${id}`)).data,
    enabled: Boolean(id),
  });
};

export const useSavedViews = (projectId?: string) => {
  const org = useOrgKey();
  return useQuery({
    queryKey: ["org", org, "views", projectId ?? "all"],
    queryFn: async () => (await api.get<SavedView[]>("/views", { params: projectId ? { projectId } : {} })).data,
  });
};

export const useOrgAction = useProjectAction;

// ─── Phase 3b: fields, templates, approvals, files ───────────────────────────

export const useFields = (projectId: string | undefined) => {
  const org = useOrgKey();
  return useQuery({
    queryKey: ["org", org, "projects", "fields", projectId],
    queryFn: async () => (await api.get<CustomField[]>(`/projects/${projectId}/fields`)).data,
    enabled: Boolean(projectId),
    staleTime: 60_000,
  });
};

export const useTemplates = (projectId: string | undefined, enabled = true) => {
  const org = useOrgKey();
  return useQuery({
    queryKey: ["org", org, "templates", projectId ?? "all"],
    queryFn: async () => (await api.get<TemplateSummary[]>("/templates", { params: projectId ? { projectId } : {} })).data,
    enabled,
  });
};

export const useApprovals = (scope: "to-me" | "by-me") => {
  const org = useOrgKey();
  return useQuery({
    queryKey: ["org", org, "tasks", "approvals", scope],
    queryFn: async () => (await api.get<ApprovalListItem[]>("/approvals", { params: { scope } })).data,
  });
};

/** Lives under the tasks key so every task write refreshes the badge too. */
export const useApprovalCount = () => {
  const org = useOrgKey();
  const { can } = useAuth();
  return useQuery({
    queryKey: ["org", org, "tasks", "approvals", "count"],
    queryFn: async () => (await api.get<{ pending: number }>("/approvals/count")).data.pending,
    enabled: can("tasks:read"),
    refetchInterval: 60_000,
  });
};

export const useStorageUsage = (enabled: boolean) => {
  const org = useOrgKey();
  return useQuery({
    queryKey: ["org", org, "tasks", "storage"],
    queryFn: async () =>
      (await api.get<{ usedBytes: number; files: number; quotaBytes: number; maxFileBytes: number; allowedExtensions: string[] }>("/attachments/usage")).data,
    enabled,
    staleTime: 60_000,
  });
};
