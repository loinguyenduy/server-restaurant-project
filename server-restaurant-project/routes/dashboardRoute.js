import express from "express";
import { handleGetAnalyticsOverview, handleGetDashboardStats } from "../controllers/dashboardController.js";
import { checkUserJWT, checkUserPermission } from "../middleware/jwtAction.js";

const router = express.Router();

router.get("/manage/dashboard-stats", checkUserJWT, checkUserPermission(["admin"]), handleGetDashboardStats);
router.get("/manage/analytics/overview", checkUserJWT, checkUserPermission(["admin"]), handleGetAnalyticsOverview);

export default router;
