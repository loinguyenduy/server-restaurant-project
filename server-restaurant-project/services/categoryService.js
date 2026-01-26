import { Category } from "../models/index.js";

const getCategories = async () => {
  try {
    let data = await Category.findAll({order: [["name", "ASC"]]});
    return {
      EM: "Get all categories successfully.",
      EC: 0,
      DT: data,
    };
  } catch (error) {
    console.log("Error in getCategories service: ", error);
    return {
      EM: "Error in getCategories service.",
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
      EM: "Error in createCategory service.",
      EC: 500,
      DT: [],
    };
  }
};

export { getCategories, createCategory };
