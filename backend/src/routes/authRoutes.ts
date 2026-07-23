import { Router } from "express";

import {
  register,
  login,
  forgotPassword,
  resetPassword,
   getResetUser, 
} from "../controllers/authController";

const router = Router();

// Authentication
router.post("/register", register);
router.post("/login", login);

// Password Reset
router.post("/forgot-password", forgotPassword);
router.get(
  "/reset-user/:token",
  getResetUser
);

router.post("/reset-password/:token", resetPassword);
export default router;