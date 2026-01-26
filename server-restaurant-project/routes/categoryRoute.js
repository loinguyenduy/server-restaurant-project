import express from "express";
// import categoryController from "../controllers/categoryController.js";
import { getAllCategories, createNewCategory } from "../controllers/categoryController.js";

const router = express.Router();
//Get categories
router.get("/get-categories", getAllCategories);
//Create new category
router.post("/create-category", createNewCategory);

export default router;
