import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/core/prisma";

export const app = createApp();
export { prisma };

export const resetDb = async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Task", "User" RESTART IDENTITY CASCADE');
};

let counter = 0;

/** Registers and logs in a fresh user; returns its token and an authorised request helper. */
export const createUser = async (password = "secret123") => {
  counter += 1;
  const email = `user${counter}_${Date.now()}@example.com`;

  await request(app).post("/auth/register").send({ email, password }).expect(201);
  const res = await request(app).post("/auth/login").send({ email, password }).expect(200);

  const token: string = res.body.token;
  return {
    email,
    password,
    token,
    id: res.body.user.id as number,
    auth: { Authorization: `Bearer ${token}` },
  };
};

export const isoDate = (offsetDays: number) => {
  const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
};
