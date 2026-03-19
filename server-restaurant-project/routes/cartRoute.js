import { addToCart, getCart, removeCartItem, updateCartItem } from "../controllers/cartController.js";
import { checkUserJWT } from "../middleware/jwtAction.js";
import express from "express";


const router = express.Router();
//Get cart
router.get("/get-cart", checkUserJWT, getCart);
//Add to cart
router.post("/add-to-cart", checkUserJWT, addToCart)
//Update cart item
router.put("/update-cart-item", checkUserJWT, updateCartItem)
//Remove product in cart
router.delete("/remove/:product_id", checkUserJWT, removeCartItem)

export default router;
