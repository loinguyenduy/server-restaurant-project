import express from "express";
import {
  loginUser,
  logoutUser,
  registerNewUser,
  requestRefreshToken,
} from "../controllers/authController.js";

const router = express.Router();

//Register
router.post("/register", registerNewUser);

//Login
router.post("/login", loginUser);

//Refresh
router.post("/refresh", requestRefreshToken);

//Logout
router.post("/logout", logoutUser);
export default router;
