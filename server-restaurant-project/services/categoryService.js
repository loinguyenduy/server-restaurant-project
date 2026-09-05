import { Op } from "sequelize";
import { Category, Product, sequelize } from "../models/index.js";

const getCategories = async () => {
  try {
    const categories = await Category.findAll({ order: [["name", "ASC"]] });
    return { EM: "Get all categories successfully.", EC: 0, DT: categories };
  } catch (error) {
    console.log("Error in getCategories service:", error);
    return { EM: "Unable to get categories.", EC: 500, DT: [] };
  }
};

const findCategoryWithSameName = (name, excludedId = null) => {
  const nameCondition = sequelize.where(
    sequelize.fn("LOWER", sequelize.col("name")),
    name.toLowerCase(),
  );
  const where = excludedId
    ? { [Op.and]: [nameCondition, { id: { [Op.ne]: excludedId } }] }
    : nameCondition;
  return Category.findOne({ where });
};

const createCategory = async (categoryName) => {
  try {
    const name = String(categoryName).trim();
    if (await findCategoryWithSameName(name)) {
      return { EM: "Category name already exists.", EC: 409, DT: "" };
    }

    const category = await Category.create({ name });
    return { EM: "Category created successfully.", EC: 0, DT: category };
  } catch (error) {
    console.log("Error in createCategory service:", error);
    return { EM: "Unable to create category.", EC: 500, DT: "" };
  }
};

const updateCategory = async (id, categoryName) => {
  try {
    const category = await Category.findByPk(id);
    if (!category) return { EM: "Category not found.", EC: 404, DT: "" };

    const name = String(categoryName).trim();
    if (await findCategoryWithSameName(name, id)) {
      return { EM: "Category name already exists.", EC: 409, DT: "" };
    }

    await category.update({ name });
    return { EM: "Category updated successfully.", EC: 0, DT: category };
  } catch (error) {
    console.log("Error in updateCategory service:", error);
    return { EM: "Unable to update category.", EC: 500, DT: "" };
  }
};

const deleteCategory = async (id) => {
  try {
    const category = await Category.findByPk(id);
    if (!category) return { EM: "Category not found.", EC: 404, DT: "" };

    const productCount = await Product.count({ where: { category_id: id } });
    if (productCount > 0) {
      return {
        EM: "This category still contains products. Move or remove them first.",
        EC: 409,
        DT: "",
      };
    }

    await category.destroy();
    return { EM: "Category deleted successfully.", EC: 0, DT: "" };
  } catch (error) {
    console.log("Error in deleteCategory service:", error);
    return { EM: "Unable to delete category.", EC: 500, DT: "" };
  }
};

export { getCategories, createCategory, updateCategory, deleteCategory };
