import request from "supertest";
import app from "../src/app";

describe("Authentication", () => {
  it("should login successfully", async () => {
    const response = await request(app)
      .post("/auth/login")
      .send({
        email: "bird@gmail.com",
        password: "123456",
      });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("token");
  });
});