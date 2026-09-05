import express from "express";
import { handleAdjustProductStock, handleGetInventory, handleGetStockMovements, handleRestockProduct } from "../controllers/inventoryController.js";
import { checkUserJWT, checkUserPermission } from "../middleware/jwtAction.js";

const router = express.Router();
const adminOnly = [checkUserJWT, checkUserPermission(["admin"])];

router.get("/manage/inventory", ...adminOnly, handleGetInventory);
router.post("/manage/inventory/:productId/restock", ...adminOnly, handleRestockProduct);
router.post("/manage/inventory/:productId/adjust", ...adminOnly, handleAdjustProductStock);
router.get("/manage/inventory/:productId/movements", ...adminOnly, handleGetStockMovements);

export default router;
