import { addToCartService, getCartService } from "../services/cartService.js"

const getCart = async (req, res) => {
  try {
    const userId = req.user.id
    // console.log("<<<check user id: ", userId)
    let data = await getCartService(userId)
    return res.status(200).json({
      EM: data.EM,
      EC: data.EC,
      DT: data.DT
    })
  } catch (error) {
    console.log("Error in getCart server: ", error);
    return res.status(500).json({
      EM: "Something wrongs in server...",
      EC: 500,
      DT: [],
    });
  }
}

const addToCart = async (req, res) => {
  try {
    const userId = req.user.id
    const {product_id, quantity} = req.body

    if(!product_id || !quantity){
      return res.status(400).json({
        EM: "Missing product information",
        EC: 400,
        DT: ""
      })
    }

    let data = await addToCartService(userId, product_id, quantity)
    return res.status(200).json({
      EM: data.EM,
      EC: data.EC,
      DT: data.DT
    })
  } catch (error) {
    
  }
}

export {
  getCart,
  addToCart
}