import express from "express";
import { handleCheckStatus, handleCheckIn, handleCheckOut, handleGetAttendanceLogs } from "../controllers/attendanceController.js";
import { checkUserJWT, checkUserPermission } from "../middleware/jwtAction.js";

const router = express.Router();

// Route cho Staff tự thao tác
router.get("/attendance/status", checkUserJWT, checkUserPermission(["admin", "staff"]), handleCheckStatus);
router.post("/attendance/check-in", checkUserJWT, checkUserPermission(["admin", "staff"]), handleCheckIn);
router.put("/attendance/check-out", checkUserJWT, checkUserPermission(["admin", "staff"]), handleCheckOut);

// Route xem danh sách
router.get("/manage/attendance/logs", checkUserJWT, checkUserPermission(["admin"]), handleGetAttendanceLogs);

export default router;
