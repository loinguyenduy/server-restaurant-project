import express from "express";
import { handleCreatePayment, handlePayOSWebhook } from "../controllers/payosController.js";

const router = express.Router();

router.post("/payment/create-link", handleCreatePayment);

router.post("/payment/webhook", handlePayOSWebhook);

export default router;