import { describe, expect, it } from "vitest";
import { healthReason, monthGrid, positionAt, toSpans } from "../features/views/logic";
import { canDeleteTask, canEditTask } from "../features/views/permissions";
import { makeProject, makeTask } from "./fixtures";

describe("board positions", () => {
  it("drops between neighbours at the midpoint, or one gap past an edge", () => {
    const col = [{ position: 1024 }, { position: 2048 }, { position: 4096 }];
    expect(positionAt(col, 1)).toBe((1024 + 4096) / 2);
    expect(positionAt(col, 0)).toBe(2048 - 1024);
    expect(positionAt(col, 2)).toBe(2048 + 1024);
    expect(positionAt([{ position: 7 }], 0)).toBe(1024);
  });
});

describe("calendar grid", () => {
  it("covers six Monday-first weeks around the month", () => {
    const days = monthGrid(2026, 10); // November 2026 starts on a Sunday
    expect(days).toHaveLength(42);
    expect(days[0]).toBe("2026-10-26"); // the Monday before
    expect(days[6]).toBe("2026-11-01");
    expect(days).toContain("2026-11-30");
  });
});

describe("timeline spans", () => {
  it("uses whichever date exists, orders by start and counts undated tasks", () => {
    const { spans, undated } = toSpans([
      makeTask({ id: 1, startDate: "2026-11-10T00:00:00.000Z", dueDate: "2026-11-12T00:00:00.000Z" }),
      makeTask({ id: 2, dueDate: "2026-11-05T00:00:00.000Z" }),
      makeTask({ id: 3 }),
    ]);
    expect(undated).toBe(1);
    expect(spans.map((s) => [s.task.id, s.start, s.end])).toEqual([
      [2, "2026-11-05", "2026-11-05"],
      [1, "2026-11-10", "2026-11-12"],
    ]);
  });
});

describe("health explanation", () => {
  it("names the rule that fired", () => {
    const p = makeProject({ health: "off_track", stats: { total: 4, done: 2, open: 2, overdue: 1, progress: 0.5 } });
    expect(healthReason(p, "2026-11-03")).toMatch(/1 of 2 open tasks are overdue/);
    expect(healthReason(makeProject({ health: "on_hold" }))).toBe("The project is on hold.");
    expect(healthReason(makeProject({ stats: { total: 0, done: 0, open: 0, overdue: 0, progress: 0 } }))).toBe("No tasks yet.");
  });

  it("explains schedule lag", () => {
    const p = makeProject({
      health: "at_risk",
      startDate: "2026-11-01T00:00:00.000Z",
      dueDate: "2026-11-11T00:00:00.000Z",
      stats: { total: 10, done: 1, open: 9, overdue: 0, progress: 0.1 },
    });
    expect(healthReason(p, "2026-11-06")).toMatch(/50% of the schedule has elapsed but only 10%/);
  });
});

describe("permission hints", () => {
  const own = { createdById: 5, assigneeId: null };
  const assigned = { createdById: 1, assigneeId: 5 };
  const caps = (editTasks: "any" | "own" | "none", deleteTasks: "any" | "own" | "none") => ({
    projectId: "p1",
    manage: false,
    createTasks: true,
    editTasks,
    deleteTasks,
    projectRole: null,
  });

  it("mirror the server: own = creator, or assignee for edits only", () => {
    expect(canEditTask(caps("own", "own"), 5, own)).toBe(true);
    expect(canEditTask(caps("own", "own"), 5, assigned)).toBe(true);
    expect(canDeleteTask(caps("own", "own"), 5, assigned)).toBe(false);
    expect(canEditTask(caps("none", "none"), 5, own)).toBe(false);
    expect(canEditTask(undefined, 5, own)).toBe(false);
    expect(canDeleteTask(caps("any", "any"), 9, own)).toBe(true);
  });
});
