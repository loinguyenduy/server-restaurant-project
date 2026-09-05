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

const getAllowedClientOrigins = () => {
  const configuredValue = process.env.CLIENT_URL?.trim();
  if (process.env.NODE_ENV === "production" && !configuredValue) {
    throw new Error("CLIENT_URL is required when NODE_ENV is production.");
  }

  const rawOrigins = configuredValue || "http://localhost:3000";
  const normalizedOrigins = rawOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin, index) => {
      let parsed;
      try {
        parsed = new URL(origin);
      } catch (error) {
        throw new Error(`CLIENT_URL origin ${index + 1} is not a valid absolute URL.`);
      }

      const hasOriginOnly = parsed.pathname === "/" && !parsed.search && !parsed.hash;
      if (!["http:", "https:"].includes(parsed.protocol) || !hasOriginOnly || parsed.username || parsed.password) {
        throw new Error(`CLIENT_URL origin ${index + 1} must be an HTTP(S) origin without path, credentials, query, or hash.`);
      }
      if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
        throw new Error(`CLIENT_URL origin ${index + 1} must use HTTPS in production.`);
      }
      return parsed.origin;
    });

  if (normalizedOrigins.length === 0) {
    throw new Error("CLIENT_URL must contain at least one valid origin.");
  }
  return [...new Set(normalizedOrigins)];
};

const allowedClientOrigins = getAllowedClientOrigins();

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

app.get("/health", (req, res) => {
  return res.status(200).json({ status: "ok" });
});

//routes
apiRoutes(app);
initializeSocket(httpServer, allowedClientOrigins);

app.use((error, req, res, next) => {
  const errorMessage = error instanceof Error ? error.message : "Unknown server error";
  console.error(`Unhandled ${req.method} ${req.originalUrl}: ${errorMessage}`);

  if (res.headersSent) return next(error);
  const isClientError = Number.isInteger(error.status) && error.status >= 400 && error.status < 500;
  const status = isClientError ? error.status : 500;
  return res.status(status).json({
    EM: isClientError ? "Invalid request." : "Internal server error.",
    EC: status,
    DT: "",
  });
});

//db connect
const connectToDB = async () => {
  try {
    await connectDB();
    await sequelize.sync();
    console.log("All tables have been synchronized.");

    // Initialize cron jobs
    initCronJobs();
    console.log("Cron Jobs initialized successfully.");

    httpServer.listen(PORT, "0.0.0.0", () => {
      console.log("Server is running in port:", PORT);
    });
  } catch (error) {
    console.error("Server startup failed:", error.message);
    try {
      await sequelize.close();
    } catch (closeError) {
      console.error("Unable to close the database connection after startup failure:", closeError.message);
    }
    process.exitCode = 1;
  }
};

connectToDB();
