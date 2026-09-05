import express from "express";
import {
  handleChangePassword,
  handleUpdateProfile,
  handleGetAllUsers,
  handleUpdateUserRole,
  handleToggleUserStatus,
} from "../controllers/userController.js";
import { checkUserJWT, checkUserPermission } from "../middleware/jwtAction.js";

const router = express.Router();

// Update Password (Yêu cầu Token)
router.put("/change-password", checkUserJWT, handleChangePassword);
router.put("/update-profile", checkUserJWT, handleUpdateProfile);

// ADMIN ROUTES
router.get(
  "/manage/get-all-users",
  checkUserJWT,
  checkUserPermission(["admin"]),
  handleGetAllUsers,
);
router.put(
  "/manage/update-role/:id",
  checkUserJWT,
  checkUserPermission(["admin"]),
  handleUpdateUserRole,
);
router.put(
  "/manage/toggle-status/:id",
  checkUserJWT,
  checkUserPermission(["admin"]),
  handleToggleUserStatus,
);

export default router;
