import express from "express";
import { handleCheckout } from "../controllers/orderController.js";
import { checkUserJWT } from "../middleware/jwtAction.js";

const router = express.Router();

router.post("/checkout", checkUserJWT, handleCheckout);

export default router;