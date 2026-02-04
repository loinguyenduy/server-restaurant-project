import { Product, Category } from "../models/index.js";

const getProducts = async (categoryFilterId) => {
  try {
    //const category_id = categoryFilterId.category_id
    const {category_id} = categoryFilterId //destructuring
    let whereCondition = {}

    if(category_id && category_id !== 'all'){
      whereCondition.category_id = category_id
    }
    // console.log(">>> Check whereCondition:", whereCondition);

    let data = await Product.findAll({
      order: [['createdAt', 'DESC']],
      attributes: { exclude: ["createdAt", "updatedAt"] },
      include: [{ model: Category, attributes: ["name"] }],
      where: whereCondition
    });

    return {
      EM: "Get all products successfully.",
      EC: 0,
      DT: data,
    };
  } catch (error) {
    console.log("Error in getProducts service: ", error);
    return {
      EM: "Error in getProducts service.",
      EC: 500,
      DT: [],
    };
  }
};

const createProduct = async (productData) => {
  try {
    const {
      category_id,
      name,
      description,
      price,
      original_price,
      image_url,
      stock_quantity,
      is_available,
    } = productData;

    //check name exist
    let checkNameProduct = await Product.findOne({
      where: { name: name },
    });
    if (checkNameProduct) {
      return {
        EM: "Product name is already exists.",
        EC: 409,
        DT: [],
      };
    }

    //check category_id exist
    let checkCategory = await Category.findOne({
      where: { id: category_id },
    });
    if (!checkCategory) {
      return {
        EM: "Category ID is not available.",
        EC: 404,
        DT: [],
      };
    }

    //create new product
    const newProduct = await Product.create({
      category_id,
      name,
      description,
      price,
      original_price,
      image_url,
      stock_quantity,
      is_available,
    });

    return {
      EM: "Create new product successfully.",
      EC: 0,
      DT: newProduct,
    };
  } catch (error) {
    console.log("Error in createProduct service: ", error);
    return {
      EM: "Error in createProduct service.",
      EC: 500,
      DT: [],
    };
  }
};

export { getProducts, createProduct };
