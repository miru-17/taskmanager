import request from "supertest";
import { app, createUser, isoDate, prisma, resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("Task CRUD", () => {
  it("requires authentication on every route", async () => {
    for (const [method, path] of [
      ["get", "/tasks"],
      ["post", "/tasks"],
      ["get", "/tasks/1"],
      ["put", "/tasks/1"],
      ["patch", "/tasks/1"],
      ["delete", "/tasks/1"],
    ] as const) {
      const res = await request(app)[method](path);
      expect(res.status).toBe(401);
    }
  });

  it("creates, reads, updates and deletes a task", async () => {
    const u = await createUser();

    const created = await request(app)
      .post("/tasks")
      .set(u.auth)
      .send({ title: "  Write spec  ", description: "v1", status: "TODO", dueDate: isoDate(3) });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ title: "Write spec", description: "v1", status: "TODO", userId: u.id });
    expect(created.body.dueDate).toBe(`${isoDate(3)}T00:00:00.000Z`);
    const id = created.body.id;

    expect((await request(app).get(`/tasks/${id}`).set(u.auth)).body.id).toBe(id);

    const list = await request(app).get("/tasks").set(u.auth);
    expect(list.body).toHaveLength(1);

    const updated = await request(app).put(`/tasks/${id}`).set(u.auth).send({ title: "Write spec v2", status: "DONE" });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ title: "Write spec v2", status: "DONE", description: "v1" });

    expect((await request(app).delete(`/tasks/${id}`).set(u.auth)).body.message).toBe("Task deleted successfully");
    expect((await request(app).get(`/tasks/${id}`).set(u.auth)).status).toBe(404);
  });

  it("supports PATCH for partial updates and clearing the due date", async () => {
    const u = await createUser();
    const { body: task } = await request(app).post("/tasks").set(u.auth).send({ title: "A", dueDate: isoDate(2) });

    const res = await request(app).patch(`/tasks/${task.id}`).set(u.auth).send({ dueDate: null });
    expect(res.status).toBe(200);
    expect(res.body.dueDate).toBeNull();
    expect(res.body.title).toBe("A");
  });

  it("lists tasks newest first", async () => {
    const u = await createUser();
    await request(app).post("/tasks").set(u.auth).send({ title: "first" });
    await request(app).post("/tasks").set(u.auth).send({ title: "second" });
    const list = await request(app).get("/tasks").set(u.auth);
    expect(list.body.map((t: { title: string }) => t.title)).toEqual(["second", "first"]);
  });
});

describe("Task validation", () => {
  it("rejects missing, blank or non-string titles", async () => {
    const u = await createUser();
    for (const title of [undefined, "", "   ", 42, { a: 1 }]) {
      const res = await request(app).post("/tasks").set(u.auth).send({ title });
      expect(res.status).toBe(400);
    }
  });

  it("rejects a blank title on update", async () => {
    const u = await createUser();
    const { body: task } = await request(app).post("/tasks").set(u.auth).send({ title: "ok" });
    expect((await request(app).put(`/tasks/${task.id}`).set(u.auth).send({ title: "  " })).status).toBe(400);
  });

  it("rejects an invalid status", async () => {
    const u = await createUser();
    const res = await request(app).post("/tasks").set(u.auth).send({ title: "x", status: "BLOCKED" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Invalid status/);
  });

  it("rejects invalid and past due dates on create", async () => {
    const u = await createUser();
    expect((await request(app).post("/tasks").set(u.auth).send({ title: "x", dueDate: "not-a-date" })).status).toBe(400);
    const past = await request(app).post("/tasks").set(u.auth).send({ title: "x", dueDate: isoDate(-5) });
    expect(past.status).toBe(400);
    expect(past.body.message).toBe("Due date cannot be in the past");
  });

  it("accepts today's date regardless of the server's time zone", async () => {
    const u = await createUser();
    expect((await request(app).post("/tasks").set(u.auth).send({ title: "x", dueDate: isoDate(0) })).status).toBe(201);
  });

  it("returns 400 (not 500) for non-numeric or out-of-range ids", async () => {
    const u = await createUser();
    for (const id of ["abc", "-1", "1.5", "99999999999"]) {
      expect((await request(app).get(`/tasks/${id}`).set(u.auth)).status).toBe(400);
    }
  });

  it("returns 400 for malformed JSON", async () => {
    const u = await createUser();
    const res = await request(app)
      .post("/tasks")
      .set(u.auth)
      .set("Content-Type", "application/json")
      .send('{"title": ');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BAD_JSON");
  });

  it("requires at least one field on update", async () => {
    const u = await createUser();
    const { body: task } = await request(app).post("/tasks").set(u.auth).send({ title: "x" });
    expect((await request(app).patch(`/tasks/${task.id}`).set(u.auth).send({})).status).toBe(400);
  });

  it("ignores attempts to set userId or id through the body (mass assignment)", async () => {
    const owner = await createUser();
    const other = await createUser();
    const res = await request(app)
      .post("/tasks")
      .set(owner.auth)
      .send({ title: "mine", userId: other.id, id: 999 });
    expect(res.status).toBe(201);
    expect(res.body.userId).toBe(owner.id);
    expect(res.body.id).not.toBe(999);
  });
});

describe("Overdue tasks (regression)", () => {
  it("can still change status and title of a task whose due date has passed", async () => {
    const u = await createUser();
    const task = await prisma.task.create({
      data: { title: "late", userId: u.id, dueDate: new Date(`${isoDate(-10)}T00:00:00.000Z`) },
    });

    // The old frontend re-sent the existing date with every status change
    const res = await request(app)
      .put(`/tasks/${task.id}`)
      .set(u.auth)
      .send({ title: "late", status: "DONE", dueDate: isoDate(-10) });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("DONE");
  });

  it("still blocks moving a due date into the past", async () => {
    const u = await createUser();
    const { body: task } = await request(app).post("/tasks").set(u.auth).send({ title: "x", dueDate: isoDate(5) });
    const res = await request(app).put(`/tasks/${task.id}`).set(u.auth).send({ dueDate: isoDate(-5) });
    expect(res.status).toBe(400);
  });
});

describe("Access control between users (IDOR)", () => {
  it("prevents one user from reading, updating or deleting another user's task", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const { body: task } = await request(app).post("/tasks").set(alice.auth).send({ title: "alice only" });

    expect((await request(app).get(`/tasks/${task.id}`).set(bob.auth)).status).toBe(404);
    expect((await request(app).put(`/tasks/${task.id}`).set(bob.auth).send({ title: "pwned" })).status).toBe(404);
    expect((await request(app).patch(`/tasks/${task.id}`).set(bob.auth).send({ status: "DONE" })).status).toBe(404);
    expect((await request(app).delete(`/tasks/${task.id}`).set(bob.auth)).status).toBe(404);
    expect((await request(app).get("/tasks").set(bob.auth)).body).toEqual([]);

    const untouched = await prisma.task.findUnique({ where: { id: task.id } });
    expect(untouched).toMatchObject({ title: "alice only", status: "TODO" });
  });
});
