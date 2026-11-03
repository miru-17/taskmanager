import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../App";
import { ThemeProvider } from "../context/ThemeContext";
import { TestProviders } from "./providers";
import { apiMock, makeSession, resetApiMock, restoreAs } from "./mockApi";
import { makeDetail, makeProject, page, routes } from "./fixtures";
import RichText from "../features/comments/RichText";
import { activeQuery, decodeMentions, encodeMentions } from "../features/comments/mentions";
import { parseSse } from "../data/live";
import type { OrgRole } from "../types/auth";
import type { AppNotification, CommentThread } from "../types/Task";

vi.mock("../services/api", async () => (await import("./mockApi")).apiModule);

const renderAt = (path: string, role: OrgRole = "ORG_ADMIN") => {
  restoreAs(makeSession(role));
  return render(
    <ThemeProvider>
      <TestProviders>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
        <Toaster />
      </TestProviders>
    </ThemeProvider>
  );
};

const me = { id: 1, email: "me@example.com", name: null };
const sam = { id: 2, email: "sam@example.com", name: "Sam Lee" };
const members = [
  { userId: 1, email: me.email, name: null, role: "ORG_ADMIN" },
  { userId: 2, email: sam.email, name: "Sam Lee", role: "MEMBER" },
];
const project = makeProject();
const thread = (o: Partial<CommentThread> = {}): CommentThread => ({
  id: "c1",
  parentId: null,
  body: "Hello",
  deleted: false,
  editedAt: null,
  createdAt: "2026-11-03T10:00:00.000Z",
  author: sam,
  reactions: [],
  replies: [],
  ...o,
});

