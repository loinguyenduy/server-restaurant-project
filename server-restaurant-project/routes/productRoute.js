import express from "express";
import { createNewProduct, getAllProducts, updateExistingProduct, deleteExistingProduct } from "../controllers/productController.js";
import upload from "../middleware/uploadMiddleWare.js";
import { checkUserJWT, checkUserPermission } from "../middleware/jwtAction.js";

const router = express.Router();

router.get("/get-all-products", getAllProducts);

router.post("/create-product", checkUserJWT, checkUserPermission(["admin"]), upload.single("image"), createNewProduct);

router.put("/update-product/:id", checkUserJWT, checkUserPermission(["admin"]), upload.single("image"), updateExistingProduct);

router.delete("/delete-product/:id", checkUserJWT, checkUserPermission(["admin"]), deleteExistingProduct);

export default router;