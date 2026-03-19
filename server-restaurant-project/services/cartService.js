import { Cart, CartItem, Product } from "../models/index.js";

const getCartService = async (userId) => {
  try {
    //Find cart in database where userId in cart = userId of user
    const cart = await Cart.findOne({
      where: { user_id: userId },
      include: [
        {
          model: CartItem,
          include: [
            {
              model: Product,
              attributes: [
                "id",
                "name",
                "price",
                "image_url",
                "stock_quantity",
                "is_available",
              ],
            },
          ],
        },
      ],
    });

    if (!cart) {
      return { 
        EM: "Get cart success", 
        EC: 0, 
        DT: { items: [], totalPrice: 0 } 
      };
    }

    //Initialize variable to count total price of cart
    let totalPrice = 0;
    const items = cart.CartItems || [];

    //Loop products to count and only count available product
    items.forEach(item => {
      if (item.Product && item.Product.is_available) {
        const itemPrice = parseFloat(item.Product.price);
        totalPrice += itemPrice * item.quantity;
      }
    });

    const cartData = {
      cart_id: cart.id,
      user_id: cart.user_id,
      items: items,
      totalPrice: totalPrice 
    };

    return {
      EM: "Get cart success",
      EC: 0,
      DT: cartData,
    };
  } catch (error) {
    console.log("Error in getCartService:", error);
    return {
      EM: "Something wrongs in service...",
      EC: 500,
      DT: "",
    };
  }
};

const addToCartService = async (userId, productId, quantity) => {
  try {
    //Check available of product
    const product = await Product.findByPk(productId);
    if (!product || !product.is_available) {
      return {
        EM: "This product is currently unavailable.",
        EC: 404,
        DT: "",
      };
    }

    //Find or create new cart
    const [cart] = await Cart.findOrCreate({
      where: { user_id: userId },
      defaults: { user_id: userId }, //if not, create new cart with userId
    });

    //Check if product is in cart
    const existingItem = await CartItem.findOne({
      where: { cart_id: cart.id, product_id: productId },
    });

    if (existingItem) {
      //if product is available in cart, count total quantity
      const newQuantity = existingItem.quantity + quantity;

      if (newQuantity > product.stock_quantity) {
        return {
          EM: `Sorry, we only have ${product.stock_quantity} left.`,
          EC: 400,
          DT: 0,
        };
      }

      //update new total quantity
      await existingItem.update({ quantity: newQuantity });
      return {
        EM: "Product quantity updated successfully.",
        EC: 0,
        DT: existingItem,
      };
    } else {
      if (quantity > product.stock_quantity) {
        return {
          EM: `Sorry, we only have ${product.stock_quantity} left.`,
          EC: 400,
          DT: 0,
        };
      }

      //create new cart item for user
      await CartItem.create({
        cart_id: cart.id,
        product_id: productId,
        quantity: quantity,
      });

      return {
        EM: "Add product to cart successfully.",
        EC: 0,
        DT: "",
      };
    }
  } catch (error) {
    console.log("Error in addToCartService:", error);
    return {
      EM: "Something wrongs in service...",
      EC: 500,
      DT: "",
    };
  }
};

const updateCartItemService = async (userId, productId, newQuantity) => {
  try {
    //find cart
    const cart = await Cart.findOne({
      where: { user_id: userId },
    });
    if (!cart) {
      return {
        EM: "Cart is not found.",
        EC: 404,
        DT: "",
      };
    }

    //find cart item
    const cartItem = await CartItem.findOne({
      where: { cart_id: cart.id, product_id: productId },
    });
    if (!cartItem) {
      return {
        EM: "Product is not exist in cart.",
        EC: 404,
        DT: "",
      };
    }

    //check stock quantity
    const product = await Product.findByPk(productId);
    if (newQuantity > product.stock_quantity) {
      return {
        EM: `Sorry, we only have ${product.stock_quantity} left.`,
        EC: 400,
        DT: 0,
      };
    }

    //If user clear quantity to 0, delete this product
    if (newQuantity <= 0) {
      await cartItem.destroy();
      return {
        EM: "This product is removed from the cart",
        EC: 0,
        DT: "",
      };
    }

    //update quantity
    await cartItem.update({ quantity: newQuantity });
    return {
      EM: "Update quantity successfully.",
      EC: 0,
      DT: "",
    };
  } catch (error) {
    console.log("Error in updateCartItemService:", error);
    return {
      EM: "Something wrongs in service...",
      EC: 500,
      DT: "",
    };
  }
};

const removeCartItemService = async (userId, productId) => {
  try {
    //find cart
    const cart = await Cart.findOne({
      where: { user_id: userId },
    });
    if (!cart) {
      return {
        EM: "Cart is not found",
        EC: 404,
        DT: "",
      };
    }

    const itemDelete = await CartItem.destroy({
      where: {
        cart_id: cart.id,
        product_id: productId,
      },
    });
    //Check if cart item is empty or not exist
    if (itemDelete === 0) {
      return {
        EM: "Product not found in your cart to remove",
        EC: 404,
        DT: "",
      };
    }

    return {
      EM: "Product is removed from your cart",
      EC: 0,
      DT: "",
    };
  } catch (error) {
    console.log("Error in removeCartItemService:", error);
    return {
      EM: "Something wrongs in service...",
      EC: 500,
      DT: "",
    };
  }
};

export {
  getCartService,
  addToCartService,
  updateCartItemService,
  removeCartItemService,
};
