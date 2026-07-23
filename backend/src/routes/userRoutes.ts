import { Router } from "express";
import { changePassword } from "../controllers/userController";
import { authenticateToken } from "../middleware/authMiddleware";

const router = Router();

router.put("/change-password", authenticateToken, changePassword);

export default router;