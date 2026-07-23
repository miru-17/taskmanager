import express from "express";
import cors from "cors";
import taskRoutes from "./routes/taskRoutes";
import authRoutes from "./routes/authRoutes";
const app = express();

// Allow requests from Vite frontend
app.use(
  cors({
    origin: "http://localhost:5173",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  })
);

app.use(express.json());
app.use("/auth", authRoutes);
app.use("/tasks", taskRoutes);

export default app;