import { createProduct, getProducts, updateProduct, deleteProduct } from "../services/productService.js";

const getAllProducts = async (req, res) => {
  try {
    const options = {
      category_id: req.query.category_id,
      search: req.query.search,
      sort: req.query.sort,
      page: req.query.page || 1,    
      limit: req.query.limit || 9   
    };

    let data = await getProducts(options);

    return res.status(200).json({
      EM: data.EM,
      EC: data.EC,
      DT: data.DT,
    });
  } catch (error) {
    console.log("Error in getAllProducts server: ", error);
    return res.status(500).json({
      EM: "Something wrongs in server...",
      EC: 500,
      DT: [],
    });
  }
};

const createNewProduct = async (req, res) => {
  try {
    const {
      category_id,
      name,
      description,
      price,
      original_price,
      stock_quantity,
      is_available,
    } = req.body;

    const image_url = req.file ? req.file.path : "";

    // check empty name
    if (!name || name.trim().length === 0) {
      return res.status(400).json({
        EM: "Product name cannot be empty.",
        EC: 400,
        DT: "",
      });
    }

    //check empty category
    if (!category_id) {
      return res.status(400).json({
        EM: "Category cannot be empty.",
        EC: 400,
        DT: "",
      });
    }

    // check price
    if (isNaN(price) || Number(price) < 0) {
      return res.status(400).json({
        EM: "The product price must be a valid positive number.",
        EC: 400,
        DT: "",
      });
    }

    //check original price
    if (
      original_price &&
      (isNaN(original_price) || Number(original_price) < 0)
    ) {
      return res.status(400).json({
        EM: "Original price must be a valid positive number.",
        EC: 400,
        DT: "",
      });
    }

    //check stock quantity
    if (
      !Number.isInteger(Number(stock_quantity)) ||
      Number(stock_quantity) < 0
    ) {
      return res.status(400).json({
        EM: "Stock quantity must be a positive integer.",
        EC: 400,
        DT: "",
      });
    }

    const finalProductData = {
      ...req.body,
      image_url: image_url,
    };

    let data = await createProduct(finalProductData);
    return res.status(200).json({
      EM: data.EM,
      EC: data.EC,
      DT: data.DT,
    });
  } catch (error) {
    console.log("Error in createNewProduct server: ", error);
    return res.status(500).json({
      EM: "Something wrongs in server...",
      EC: 500,
      DT: [],
    });
  }
};

const updateExistingProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const image_url = req.file ? req.file.path : ""; // Bắt link ảnh mới từ Multer Cloudinary

    const finalProductData = {
      ...req.body,
    };
    
    // Chỉ ghi đè image_url nếu có file ảnh mới gửi lên
    if (image_url) {
      finalProductData.image_url = image_url;
    }

    let data = await updateProduct(id, finalProductData);
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ EM: "Server error", EC: 500, DT: "" });
  }
};

const deleteExistingProduct = async (req, res) => {
  try {
    const { id } = req.params;
    let data = await deleteProduct(id);
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ EM: "Server error", EC: 500, DT: "" });
  }
};

export { getAllProducts, createNewProduct, updateExistingProduct, deleteExistingProduct };
