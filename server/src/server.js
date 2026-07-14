import "dotenv/config";
import express from "express";
import cors from "cors";

import recipeRoutes from "./routes/recipeRoutes.js";

const app = express();
const PORT = process.env.PORT || 5001;
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ||
  "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Not allowed by CORS"));
    },
  }),
);

app.use(express.json());

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Recipe Keeper API is running.",
  });
});

app.use("/api/recipes", recipeRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found.",
  });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
