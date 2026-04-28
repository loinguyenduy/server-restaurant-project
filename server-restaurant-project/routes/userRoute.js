import express from "express";
import { handleChangePassword, handleUpdateProfile } from "../controllers/userController.js";
import { checkUserJWT } from "../middleware/jwtAction.js";

const router = express.Router();

// Update Password (Yêu cầu Token)
router.put("/change-password", checkUserJWT, handleChangePassword);
router.put("/update-profile", checkUserJWT, handleUpdateProfile);

export default router;