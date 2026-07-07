import request from "supertest";
import app from "../src/app";

describe("Task API", () => {
  let createdTaskId: number;

  // Generate a unique title each time
  const uniqueTitle = `Jest Task ${Date.now()}`;

  it("GET /tasks should return all tasks", async () => {
    const response = await request(app).get("/tasks");

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it("POST /tasks should create a new task", async () => {
    const response = await request(app)
      .post("/tasks")
      .send({
        title: uniqueTitle,
        description: "Created using Jest",
        status: "TODO",
        dueDate: "2026-07-20",
      });

    expect(response.status).toBe(201);
    expect(response.body.title).toBe(uniqueTitle);

    createdTaskId = response.body.id;
  });

  it("GET /tasks/:id should return the created task", async () => {
    const response = await request(app).get(`/tasks/${createdTaskId}`);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(createdTaskId);
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
  });
});