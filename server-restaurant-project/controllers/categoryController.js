import {
  createCategory,
  deleteCategory,
  getCategories,
  updateCategory,
} from "../services/categoryService.js";

const getResponseStatus = (data) => {
  if (data.EC === 0) return 200;
  return [400, 404, 409].includes(data.EC) ? data.EC : 500;
};

const getAllCategories = async (req, res) => {
  try {
    const data = await getCategories();
    return res.status(getResponseStatus(data)).json(data);
  } catch (error) {
    return res.status(500).json({ EM: "Server error", EC: 500, DT: [] });
  }
};

const createNewCategory = async (req, res) => {
  try {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name) {
      return res.status(400).json({ EM: "Category name is required.", EC: 400, DT: "" });
    }
    if (name.length > 100) {
      return res.status(400).json({ EM: "Category name must be 100 characters or fewer.", EC: 400, DT: "" });
    }

    const data = await createCategory(name);
    return res.status(getResponseStatus(data)).json(data);
  } catch (error) {
    return res.status(500).json({ EM: "Server error", EC: 500, DT: "" });
  }
};

const updateExistingCategory = async (req, res) => {
  try {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name) {
      return res.status(400).json({ EM: "Category name is required.", EC: 400, DT: "" });
    }
    if (name.length > 100) {
      return res.status(400).json({ EM: "Category name must be 100 characters or fewer.", EC: 400, DT: "" });
    }

    const data = await updateCategory(req.params.id, name);
    return res.status(getResponseStatus(data)).json(data);
  } catch (error) {
    return res.status(500).json({ EM: "Server error", EC: 500, DT: "" });
  }
};

const deleteExistingCategory = async (req, res) => {
  try {
    const data = await deleteCategory(req.params.id);
    return res.status(getResponseStatus(data)).json(data);
  } catch (error) {
    return res.status(500).json({ EM: "Server error", EC: 500, DT: "" });
  }
};

export {
  getAllCategories,
  createNewCategory,
  updateExistingCategory,
  deleteExistingCategory,
};