const api = (extra: [string | RegExp, unknown][] = []) =>
  apiMock.get.mockImplementation(
    routes([
      ...extra,
      ["/projects", [project]],
      ["/projects/p1", project],
      [/^\/projects\/p1\//, []],
      ["/tasks", page([])],
      ["/labels", []],
      ["/views", []],
      ["/templates", []],
      ["/orgs/current/members", members],
      ["/approvals/count", { pending: 0 }],
      ["/notifications/count", { unread: 0 }],
      ["/attachments/usage", { usedBytes: 0, files: 0, quotaBytes: 1, maxFileBytes: 1, allowedExtensions: [] }],
    ])
  );

beforeEach(() => resetApiMock());

describe("Comment text", () => {
  it("renders markup as text, never as HTML", () => {
    const { container } = render(<RichText text={'<img src=x onerror="alert(1)"> **bold** `code`'} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent('<img src=x onerror="alert(1)">');
    expect(container.querySelector("strong")).toHaveTextContent("bold");
    expect(container.querySelector("code")).toHaveTextContent("code");
  });

  it("links only http(s) URLs, safely", () => {
    const { container } = render(<RichText text="see https://example.com/a?b=1, or javascript:alert(1)" />);
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "https://example.com/a?b=1");
    expect(links[0]).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("round-trips mentions picked from the list; typed names stay plain", () => {
    const encoded = encodeMentions("hi @Sam Lee and @Sam and @nobody", [{ id: 2, name: "Sam Lee" }]);
    expect(encoded).toBe("hi @[Sam Lee](user:2) and @Sam and @nobody");
    expect(decodeMentions(encoded)).toEqual({ text: "hi @Sam Lee and @Sam and @nobody", mentions: [{ id: 2, name: "Sam Lee" }] });
    expect(activeQuery("ping @sa", 8)).toEqual({ start: 5, query: "sa" });
    expect(activeQuery("email@x", 7)).toBeNull();
  });
});

describe("Live stream parser", () => {
  it("splits events and keeps partial data for the next chunk", () => {
    const { events, rest } = parseSse('event: task.changed\ndata: {"taskIds":[1]}\n\n: ping\n\nevent: notif');
    expect(events).toEqual([{ event: "task.changed", data: '{"taskIds":[1]}' }]);
    expect(rest).toBe("event: notif");
  });
});

describe("Comments in the task panel", () => {
  it("posts a comment with a mention chosen from the picker", async () => {
    api([["/tasks/10", makeDetail({ id: 10 })], ["/tasks/10/comments", [thread()]]]);
    apiMock.post.mockResolvedValue({ data: {} });
    renderAt("/projects/p1/board?task=10");
    const section = await screen.findByRole("region", { name: "Comments" });
    expect(await within(section).findByText("Hello")).toBeInTheDocument();

    const box = within(section).getByLabelText("Write a comment");
    await userEvent.type(box, "Thanks @sa");
    await userEvent.click(within(await screen.findByRole("listbox", { name: "Mention someone" })).getByRole("button", { name: /Sam Lee/ }));
    await userEvent.type(box, "looks great");
    await userEvent.click(within(section).getByRole("button", { name: "Comment" }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tasks/10/comments", { body: "Thanks @[Sam Lee](user:2) looks great", parentId: undefined }));
  });

  it("viewers read but can't write; only authors (or managers) get edit/delete", async () => {
    const readonly = makeProject({ capabilities: { projectId: "p1", manage: false, createTasks: false, editTasks: "none", deleteTasks: "none", projectRole: null } });
    apiMock.get.mockImplementation(
      routes([
        ["/projects", [readonly]],
        ["/projects/p1", readonly],
        [/^\/projects\/p1\//, []],
        ["/tasks/11", makeDetail({ id: 11, permissions: { edit: false, delete: false, createSubtasks: false } })],
        ["/tasks/11/comments", [thread({ body: "From Sam" })]],
        ["/tasks", page([])],
        ["/notifications/count", { unread: 0 }],
        ["/approvals/count", { pending: 0 }],
        ["/orgs/current/members", members],
      ])
    );
    renderAt("/projects/p1/board?task=11", "VIEWER");
    const section = await screen.findByRole("region", { name: "Comments" });
    await within(section).findByText("From Sam");
    expect(within(section).queryByLabelText("Write a comment")).not.toBeInTheDocument();
    expect(within(section).getByText(/Viewers can read comments/)).toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: "Delete comment" })).not.toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: "Edit comment" })).not.toBeInTheDocument();
  });

  it("toggles a reaction", async () => {
    api([["/tasks/12", makeDetail({ id: 12 })], ["/tasks/12/comments", [thread({ reactions: [{ emoji: "👍", count: 2, mine: false }] })]]]);
    apiMock.post.mockResolvedValue({ data: {} });
    renderAt("/projects/p1/board?task=12");
    const section = await screen.findByRole("region", { name: "Comments" });
    await userEvent.click(await within(section).findByRole("button", { name: "👍 2" }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/comments/c1/reactions", { emoji: "👍" }));
  });
});

describe("Notifications", () => {
  const n: AppNotification = {
    id: "n1",
    type: "MENTIONED",
    taskId: 20,
    readAt: null,
    createdAt: "2026-11-03T10:00:00.000Z",
    actor: sam,
    data: { key: "GEN-20", title: "Pricing page", projectId: "p1", projectName: "General", actorName: "Sam Lee", excerpt: "can you check this?" },
  };

  it("shows the unread count, lists notifications and opens the task", async () => {
    api([["/notifications/count", { unread: 3 }], ["/notifications", { items: [n], nextCursor: null }], ["/tasks/20", makeDetail({ id: 20, title: "Pricing page" })]]);
    apiMock.post.mockResolvedValue({ data: {} });
    renderAt("/my-tasks");
    await userEvent.click(await screen.findByRole("button", { name: "Notifications, 3 unread" }));
    const panel = await screen.findByRole("dialog", { name: "Notifications" });
    expect(await within(panel).findByText("Sam Lee mentioned you")).toBeInTheDocument();
    expect(within(panel).getByText("“can you check this?”")).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole("button", { name: /Sam Lee mentioned you/ }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/notifications/read", { ids: ["n1"] }));
    expect(await screen.findByRole("dialog", { name: "Task details" })).toBeInTheDocument();
  });

  it("marks everything read", async () => {
    api([["/notifications/count", { unread: 1 }], ["/notifications", { items: [n], nextCursor: null }]]);
    apiMock.post.mockResolvedValue({ data: {} });
    renderAt("/my-tasks");
    await userEvent.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));
    await userEvent.click(await screen.findByRole("button", { name: "Mark all read" }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/notifications/read-all"));
  });

  it("saves email preferences", async () => {
    api([["/notifications/preferences", { emailTypes: ["MENTIONED", "ASSIGNED"], emailConfigured: false }]]);
    apiMock.put.mockResolvedValue({ data: {} });
    renderAt("/settings/notifications");
    expect(await screen.findByText(/Email isn't set up on this server/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Someone mentions you" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "New comments on tasks you watch" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/notifications/preferences", { emailTypes: ["ASSIGNED", "COMMENTED"] }));
  });
});
