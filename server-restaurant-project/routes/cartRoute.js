import express from "express";
import {
  addToCart,
  getCart,
  removeCartItem,
  syncCart,
  updateCartItem,
  validateGuestCart,
} from "../controllers/cartController.js";
import { checkUserJWT, checkUserPermission } from "../middleware/jwtAction.js";

const router = express.Router();
const customerOnly = [checkUserJWT, checkUserPermission(["customer"])];

router.post("/cart/validate", validateGuestCart);
router.get("/get-cart", ...customerOnly, getCart);
router.post("/add-to-cart", ...customerOnly, addToCart);
router.put("/update-cart-item", ...customerOnly, updateCartItem);
router.delete("/remove/:product_id", ...customerOnly, removeCartItem);
router.post("/sync-cart", ...customerOnly, syncCart);

export default router;
