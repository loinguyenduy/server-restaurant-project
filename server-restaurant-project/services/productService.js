import { Product, Category, sequelize } from "../models/index.js";
import { Op } from "sequelize";

const getProducts = async (options) => {
  try {
    const { category_id, search, sort, page, limit} = options;
    let whereCondition = {}; 
    let orderCondition = [["createdAt", "DESC"]];
    let offset = (page - 1) * limit;

    if (category_id && category_id !== "all") {
      whereCondition.category_id = category_id;
    }

    if (search) {
      const keyword = search.trim().toLowerCase();
      whereCondition.name = sequelize.where(
        sequelize.fn('LOWER', sequelize.col('Product.name')), 
        'LIKE',
        `%${keyword}%`
      )
    }

    if (sort === "price_asc") {
      orderCondition = [["price", "ASC"]];
    } else if (sort === "price_desc") {
      orderCondition = [["price", "DESC"]];
    }

    const { count, rows } = await Product.findAndCountAll({
      where: whereCondition,
      order: orderCondition, 
      limit: +limit,   
      offset: +offset, 
      include: [{ model: Category, attributes: ["name"] }],
      attributes: { exclude: ["updatedAt"] }
    });

    let totalPages = Math.ceil(count / limit);

    return {
      EM: "Get products with pagination successfully.",
      EC: 0,
      DT: {
        totalRows: count,
        totalPages: totalPages,
        products: rows
      },
    };
  } catch (error) {
    console.log("Error in getProducts service: ", error);
    return {
      EM: "Something wrongs in service...",
      EC: 500,
      DT: []
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

    let checkNameProduct = await Product.findOne({
      where: { name: name },
    });
    if (checkNameProduct) {
      return { EM: "Product name is already exists.", EC: 409, DT: [] };
    }

    let checkCategory = await Category.findOne({
      where: { id: category_id },
    });
    if (!checkCategory) {
      return { EM: "Category ID is not available.", EC: 404, DT: [] };
    }

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

    return { EM: "Create new product successfully.", EC: 0, DT: newProduct };
  } catch (error) {
    console.log("Error in createProduct service: ", error);
    return { EM: "Something wrongs in service...", EC: 500, DT: [] };
  }
};

const updateProduct = async (id, productData) => {
  try {
    let product = await Product.findOne({ where: { id: id } });
    if (!product) {
      return { EM: "Product not found.", EC: 404, DT: "" };
    }

    if (productData.name && productData.name !== product.name) {
      let checkName = await Product.findOne({ where: { name: productData.name } });
      if (checkName) return { EM: "Product name already exists.", EC: 409, DT: "" };
    }

    if (!productData.image_url) {
      productData.image_url = product.image_url;
    }

    // Logic quan trọng: Nếu update stock <= 0, tự động ép is_available = false
    if (productData.stock_quantity !== undefined) {
      const newStock = parseInt(productData.stock_quantity);
      if (newStock <= 0) {
        productData.is_available = false;
      }
    }

    await product.update(productData);
    return { EM: "Update product successfully.", EC: 0, DT: product };
  } catch (error) {
    console.log("Error in updateProduct service: ", error);
    return { EM: "Something wrongs in service...", EC: 500, DT: "" };
  }
};

const deleteProduct = async (id) => {
  try {
    let product = await Product.findOne({ where: { id: id } });
    if (!product) return { EM: "Product not found.", EC: 404, DT: "" };

    await product.destroy();
    return { EM: "Delete product successfully.", EC: 0, DT: "" };
  } catch (error) {
    console.log("Error in deleteProduct service: ", error);
    return { EM: "Something wrongs in service...", EC: 500, DT: "" };
  }
};

export { getProducts, createProduct, updateProduct, deleteProduct };