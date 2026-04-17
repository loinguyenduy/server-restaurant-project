import { Product, Category, sequelize } from "../models/index.js";
import { Op } from "sequelize";

const getProducts = async (options) => {
  try {
    //const category_id = categoryFilterId.category_id
    const { category_id, search, sort, page, limit} = options; //destructuring: get parameters from 'options'

    //initialize condition to query
    let whereCondition = {}; 
    let orderCondition = [["createdAt", "DESC"]];

    let offset = (page - 1) * limit; //offset: amount of page is skipped, ex: page 2 = 9 -> 18 | (2- 1) * 9 = 9 (skip 9 previous page) 

    //filter category
    if (category_id && category_id !== "all") {
      whereCondition.category_id = category_id;
    }
    // console.log(">>> Check whereCondition:", whereCondition);

    //search by keyword
    if (search) {
      const keyword = search.trim().toLowerCase();
      whereCondition.name = sequelize.where(
        sequelize.fn('LOWER', sequelize.col('Product.name')), 
        'LIKE',
        `%${keyword}%`
      )
    }

    //sort by price
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

    // count total of pages: math.ceil (làm tròn)
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
      EM: "Something wrongs in service...",
      EC: 500,
      DT: [],
    };
  }
};

export { getProducts, createProduct };
