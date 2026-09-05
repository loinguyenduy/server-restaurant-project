import {
  MAX_CART_ITEMS,
  addToCartService,
  getCartService,
  removeCartItemService,
  syncCartService,
  updateCartItemService,
  validateGuestCartService,
} from "../services/cartService.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const getResponseStatus = (data) => {
  if (data.EC === 0) return 200;
  return [400, 403, 404, 409].includes(data.EC) ? data.EC : 500;
};

const sendServiceResponse = (res, data) => res.status(getResponseStatus(data)).json(data);

const validateProductId = (productId) => {
  return typeof productId === "string" && uuidPattern.test(productId);
};

const validateCartItems = (items) => {
  if (!Array.isArray(items)) return "Cart items must be an array.";
  if (items.length > MAX_CART_ITEMS) return `A cart request can contain at most ${MAX_CART_ITEMS} items.`;
  const quantitiesByProduct = new Map();

  for (const item of items) {
    if (!item || !validateProductId(item.product_id)) {
      return "Every cart item must contain a valid product ID.";
    }
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      return "Every cart item quantity must be a positive integer.";
    }
    const combinedQuantity = (quantitiesByProduct.get(item.product_id) || 0) + item.quantity;
    if (!Number.isSafeInteger(combinedQuantity)) {
      return "Combined cart item quantities are too large.";
    }
    quantitiesByProduct.set(item.product_id, combinedQuantity);
  }
  return "";
};

const getCart = async (req, res) => {
  try {
    return sendServiceResponse(res, await getCartService(req.user.id));
  } catch (error) {
    console.log("Error in getCart controller:", error);
    return res.status(500).json({ EM: "Server error.", EC: 500, DT: "" });
  }
};

const addToCart = async (req, res) => {
  try {
    const { product_id: productId, quantity } = req.body || {};
    if (!validateProductId(productId)) {
      return res.status(400).json({ EM: "A valid product ID is required.", EC: 400, DT: "" });
    }
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ EM: "Quantity must be a positive integer.", EC: 400, DT: "" });
    }

    return sendServiceResponse(res, await addToCartService(req.user.id, productId, quantity));
  } catch (error) {
    console.log("Error in addToCart controller:", error);
    return res.status(500).json({ EM: "Server error.", EC: 500, DT: "" });
  }
};

const updateCartItem = async (req, res) => {
  try {
    const { product_id: productId, quantity } = req.body || {};
    if (!validateProductId(productId)) {
      return res.status(400).json({ EM: "A valid product ID is required.", EC: 400, DT: "" });
    }
    if (!Number.isSafeInteger(quantity) || quantity < 0) {
      return res.status(400).json({ EM: "Quantity must be a non-negative integer.", EC: 400, DT: "" });
    }

    return sendServiceResponse(res, await updateCartItemService(req.user.id, productId, quantity));
  } catch (error) {
    console.log("Error in updateCartItem controller:", error);
    return res.status(500).json({ EM: "Server error.", EC: 500, DT: "" });
  }
};

const removeCartItem = async (req, res) => {
  try {
    const productId = req.params.product_id;
    if (!validateProductId(productId)) {
      return res.status(400).json({ EM: "A valid product ID is required.", EC: 400, DT: "" });
    }
    return sendServiceResponse(res, await removeCartItemService(req.user.id, productId));
  } catch (error) {
    console.log("Error in removeCartItem controller:", error);
    return res.status(500).json({ EM: "Server error.", EC: 500, DT: "" });
  }
};

const syncCart = async (req, res) => {
  try {
    const localCartItems = req.body?.local_cart;
    const validationError = validateCartItems(localCartItems);
    if (validationError) {
      return res.status(400).json({ EM: validationError, EC: 400, DT: "" });
    }
    return sendServiceResponse(res, await syncCartService(req.user.id, localCartItems));
  } catch (error) {
    console.log("Error in syncCart controller:", error);
    return res.status(500).json({ EM: "Server error.", EC: 500, DT: "" });
  }
};

const validateGuestCart = async (req, res) => {
  try {
    const items = req.body?.items;
    const validationError = validateCartItems(items);
    if (validationError) {
      return res.status(400).json({ EM: validationError, EC: 400, DT: "" });
    }
    return sendServiceResponse(res, await validateGuestCartService(items));
  } catch (error) {
    console.log("Error in validateGuestCart controller:", error);
    return res.status(500).json({ EM: "Server error.", EC: 500, DT: "" });
  }
};

export {
  addToCart,
  getCart,
  removeCartItem,
  syncCart,
  updateCartItem,
  validateGuestCart,
};
