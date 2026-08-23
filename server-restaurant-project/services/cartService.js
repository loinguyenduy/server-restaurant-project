import { Op } from "sequelize";
import { Cart, CartItem, Category, Product } from "../models/index.js";

const MAX_CART_ITEMS = 100;

const productInclude = {
  model: Product,
  attributes: [
    "id",
    "category_id",
    "name",
    "price",
    "image_url",
    "stock_quantity",
    "is_available",
    "prep_time_minutes",
  ],
  include: [{ model: Category, attributes: ["name"] }],
};

const buildIssues = (items) => {
  const issues = [];

  for (const item of items) {
    if (!item.Product) {
      issues.push({
        product_id: item.product_id,
        type: "deleted",
        blocking: true,
        message: "This dish no longer exists and should be removed.",
      });
      continue;
    }

    if (!item.Product.is_available || item.Product.stock_quantity <= 0) {
      issues.push({
        product_id: item.product_id,
        type: "unavailable",
        blocking: true,
        message: `${item.Product.name} is currently unavailable.`,
      });
      continue;
    }

    if (item.quantity > item.Product.stock_quantity) {
      issues.push({
        product_id: item.product_id,
        type: "reduced_stock",
        blocking: true,
        available_quantity: item.Product.stock_quantity,
        message: `Only ${item.Product.stock_quantity} of ${item.Product.name} are available.`,
      });
    }
  }

  return issues;
};

const getCartData = async (userId) => {
  const cart = await Cart.findOne({
    where: { user_id: userId },
    include: [{ model: CartItem, include: [productInclude] }],
    order: [[CartItem, "createdAt", "ASC"]],
  });

  if (!cart) {
    return { user_id: userId, items: [], totalPrice: 0, issues: [] };
  }

  const items = cart.CartItems || [];
  const issues = buildIssues(items);
  const totalPrice = items.reduce((total, item) => {
    if (!item.Product || !item.Product.is_available || item.Product.stock_quantity <= 0) {
      return total;
    }
    return total + Number(item.Product.price) * item.quantity;
  }, 0);

  return {
    cart_id: cart.id,
    user_id: cart.user_id,
    items,
    totalPrice,
    issues,
  };
};

const getCartService = async (userId) => {
  try {
    return { EM: "Cart retrieved successfully.", EC: 0, DT: await getCartData(userId) };
  } catch (error) {
    console.log("Error in getCartService:", error);
    return { EM: "Unable to retrieve the cart.", EC: 500, DT: "" };
  }
};

const addToCartService = async (userId, productId, quantity) => {
  try {
    const product = await Product.findByPk(productId);
    if (!product) return { EM: "Product not found.", EC: 404, DT: "" };
    if (!product.is_available || product.stock_quantity <= 0) {
      return { EM: "This product is currently unavailable.", EC: 409, DT: "" };
    }

    const [cart] = await Cart.findOrCreate({
      where: { user_id: userId },
      defaults: { user_id: userId },
    });
    const existingItem = await CartItem.findOne({
      where: { cart_id: cart.id, product_id: productId },
    });
    const nextQuantity = (existingItem?.quantity || 0) + quantity;

    if (nextQuantity > product.stock_quantity) {
      return {
        EM: `Only ${product.stock_quantity} of this product are available.`,
        EC: 400,
        DT: "",
      };
    }

    if (existingItem) await existingItem.update({ quantity: nextQuantity });
    else await CartItem.create({ cart_id: cart.id, product_id: productId, quantity });

    return { EM: "Product added to the cart.", EC: 0, DT: await getCartData(userId) };
  } catch (error) {
    console.log("Error in addToCartService:", error);
    return { EM: "Unable to add the product to the cart.", EC: 500, DT: "" };
  }
};

const updateCartItemService = async (userId, productId, newQuantity) => {
  try {
    const cart = await Cart.findOne({ where: { user_id: userId } });
    if (!cart) return { EM: "Cart not found.", EC: 404, DT: "" };

    const cartItem = await CartItem.findOne({
      where: { cart_id: cart.id, product_id: productId },
    });
    if (!cartItem) return { EM: "Product not found in the cart.", EC: 404, DT: "" };

    if (newQuantity === 0) {
      await cartItem.destroy();
      return { EM: "Product removed from the cart.", EC: 0, DT: await getCartData(userId) };
    }

    const product = await Product.findByPk(productId);
    if (!product) return { EM: "Product no longer exists. Remove it from the cart.", EC: 404, DT: "" };
    if (!product.is_available || product.stock_quantity <= 0) {
      return { EM: "This product is currently unavailable.", EC: 409, DT: "" };
    }
    if (newQuantity > product.stock_quantity) {
      return {
        EM: `Only ${product.stock_quantity} of this product are available.`,
        EC: 400,
        DT: "",
      };
    }

    await cartItem.update({ quantity: newQuantity });
    return { EM: "Cart quantity updated.", EC: 0, DT: await getCartData(userId) };
  } catch (error) {
    console.log("Error in updateCartItemService:", error);
    return { EM: "Unable to update the cart.", EC: 500, DT: "" };
  }
};

