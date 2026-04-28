import express from "express";
import { handleGetDashboardStats } from "../controllers/dashboardController.js";
import { checkUserJWT, checkUserPermission } from "../middleware/jwtAction.js";

const router = express.Router();

router.get("/manage/dashboard-stats", checkUserJWT, checkUserPermission(["admin"]), handleGetDashboardStats);

export default router;