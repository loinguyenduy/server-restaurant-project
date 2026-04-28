import { createCategory, getCategories, updateCategory, deleteCategory } from "../services/categoryService.js";

const getAllCategories = async (req, res) => {
  try {
    let data = await getCategories();
    return res.status(200).json({
      EM: data.EM,
      EC: data.EC,
      DT: data.DT,
    });
  } catch (error) {
    console.log("Error in getAllCategories server: ", error);
    return res.status(500).json({
      EM: "Something wrongs in server...",
      EC: 500,
      DT: [],
    });
  }
};

const createNewCategory = async (req, res) => {
  try {
    const name = req.body?.name
    if (!name || typeof name !== "string" || name === "") {
      return res.status(400).json({
        EM: "Invalid or missing category name.",
        EC: 400,
        DT: [],
      });
    }
    let data = await createCategory(name);
    return res.status(200).json({
      EM: data.EM,
      EC: data.EC,
      DT: data.DT,
    });
  } catch (error) {
    console.log("Error in createNewCategory server: ", error);
    return res.status(500).json({
      EM: "Something wrongs in server...",
      EC: 500,
      DT: [],
    });
  }
};


const updateExistingCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    
    if (!name || typeof name !== "string" || name === "") {
      return res.status(400).json({ EM: "Invalid category name.", EC: 400, DT: "" });
    }

    let data = await updateCategory(id, name);
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ EM: "Server error", EC: 500, DT: "" });
  }
};

const deleteExistingCategory = async (req, res) => {
  try {
    const { id } = req.params;
    let data = await deleteCategory(id);
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ EM: "Server error", EC: 500, DT: "" });
  }
};

export { getAllCategories, createNewCategory, updateExistingCategory, deleteExistingCategory };