const removeCartItemService = async (userId, productId) => {
  try {
    const cart = await Cart.findOne({ where: { user_id: userId } });
    if (!cart) return { EM: "Cart not found.", EC: 404, DT: "" };

    const deletedCount = await CartItem.destroy({
      where: { cart_id: cart.id, product_id: productId },
    });
    if (deletedCount === 0) {
      return { EM: "Product not found in the cart.", EC: 404, DT: "" };
    }

    return { EM: "Product removed from the cart.", EC: 0, DT: await getCartData(userId) };
  } catch (error) {
    console.log("Error in removeCartItemService:", error);
    return { EM: "Unable to remove the product from the cart.", EC: 500, DT: "" };
  }
};

const mergeRequestItems = (items) => {
  const merged = new Map();
  let mergedDuplicates = 0;

  for (const item of items) {
    if (merged.has(item.product_id)) mergedDuplicates += 1;
    merged.set(item.product_id, (merged.get(item.product_id) || 0) + item.quantity);
  }

  return { merged, mergedDuplicates };
};

const syncCartService = async (userId, localCartItems) => {
  try {
    const [cart] = await Cart.findOrCreate({
      where: { user_id: userId },
      defaults: { user_id: userId },
    });
    const { merged, mergedDuplicates } = mergeRequestItems(localCartItems);
    const summary = { mergedDuplicates, adjusted: [], skipped: [] };

    const products = await Product.findAll({
      where: { id: { [Op.in]: [...merged.keys()] } },
    });
    const productsById = new Map(products.map((product) => [product.id, product]));

    for (const [productId, guestQuantity] of merged) {
      const product = productsById.get(productId);
      if (!product) {
        summary.skipped.push({ product_id: productId, reason: "deleted" });
        continue;
      }
      if (!product.is_available || product.stock_quantity <= 0) {
        summary.skipped.push({ product_id: productId, reason: "unavailable" });
        continue;
      }

      const existingItem = await CartItem.findOne({
        where: { cart_id: cart.id, product_id: productId },
      });
      const requestedQuantity = (existingItem?.quantity || 0) + guestQuantity;
      const nextQuantity = Math.min(requestedQuantity, product.stock_quantity);

      if (nextQuantity < requestedQuantity) {
        summary.adjusted.push({
          product_id: productId,
          reason: "stock_cap",
          quantity: nextQuantity,
        });
      }

      if (existingItem) await existingItem.update({ quantity: nextQuantity });
      else await CartItem.create({ cart_id: cart.id, product_id: productId, quantity: nextQuantity });
    }

    const cartData = await getCartData(userId);
    cartData.syncSummary = summary;
    return { EM: "Cart synchronized successfully.", EC: 0, DT: cartData };
  } catch (error) {
    console.log("Error in syncCartService:", error);
    return { EM: "Unable to synchronize the cart.", EC: 500, DT: "" };
  }
};

const validateGuestCartService = async (guestItems) => {
  try {
    const { merged, mergedDuplicates } = mergeRequestItems(guestItems);
    const products = await Product.findAll({
      where: { id: { [Op.in]: [...merged.keys()] } },
      include: [{ model: Category, attributes: ["name"] }],
      attributes: productInclude.attributes,
    });
    const productsById = new Map(products.map((product) => [product.id, product]));
    const items = [];
    const issues = [];

    for (const [productId, requestedQuantity] of merged) {
      const product = productsById.get(productId);
      if (!product) {
        issues.push({
          product_id: productId,
          type: "deleted",
          blocking: false,
          message: "A dish was removed because it no longer exists.",
        });
        continue;
      }

      let quantity = requestedQuantity;
      if (product.stock_quantity > 0 && quantity > product.stock_quantity) {
        quantity = product.stock_quantity;
        issues.push({
          product_id: productId,
          type: "reduced_stock",
          blocking: false,
          available_quantity: quantity,
          message: `${product.name} was reduced to the available stock of ${quantity}.`,
        });
      }

      if (!product.is_available || product.stock_quantity <= 0) {
        issues.push({
          product_id: productId,
          type: "unavailable",
          blocking: true,
          message: `${product.name} is currently unavailable.`,
        });
      }

      items.push({ product_id: productId, quantity, Product: product });
    }

    const totalPrice = items.reduce((total, item) => {
      if (!item.Product.is_available || item.Product.stock_quantity <= 0) return total;
      return total + Number(item.Product.price) * item.quantity;
    }, 0);

    return {
      EM: "Guest cart validated successfully.",
      EC: 0,
      DT: {
        user_id: null,
        items,
        totalPrice,
        issues,
        validationSummary: { mergedDuplicates, adjustedItems: issues.length },
      },
    };
  } catch (error) {
    console.log("Error in validateGuestCartService:", error);
    return { EM: "Unable to validate the guest cart.", EC: 500, DT: "" };
  }
};

export {
  MAX_CART_ITEMS,
  addToCartService,
  getCartData,
  getCartService,
  removeCartItemService,
  syncCartService,
  updateCartItemService,
  validateGuestCartService,
};
