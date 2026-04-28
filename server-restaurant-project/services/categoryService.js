import { Op } from "sequelize";
import { Category } from "../models/index.js";

const getCategories = async () => {
  try {
    let data = await Category.findAll({ order: [["name", "ASC"]] });
    return {
      EM: "Get all categories successfully.",
      EC: 0,
      DT: data,
    };
  } catch (error) {
    console.log("Error in getCategories service: ", error);
    return {
      EM: "Something wrongs in service...",
      EC: 500,
      DT: [],
    };
  }
};

const createCategory = async (categoryName) => {
  try {
    //Check name exists
    let checkNameCategory = await Category.findOne({
      where: { name: categoryName },
    });
    if (checkNameCategory) {
      return {
        EM: "Category name is already exists.",
        EC: 409,
        DT: [],
      };
    }
    //create new category
    const newCategory = await Category.create({ name: categoryName });
    return {
      EM: "Create new category successfully.",
      EC: 0,
      DT: newCategory,
    };
  } catch (error) {
    console.log("Error in createCategory service: ", error);
    return {
      EM: "Something wrongs in service...",
      EC: 500,
      DT: [],
    };
  }
};

const updateCategory = async (id, categoryName) => {
  try {
    let category = await Category.findOne({ where: { id: id } });
    if (!category) {
      return { EM: "Category not found.", EC: 404, DT: "" };
    }

    // Kiểm tra xem tên mới có bị trùng với danh mục KHÁC không
    let checkName = await Category.findOne({
      where: {
        name: categoryName,
        id: { [Op.ne]: id },
      },
    });

    if (checkName) {
      return { EM: "Category name already exists.", EC: 409, DT: "" };
    }

    await category.update({ name: categoryName });
    return { EM: "Update category successfully.", EC: 0, DT: category };
  } catch (error) {
    console.log("Error in updateCategory service: ", error);
    return { EM: "Something wrongs in service...", EC: 500, DT: "" };
  }
};

const deleteCategory = async (id) => {
  try {
    let category = await Category.findOne({ where: { id: id } });
    if (!category) {
      return { EM: "Category not found.", EC: 404, DT: "" };
    }

    // Tùy chọn: Có thể check xem có Product nào đang dùng Category này không trước khi xóa
    await category.destroy();
    return { EM: "Delete category successfully.", EC: 0, DT: "" };
  } catch (error) {
    console.log("Error in deleteCategory service: ", error);
    return { EM: "Something wrongs in service...", EC: 500, DT: "" };
  }
};

export { getCategories, createCategory, updateCategory, deleteCategory };
