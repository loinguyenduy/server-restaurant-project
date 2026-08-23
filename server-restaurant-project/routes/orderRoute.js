import express from "express";
import {
  handleCancelCustomerOrder,
  handleCheckout,
  handleCreatePosOrder,
  handleGetAllOrders,
  handleGetKitchenOrders,
  handleGetManagedOrderDetails,
  handleGetUserOrderDetails,
  handleGetUserOrders,
  handleRePayOrder,
  handleUpdateOrderStatus,
} from "../controllers/orderController.js";
import { checkUserJWT, checkUserPermission } from "../middleware/jwtAction.js";

const router = express.Router();

// Route của Customer
const customerOnly = checkUserPermission(["customer"]);
router.post("/orders/checkout", checkUserJWT, customerOnly, handleCheckout);
router.get("/orders/my-orders", checkUserJWT, customerOnly, handleGetUserOrders);
router.get("/orders/my-orders/:id", checkUserJWT, customerOnly, handleGetUserOrderDetails);
router.post("/orders/:id/re-pay", checkUserJWT, customerOnly, handleRePayOrder);
router.post("/orders/:id/cancel", checkUserJWT, customerOnly, handleCancelCustomerOrder);
router.post("/orders/re-pay", checkUserJWT, customerOnly, handleRePayOrder);

// Route của Admin & Staff
router.get("/manage/orders", checkUserJWT, checkUserPermission(["admin", "staff"]), handleGetAllOrders);
router.get("/manage/orders/kitchen", checkUserJWT, checkUserPermission(["admin", "staff"]), handleGetKitchenOrders);
router.get("/manage/orders/:id", checkUserJWT, checkUserPermission(["admin", "staff"]), handleGetManagedOrderDetails);
router.put("/manage/orders/:id/status", checkUserJWT, checkUserPermission(["admin", "staff"]), handleUpdateOrderStatus);
router.post("/manage/orders/pos", checkUserJWT, checkUserPermission(["admin", "staff"]), handleCreatePosOrder);

export default router;
