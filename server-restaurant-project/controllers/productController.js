import {
  createProduct,
  deleteProduct,
  getProducts,
  updateProduct,
} from "../services/productService.js";
import { removeCloudinaryImage } from "../services/productImageService.js";
import { emitProductAvailability } from "../socket/socket.js";

const getResponseStatus = (data) => {
  if (data.EC === 0) return 200;
  return [400, 403, 404, 409].includes(data.EC) ? data.EC : 500;
};

const parseBoolean = (value) => {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
};

const normalizeProductPayload = (body, isUpdate = false) => {
  const data = {};
  const has = (field) => Object.prototype.hasOwnProperty.call(body, field);

  if (!isUpdate || has("name")) {
    data.name = String(body.name || "").trim();
    if (!data.name) return { error: "Product name cannot be empty." };
    if (data.name.length > 150) return { error: "Product name must be 150 characters or fewer." };
  }

  if (!isUpdate || has("category_id")) {
    data.category_id = String(body.category_id || "").trim();
    if (!data.category_id) return { error: "Category is required." };
  }

  if (!isUpdate || has("price")) {
    data.price = Number(body.price);
    if (!Number.isSafeInteger(data.price) || data.price <= 0 || data.price > 99999999) {
      return { error: "Product price must be a positive VND integer." };
    }
  }

  if (has("original_price") && body.original_price !== "") {
    data.original_price = Number(body.original_price);
    if (!Number.isSafeInteger(data.original_price) || data.original_price < 0 || data.original_price > 99999999) {
      return { error: "Original price must be a non-negative VND integer." };
    }
  } else if (!isUpdate) {
    data.original_price = null;
  }

  if (!isUpdate || has("stock_quantity")) {
    data.stock_quantity = Number(body.stock_quantity);
    if (!Number.isInteger(data.stock_quantity) || data.stock_quantity < 0) {
      return { error: "Stock quantity must be a non-negative integer." };
    }
  }

  if (!isUpdate || has("prep_time_minutes")) {
    data.prep_time_minutes = Number(body.prep_time_minutes);
    if (
      !Number.isInteger(data.prep_time_minutes) ||
      data.prep_time_minutes < 1 ||
      data.prep_time_minutes > 180
    ) {
      return { error: "Preparation time must be between 1 and 180 minutes." };
    }
  }

  if (has("is_available")) {
    data.is_available = parseBoolean(body.is_available);
    if (data.is_available === null) {
      return { error: "Availability must be true or false." };
    }
  } else if (!isUpdate) {
    data.is_available = true;
  }

  if (has("description")) {
    data.description = String(body.description || "").trim() || null;
    if (data.description?.length > 5000) {
      return { error: "Product description must be 5,000 characters or fewer." };
    }
  }

  return { data };
};

const cleanupNewUpload = async (file) => {
  if (file?.filename) {
    await removeCloudinaryImage(file.filename);
  }
};

const getAllProducts = async (req, res) => {
  try {
    const integerPattern = /^\d+$/;
    if (req.query.page !== undefined && (!integerPattern.test(req.query.page) || Number(req.query.page) < 1)) {
      return res.status(400).json({ EM: "Page must be a positive integer.", EC: 400, DT: [] });
    }
    if (req.query.limit !== undefined && (!integerPattern.test(req.query.limit) || Number(req.query.limit) < 1 || Number(req.query.limit) > 100)) {
      return res.status(400).json({ EM: "Limit must be an integer from 1 to 100.", EC: 400, DT: [] });
    }

    const data = await getProducts({
      category_id: req.query.category_id,
      search: req.query.search,
      sort: req.query.sort,
      page: req.query.page,
      limit: req.query.limit,
    });
    return res.status(getResponseStatus(data)).json(data);
  } catch (error) {
    console.log("Error in getAllProducts controller:", error);
    return res.status(500).json({ EM: "Server error", EC: 500, DT: [] });
  }
};

const createNewProduct = async (req, res) => {
  try {
    const normalized = normalizeProductPayload(req.body);
    if (normalized.error) {
      await cleanupNewUpload(req.file);
      return res.status(400).json({ EM: normalized.error, EC: 400, DT: "" });
    }

    const data = await createProduct({
      ...normalized.data,
      image_url: req.file?.path || null,
    });

    if (data.EC !== 0) await cleanupNewUpload(req.file);
    if (data.EC === 0) {
      emitProductAvailability({
        productId: data.DT.id,
        stock_quantity: data.DT.stock_quantity,
        is_available: data.DT.is_available,
      });
    }
    return res.status(getResponseStatus(data)).json(data);
  } catch (error) {
    await cleanupNewUpload(req.file);
    console.log("Error in createNewProduct controller:", error);
    return res.status(500).json({ EM: "Server error", EC: 500, DT: "" });
  }
};

const updateExistingProduct = async (req, res) => {
  try {
    const normalized = normalizeProductPayload(req.body, true);
    if (normalized.error) {
      await cleanupNewUpload(req.file);
      return res.status(400).json({ EM: normalized.error, EC: 400, DT: "" });
    }

    const updateData = { ...normalized.data };
    if (req.file?.path) updateData.image_url = req.file.path;

    const data = await updateProduct(req.params.id, updateData);
    if (data.EC !== 0) await cleanupNewUpload(req.file);
    if (data.EC === 0) {
      emitProductAvailability({
        productId: data.DT.id,
        stock_quantity: data.DT.stock_quantity,
        is_available: data.DT.is_available,
      });
    }
    return res.status(getResponseStatus(data)).json(data);
  } catch (error) {
    await cleanupNewUpload(req.file);
    console.log("Error in updateExistingProduct controller:", error);
    return res.status(500).json({ EM: "Server error", EC: 500, DT: "" });
  }
};

const deleteExistingProduct = async (req, res) => {
  try {
    const data = await deleteProduct(req.params.id);
    if (data.EC === 0) {
      emitProductAvailability({ productId: req.params.id, deleted: true });
    }
    return res.status(getResponseStatus(data)).json(data);
  } catch (error) {
    console.log("Error in deleteExistingProduct controller:", error);
    return res.status(500).json({ EM: "Server error", EC: 500, DT: "" });
  }
};

export {
  getAllProducts,
  createNewProduct,
  updateExistingProduct,
  deleteExistingProduct,
};
