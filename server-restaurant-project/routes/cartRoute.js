import { addToCart, getCart } from "../controllers/cartController.js";
import { checkUserJWT } from "../middleware/jwtAction.js";
import express from "express";


const router = express.Router();
//Get cart
router.get("/get-cart", checkUserJWT, getCart);
//Add to cart
router.post("/add-to-cart", checkUserJWT, addToCart)

export default router;
