import express from "express";
import { handleCreatePayment, handlePayOSWebhook } from "../controllers/payosController.js";
import { checkUserJWT } from "../middleware/jwtAction.js";

const router = express.Router();

router.post("/payment/create-link", checkUserJWT, handleCreatePayment);

router.post("/payment/webhook", handlePayOSWebhook);

export default router;