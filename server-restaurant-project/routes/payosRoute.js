import express from "express";
import { handlePayOSWebhook } from "../controllers/payosController.js";

const router = express.Router();

router.post("/payment/webhook", handlePayOSWebhook);

export default router;
