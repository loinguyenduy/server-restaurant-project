import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import { connectDB, sequelize } from "./config/database.js";
import "./models/index.js";
import apiRoutes from "./routes/apiRoutes.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

//cors
app.use(
  cors({
    origin: "http://localhost:3000",
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// cookie

//routes
apiRoutes(app);

//db connect
const connectToDB = async () => {
  try {
    await connectDB;
    await sequelize.sync();
    console.log("All tables have been synchronized.");

    app.listen(PORT, () => {
      console.log("Server is running in port: ", PORT);
    });
  } catch (error) {
    console.error("Error in running server: ", error);
  }
};

connectToDB();
