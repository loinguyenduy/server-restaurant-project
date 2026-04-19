import express from "express";
import { handleCheckout, handleGetUserOrders, handleRePayOrder } from "../controllers/orderController.js";
import { checkUserJWT } from "../middleware/jwtAction.js";

const router = express.Router();
// Handle checkout and create order
router.post("/checkout", checkUserJWT, handleCheckout);
// Get user's orders
router.get("/my-orders", checkUserJWT, handleGetUserOrders);
// Re-create payment link for pending orders
router.post("/re-pay", checkUserJWT, handleRePayOrder);

export default router;