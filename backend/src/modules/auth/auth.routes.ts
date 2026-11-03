import { Router } from "express";
import { validate } from "../../core/validate";
import { authRateLimit } from "../../core/security";
import * as auth from "./auth.service";
import {
  forgotPasswordBody,
  loginBody,
  registerBody,
  resetPasswordBody,
  resetTokenParams,
} from "./auth.schemas";

export const authRouter = Router();

// Separate buckets so a burst of logins doesn't block password resets and vice versa
const loginLimiter = authRateLimit();
const registerLimiter = authRateLimit();
const resetLimiter = authRateLimit();

authRouter.post("/register", registerLimiter, validate({ body: registerBody }), async (req, res) => {
  const user = await auth.register(req.body.email, req.body.password);
  res.status(201).json({ message: "User registered successfully", user });
});

authRouter.post("/login", loginLimiter, validate({ body: loginBody }), async (req, res) => {
  const result = await auth.login(req.body.email, req.body.password);
  res.status(200).json({ message: "Login successful", ...result });
});

authRouter.post("/forgot-password", resetLimiter, validate({ body: forgotPasswordBody }), async (req, res) => {
  await auth.requestPasswordReset(req.body.email);
  res.status(200).json({
    message: "If an account exists for that email, a password reset link has been sent.",
  });
});

authRouter.get("/reset-user/:token", resetLimiter, validate({ params: resetTokenParams }), async (req, res) => {
  res.status(200).json(await auth.getResetUserEmail(req.params.token as string));
});

authRouter.post(
  "/reset-password/:token",
  resetLimiter,
  validate({ params: resetTokenParams, body: resetPasswordBody }),
  async (req, res) => {
    await auth.resetPassword(req.params.token as string, req.body.password);
    res.status(200).json({ message: "Password reset successful" });
  }
);
