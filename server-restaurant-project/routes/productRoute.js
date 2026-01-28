import express from "express";
import { createNewProduct, getAllProducts } from "../controllers/productController.js";
import upload from "../middleware/uploadMiddleWare.js";

const router = express.Router();
//Get all products
router.get("/get-all-products", getAllProducts);
//create new product
router.post("/create-product", upload.single('image_url'), createNewProduct)

export default router;
