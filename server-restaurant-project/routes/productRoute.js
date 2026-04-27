import express from "express";
import {
  createNewProduct,
  getAllProducts,
} from "../controllers/productController.js";
import upload from "../middleware/uploadMiddleWare.js";
import { checkUserJWT, checkUserPermission } from "../middleware/jwtAction.js";

const router = express.Router();
//Get all products
router.get("/get-all-products", getAllProducts);
//create new product
router.post(
  "/create-product",
  checkUserJWT,
  checkUserPermission(["admin", "staff"]),
  upload.single("image"),
  createNewProduct,
);

export default router;
