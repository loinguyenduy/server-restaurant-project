import { Cart, CartItem, Product } from "../models/index.js"

const getCartService = async (userId) => {
  try {
    //Find cart in database where userId in cart = userId of user
  const cart = await Cart.findOne({
    where: {user_id: userId},
    include: [
      {
        model: CartItem,
        include: [{
          model: Product, 
          attributes: ["id", "name", "price", "image_url","stock_quantity", "is_available"]
        }]
      }
    ]
  })
  
  return {
    EM: "Get cart success",
    EC: 0,
    DT: cart ? cart : []
  }
  } catch (error) {
    console.log("Error in getCartService:", error);
    return { 
      EM: "Something wrongs in service...", 
      EC: 500, 
      DT: "" 
    };
  }
}

const addToCartService = async(userId, productId, quantity) => {
  try {
    //Check available of product
    const product = await Product.findByPk(productId)
    if(!product || !product.is_available){
      return {
        EM: "This product is currently unavailable.",
        EC: 404,
        DT: ""
      }
    }

    //Find or create new cart
    const [cart] = await Cart.findOrCreate({
      where: {user_id: userId},
      defaults: {user_id: userId} //if not, create new cart with userId
    })

    //Check if product is in cart
    const existingItem = await CartItem.findOne({
      where: {cart_id: cart.id, product_id: productId}
    })

    if(existingItem){
      //if product is available in cart, count total quantity
      const newQuantity = existingItem.quantity + quantity

      if(newQuantity > product.stock_quantity){
        return {
          EM: `Sorry, we only have ${product.stock_quantity} left.`,
          EC: 400,
          DT: 0
        }
      }

      await existingItem.update({quantity: newQuantity})
      return {
        EM: "Product quantity updated successfully.",
        EC: 0,
        DT: existingItem 
      }
    } else {
      if(quantity > product.stock_quantity){
        return {
          EM: `Sorry, we only have ${product.stock_quantity} left.`,
          EC: 400,
          DT: 0
        }
      }

      await CartItem.create({
        cart_id: cart.id,
        product_id: productId,
        quantity: quantity
      })

      return {
        EM: "Add product to cart successfully.",
        EC: 0,
        DT: ""
      }
    }
  } catch (error) {
    console.log("Error in addToCartService:", error);
    return { 
      EM: "Something wrongs in service...", 
      EC: 500, 
      DT: "" 
    };
  }
}

export {
  getCartService,
  addToCartService
}