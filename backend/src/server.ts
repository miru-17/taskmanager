import app from "./app";
import userRoutes from "./routes/userRoutes";
import dotenv from "dotenv";

dotenv.config();
app.use("/user", userRoutes);

const PORT = 3000;

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});