import express from "express";
import { loginUser, registerNewUser } from "../controllers/authController.js";

const router = express.Router();

//Register
router.post("/register", registerNewUser);

//Login
router.post("/login", loginUser)

export default router;
