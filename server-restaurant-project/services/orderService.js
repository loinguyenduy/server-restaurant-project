import { Order, OrderItem, Cart, CartItem, Product } from "../models/index.js";
import payOSInstance from "../config/payosConfig.js";
import { sequelize } from "../config/databaseConfig.js";

const createOrderAndPaymentService = async (userId, checkoutData) => {
  /*
    transaction: use to ensure that all database operations within the transaction either succeed or fail together. 
    If any operation fails, the transaction can be rolled back to maintain data integrity.
    */
  const transaction = await sequelize.transaction();

  try {
    const { address, phone_receiver, note, type, payment_method } =
      checkoutData;

    const cart = await Cart.findOne({
      where: { user_id: userId },
      include: [{ model: CartItem, include: [{ model: Product }] }],
    });

    if (!cart || !cart.CartItems || cart.CartItems.length === 0) {
      return { EC: 404, EM: "Cart is empty", DT: "" };
    }

    let totalAmount = 0;
    // Loop through cart items to calculate total amount and check stock availability
    for (const item of cart.CartItems) {
      if (item.Product && item.Product.is_available) {
        if (item.Product.stock_quantity < item.quantity) {
          await transaction.rollback();
          return {
            EC: 400,
            EM: `Not enough stock for product: ${item.Product.name}`,
            DT: "",
          };
        }

        // Calculate total amount based on cart items and their associated products
        totalAmount += parseFloat(item.Product.price) * item.quantity;

        // Update stock_quantity
        await Product.update(
          { stock_quantity: item.Product.stock_quantity - item.quantity },
          { where: { id: item.product_id }, transaction },
        );
      }
    }

    const shippingFee = 5.0;
    const taxRate = 0.08;
    const taxAmount = totalAmount * taxRate;
    const finalAmount = totalAmount + taxAmount + shippingFee;

    const roundedTotalAmount = Math.round(finalAmount);
    const payosOrderCode = Number(
      String(Date.now()).slice(-6) + Math.floor(Math.random() * 100),
    );

    const method = payment_method || "cash"; // default to "cash" if payment_method is not provided

    const newOrder = await Order.create(
      {
        user_id: userId,
        type: type || "online",
        total_amount: totalAmount,
        final_amount: finalAmount,
        payment_method: method,
        payment_status: method === "cash" ? "pending" : "pending",
        transaction_id: String(payosOrderCode),
        address: address,
        phone_receiver: phone_receiver,
        note: note,
        order_status: method === "cash" ? "processing" : "pending",
      },
      { transaction },
    );

    const orderItemsData = cart.CartItems.map((item) => {
      return {
        order_id: newOrder.id,
        product_id: item.product_id,
        quantity: item.quantity,
        price: item.Product.price,
      };
    });
    // use bulkCreate to insert multiple order items at once, which is more efficient than inserting them one by one.
    // compare to create(), bulkCreate() allows you to insert multiple records in a single query, such as inserting multiple order items for a single order,
    // which can significantly improve performance when dealing with large datasets.
    await OrderItem.bulkCreate(orderItemsData, { transaction });

    if (method === "cash") {
      await CartItem.destroy({ where: { cart_id: cart.id }, transaction });
      await transaction.commit();
      return {
        EC: 0,
        EM: "Create order with cash payment success",
        DT: "",
      };
    } else {
      const bodyPayOS = {
        orderCode: payosOrderCode,
        amount: roundedTotalAmount,
        description: `Order ${String(payosOrderCode)}`,
        returnUrl: process.env.PAYOS_RETURN_URL,
        cancelUrl: process.env.PAYOS_CANCEL_URL,
      };

      // call PayOS API to create a payment request and get the payment link
      const paymentLinkResponse =
        await payOSInstance.paymentRequests.create(bodyPayOS);

      /*
        commit: If all operations within the transaction are successful, the transaction is committed, 
        which means that all changes made to the database during the transaction are saved permanently.
        */
      await transaction.commit();

      return {
        EC: 0,
        EM: "Create order success",
        DT: paymentLinkResponse.checkoutUrl,
      };
    }
  } catch (error) {
    await transaction.rollback();
    console.error(">>> Error in createOrderService:", error);
    return { EC: 500, EM: "Internal server error", DT: "" };
  }
};

const getUserOrdersService = async (userId) => {
  try {
    const orders = await Order.findAll({
      where: { user_id: userId },
      order: [["createdAt", "DESC"]],
      include: [
        {
          model: OrderItem,
          include: [
            {
              model: Product,
              attributes: ["id", "name", "image_url"],
            },
          ],
        },
      ],
    });

    if (!orders || orders.length === 0) {
      return {
        EC: 404,
        EM: "No orders found",
        DT: [],
      };
    }

    return {
      EC: 0,
      EM: "Get user orders successfully",
      DT: orders,
    };
  } catch (error) {
    console.error(">>> Error in getUserOrdersService:", error);
    return {
      EC: 500,
      EM: "Internal server error while fetching orders",
      DT: "",
    };
  }
};

// This function allows users to re-create a payment link for an order that is still pending payment.
const reCreatePaymentLinkService = async (userId, orderId) => {
  try {
    const order = await Order.findOne({
      where: {
        id: orderId,
        user_id: userId,
      },
    });

    if (!order) {
      return { EC: 404, EM: "Order not found", DT: "" };
    }

    if (order.payment_status !== "pending") {
      return {
        EC: 400,
        EM: `Cannot re-pay. Order payment status is currently: ${order.payment_status}`,
        DT: "",
      };
    }

    if (order.payment_method === "cash") {
      return {
        EC: 400,
        EM: "This order is paid by cash. No payment link needed.",
        DT: "",
      };
    }

    // create new unique order code for PayOS to avoid conflicts with previous payment link
    const newPayosOrderCode = Number(
      String(Date.now()).slice(-6) + Math.floor(Math.random() * 100),
    );

    // update order's transaction_id with the new PayOS order code
    await order.update({ transaction_id: String(newPayosOrderCode) });

    const bodyPayOS = {
      orderCode: newPayosOrderCode,
      amount: Number(order.final_amount),
      description: `Re-pay ${String(newPayosOrderCode)}`,
      returnUrl: process.env.PAYOS_RETURN_URL,
      cancelUrl: process.env.PAYOS_CANCEL_URL,
    };

    const paymentLinkResponse =
      await payOSInstance.paymentRequests.create(bodyPayOS);

    return {
      EC: 0,
      EM: "Create new payment link successfully",
      DT: paymentLinkResponse.checkoutUrl,
    };
  } catch (error) {
    console.error(">>> Error in reCreatePaymentLinkService:", error);
    return {
      EC: 500,
      EM: "Internal server error while re-creating payment link",
      DT: "",
    };
  }
};

export {
  createOrderAndPaymentService,
  getUserOrdersService,
  reCreatePaymentLinkService,
};
