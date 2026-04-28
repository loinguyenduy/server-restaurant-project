import express from "express";
import { handleCheckout, handleGetUserOrders, handleRePayOrder, handleGetAllOrders, handleUpdateOrderStatus } from "../controllers/orderController.js";
import { checkUserJWT, checkUserPermission } from "../middleware/jwtAction.js";

const router = express.Router();

// Route của Customer
router.post("/orders/checkout", checkUserJWT, handleCheckout);
router.get("/orders/my-orders", checkUserJWT, handleGetUserOrders);
router.post("/orders/re-pay", checkUserJWT, handleRePayOrder);

// Route của Admin & Staff
router.get("/manage/orders", checkUserJWT, checkUserPermission(["admin", "staff"]), handleGetAllOrders);
router.put("/manage/orders/:id/status", checkUserJWT, checkUserPermission(["admin", "staff"]), handleUpdateOrderStatus);

export default router;