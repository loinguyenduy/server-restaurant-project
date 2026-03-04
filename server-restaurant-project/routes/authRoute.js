import express from "express";
import { registerNewUser } from "../controllers/authController.js";

const router = express.Router();

//Login
router.post("/register", registerNewUser);

export default router;
