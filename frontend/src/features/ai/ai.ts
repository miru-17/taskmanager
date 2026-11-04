import { useQuery } from "@tanstack/react-query";
import api from "../../services/api";
import { useOrgKey } from "../../data/queries";
import type { Priority } from "../../types/Task";

/** Every AI answer says where it came from; the UI always shows it. */
export type Source = "ai" | "rules";
export type FallbackReason = "not_configured" | "disabled_by_org" | "unavailable" | "invalid_output" | "cooling_down" | null;
export interface Sourced {
  source: Source;
  fallbackReason: FallbackReason;
}

export interface AiStatus {
  configured: boolean;
  model: string | null;
  orgEnabled: boolean;
  mode: Source;
  reason: FallbackReason;
}

export interface ParsedDraft extends Sourced {
  draft: { title: string; description: string | null; priority?: Priority; dueDate?: string; assigneeId?: number; labelIds: string[]; projectId?: string };
  understood: string[];
  dropped: string[];
}
export interface Breakdown extends Sourced {
  basis: "ai" | "description" | "template";
  subtasks: { title: string; estimateHours: number | null }[];
}
export interface Summary extends Sourced {
  summary: string;
  highlights: string[];
}
export interface PrioritySuggestions extends Sourced {
  suggestions: { taskId: number; key: string; title: string; current: Priority; suggested: Priority; reason: string }[];
}
export interface RiskReport extends Sourced {
  risks: { kind: string; severity: "high" | "medium" | "low"; title: string; detail: string; tasks: { id: number; key: string; title: string }[] }[];
  workload: { user: { id: number; name: string } | null; open: number; overdue: number; dueNext7: number; hoursNext7: number; unestimatedNext7: number }[];
  openTasks: number;
  narrative: string;
}
export interface AssistantReply extends Sourced {
  answer: string;
  references: { id: number; key: string; title: string }[];
}

/** The viewer's zone, so "tomorrow" and "overdue" mean their day. */
export const viewerTz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

export const aiPost = async <T,>(path: string, body: Record<string, unknown> = {}) => (await api.post<T>(`/ai${path}`, { tz: viewerTz(), ...body })).data;

/** fresh: re-check on mount (the setting can change while a tab is open) */
export const useAiStatus = (fresh = false) => {
  const org = useOrgKey();
  return useQuery({ queryKey: ["org", org, "ai-status"], queryFn: async () => (await api.get<AiStatus>("/ai/status")).data, staleTime: 60_000, refetchOnMount: fresh ? "always" : true });
};

export const REASON_TEXT: Record<Exclude<FallbackReason, null>, string> = {
  not_configured: "AI isn't set up on this server, so this came from built-in rules.",
  disabled_by_org: "AI is turned off for this organization, so this came from built-in rules and nothing was sent to a model.",
  unavailable: "The AI service didn't respond, so this came from built-in rules.",
  invalid_output: "The AI's answer couldn't be used, so this came from built-in rules.",
  cooling_down: "The AI service failed recently; built-in rules are used for a minute before trying again.",
};
