import type { Draft } from "./RuleBuilder";

/** Starting points for the builder. Nothing is saved until the person reviews and saves. */
export const RECIPES: { title: string; blurb: string; draft: Draft }[] = [
  {
    title: "Escalate critical work",
    blurb: "Critical tasks with nobody on them notify project managers.",
    draft: {
      name: "Escalate unassigned critical tasks",
      trigger: "TASK_CREATED",
      triggerConfig: {},
      conditions: [
        { field: "priority", op: "is", value: ["CRITICAL"] },
        { field: "assignee", op: "is_not_set" },
      ],
      actions: [{ type: "NOTIFY", to: "project_managers", message: "A critical task needs an owner" }],
    },
  },
  {
    title: "Start work on assignment",
    blurb: "Moving a to-do to someone puts it in progress.",
    draft: {
      name: "In progress when assigned",
      trigger: "ASSIGNEE_CHANGED",
      triggerConfig: {},
      conditions: [
        { field: "assignee", op: "is_set" },
        { field: "status", op: "is", value: ["TODO"] },
      ],
      actions: [{ type: "SET_STATUS", status: "IN_PROGRESS" }],
    },
  },
  {
    title: "Ask for review",
    blurb: "Tasks moved to review tell the creator.",
    draft: {
      name: "Tell the creator about reviews",
      trigger: "STATUS_CHANGED",
      triggerConfig: { to: "IN_REVIEW" },
      conditions: [],
      actions: [{ type: "NOTIFY", to: "creator", message: "Ready for your review" }],
    },
  },
  {
    title: "Nudge before the deadline",
    blurb: "Two days before the due date, raise priority and remind the assignee.",
    draft: {
      name: "Deadline in two days",
      trigger: "DUE_SOON",
      triggerConfig: { days: 2 },
      conditions: [{ field: "status", op: "is_not", value: ["DONE"] }],
      actions: [
        { type: "SET_PRIORITY", priority: "HIGH" },
        { type: "NOTIFY", to: "assignee", message: "Due in two days" },
      ],
    },
  },
  {
    title: "Flag overdue tasks",
    blurb: "Overdue tasks become critical and get a comment.",
    draft: {
      name: "Overdue becomes critical",
      trigger: "OVERDUE",
      triggerConfig: {},
      conditions: [],
      actions: [
        { type: "SET_PRIORITY", priority: "CRITICAL" },
        { type: "ADD_COMMENT", body: "This task is past its due date." },
      ],
    },
  },
];
