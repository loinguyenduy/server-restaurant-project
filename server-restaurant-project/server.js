import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import http from "http";
import { connectDB, sequelize } from "./config/databaseConfig.js";
import "./models/index.js";
import apiRoutes from "./routes/apiRoutes.js";
import { initCronJobs } from "./jobs/cronJob.js";
import { initializeSocket } from "./socket/socket.js";

dotenv.config();

const app = express();
const httpServer = http.createServer(app);
const PORT = process.env.PORT || 8080;
const allowedClientOrigins = (
  process.env.CLIENT_URL || "http://localhost:3000"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

//cors
app.use(
  cors({
    origin: allowedClientOrigins,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// cookie

//routes
apiRoutes(app);
initializeSocket(httpServer, allowedClientOrigins);

//db connect
const connectToDB = async () => {
  try {
    await connectDB();
    await sequelize.sync({ alter: true });
    // await sequelize.sync();
    console.log("All tables have been synchronized.");

    // Initialize cron jobs
    initCronJobs();
    console.log("Cron Jobs initialized successfully.");

    httpServer.listen(PORT, () => {
      console.log("Server is running in port: ", PORT);
    });
  } catch (error) {
    console.error("Error in running server: ", error);
  }
};

connectToDB();
