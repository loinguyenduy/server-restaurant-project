import express from "express";
import { getAllCategories, createNewCategory, updateExistingCategory, deleteExistingCategory } from "../controllers/categoryController.js";
import { checkUserJWT, checkUserPermission } from "../middleware/jwtAction.js";

const router = express.Router();

// Public: Ai cũng xem được danh mục
router.get("/get-categories", getAllCategories);

// Private: Chỉ Admin/Staff mới được Tạo, Sửa, Xóa
router.post("/create-category", checkUserJWT, checkUserPermission(["admin"]), createNewCategory);
router.put("/update-category/:id", checkUserJWT, checkUserPermission(["admin"]), updateExistingCategory);
router.delete("/delete-category/:id", checkUserJWT, checkUserPermission(["admin"]), deleteExistingCategory);

export default router;