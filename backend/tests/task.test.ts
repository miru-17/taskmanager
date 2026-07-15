import request from "supertest";
import app from "../src/app";
import prisma from "../src/prisma";

let createdTaskId: number;

beforeEach(async () => {
  // Clean the test database
  await prisma.task.deleteMany();

  // Create a fresh task for every test
  const task = await prisma.task.create({
    data: {
      title: "Initial Test Task",
      description: "Created for testing",
      status: "TODO",
      dueDate: new Date("2026-07-20"),
    },
  });

  createdTaskId = task.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Task API", () => {
  it("GET /tasks should return all tasks", async () => {
    const response = await request(app).get("/tasks");

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBe(1);
  });

  it("GET /tasks/:id should return the created task", async () => {
    const response = await request(app).get(`/tasks/${createdTaskId}`);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(createdTaskId);
    expect(response.body.title).toBe("Initial Test Task");
  });

  it("POST /tasks should create a new task", async () => {
    const response = await request(app)
      .post("/tasks")
      .send({
        title: "New Jest Task",
        description: "Created using Jest",
        status: "TODO",
        dueDate: "2026-07-25",
      });

    expect(response.status).toBe(201);
    expect(response.body.title).toBe("New Jest Task");
  });

  it("PUT /tasks/:id should update the task", async () => {
    const response = await request(app)
      .put(`/tasks/${createdTaskId}`)
      .send({
        title: "Updated Jest Task",
        description: "Updated by Jest",
        status: "DONE",
        dueDate: "2026-07-22",
      });

    expect(response.status).toBe(200);
    expect(response.body.title).toBe("Updated Jest Task");
    expect(response.body.status).toBe("DONE");
  });

  it("DELETE /tasks/:id should delete the task", async () => {
    const response = await request(app).delete(`/tasks/${createdTaskId}`);

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Task deleted successfully");

    const deletedTask = await prisma.task.findUnique({
      where: { id: createdTaskId },
    });

    expect(deletedTask).toBeNull();
  });

  it("POST /tasks should reject an empty title", async () => {
    const response = await request(app)
      .post("/tasks")
      .send({
        title: "",
        description: "Invalid task",
        status: "TODO",
      });

    expect(response.status).toBe(400);
  });

  it("GET /tasks/:id should return 404 for an invalid task", async () => {
    const response = await request(app).get("/tasks/999999");

    expect(response.status).toBe(404);
  });
});