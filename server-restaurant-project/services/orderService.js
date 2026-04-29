import { Order, OrderItem, Cart, CartItem, Product, Table } from "../models/index.js";
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


const getAllOrdersService = async (options) => {
    try {
        const { page, limit, status, search } = options;
        let whereCondition = {};
        let offset = (page - 1) * limit;

        // Lọc theo trạng thái (pending, processing, completed, cancelled)
        if (status && status !== 'all') {
            whereCondition.order_status = status;
        }

        // Tìm kiếm theo số điện thoại người nhận hoặc Mã đơn hàng (transaction_id)
        if (search) {
            const keyword = search.trim();
            whereCondition = {
                ...whereCondition,
                [Op.or]: [
                    { phone_receiver: { [Op.like]: `%${keyword}%` } },
                    { transaction_id: { [Op.like]: `%${keyword}%` } }
                ]
            };
        }

        const { count, rows } = await Order.findAndCountAll({
            where: whereCondition,
            order: [["createdAt", "DESC"]],
            limit: +limit,
            offset: +offset,
            include: [
                {
                    model: OrderItem,
                    include: [{ model: Product, attributes: ["id", "name", "image_url"] }]
                },
                {
                    model: Table,
                    attributes: ["table_number"]
                }
            ]
        });

        let totalPages = Math.ceil(count / limit);

        return {
            EC: 0,
            EM: "Get all orders successfully",
            DT: {
                totalRows: count,
                totalPages: totalPages,
                orders: rows
            }
        };
    } catch (error) {
        console.error(">>> Error in getAllOrdersService:", error);
        return { EC: 500, EM: "Internal server error", DT: "" };
    }
};

const updateOrderStatusService = async (orderId, newStatus) => {
    try {
        // Chỉ cho phép các trạng thái hợp lệ
        const validStatuses = ['pending', 'processing', 'completed', 'cancelled'];
        if (!validStatuses.includes(newStatus)) {
            return { EC: 400, EM: "Invalid order status", DT: "" };
        }

        const order = await Order.findOne({ where: { id: orderId } });
        if (!order) {
            return { EC: 404, EM: "Order not found", DT: "" };
        }

        if (order.order_status === 'completed' || order.order_status === 'cancelled') {
            return { 
                EC: 403, 
                EM: `This order is already ${order.order_status} and cannot be modified.`, 
                DT: "" 
            };
        }

        let updateData = { order_status: newStatus };

        // Nếu đơn hàng được đánh dấu là Completed
        if (newStatus === 'completed') {
            // Và nếu là thanh toán tiền mặt (Cash), ta tự động coi như đã thu tiền
            if (order.payment_method === 'cash') {
                updateData.payment_status = 'paid';
            }
        }

        // Nếu đơn hàng bị Hủy (Cancelled), ta nên cập nhật trạng thái thanh toán (nếu cần)
        if (newStatus === 'cancelled' && order.payment_status === 'pending') {
            updateData.payment_status = 'failed'; 
        }

        await order.update(updateData);

        return {
            EC: 0,
            EM: `Order status updated to ${newStatus} successfully`,
            DT: ""
        };
    } catch (error) {
        console.error(">>> Error in updateOrderStatusService:", error);
        return { EC: 500, EM: "Internal server error", DT: "" };
    }
};

const createPosOrderService = async (staffId, posData) => {
    const transaction = await sequelize.transaction();
    try {
        // items: mảng các object { product_id, quantity }
        const { table_id, items, payment_method, note } = posData;

        if (!items || items.length === 0) {
            return { EC: 400, EM: "No items in the order", DT: "" };
        }

        let totalAmount = 0;
        let orderItemsData = [];

        // 1. Kiểm tra tồn kho và tính tiền
        for (const item of items) {
            const product = await Product.findByPk(item.product_id, { transaction });
            if (!product || !product.is_available) {
                await transaction.rollback();
                return { EC: 404, EM: `Product not found or unavailable: ${item.product_id}`, DT: "" };
            }

            if (product.stock_quantity < item.quantity) {
                await transaction.rollback();
                return { EC: 400, EM: `Not enough stock for product: ${product.name}`, DT: "" };
            }

            totalAmount += parseFloat(product.price) * item.quantity;

            // Trừ tồn kho
            await product.update(
                { stock_quantity: product.stock_quantity - item.quantity },
                { transaction }
            );

            // Chuẩn bị data cho OrderItem
            orderItemsData.push({
                product_id: product.id,
                quantity: item.quantity,
                price: product.price
            });
        }

        const taxRate = 0.08;
        const taxAmount = totalAmount * taxRate;
        // Đơn offline không có phí ship
        const finalAmount = totalAmount + taxAmount; 
        const roundedTotalAmount = Math.round(finalAmount);
        
        const payosOrderCode = Number(String(Date.now()).slice(-6) + Math.floor(Math.random() * 100));
        const method = payment_method || "cash";

        // 2. Tạo đơn hàng (Offline)
        const newOrder = await Order.create({
            user_id: staffId, // Lưu ID của Staff tạo đơn
            table_id: table_id || null,
            type: "offline",
            total_amount: totalAmount,
            final_amount: finalAmount,
            payment_method: method,
            payment_status: "pending",
            transaction_id: String(payosOrderCode),
            order_status: "processing", // Bếp bắt đầu làm luôn
            note: note || ""
        }, { transaction });

        // Gắn order_id vào mảng OrderItems
        const finalOrderItems = orderItemsData.map(item => ({ ...item, order_id: newOrder.id }));
        await OrderItem.bulkCreate(finalOrderItems, { transaction });

        // 3. Cập nhật trạng thái Bàn (Nếu có table_id)
        if (table_id) {
            await Table.update({ status: 'occupied' }, { where: { id: table_id }, transaction });
        }

        // 4. Xử lý thanh toán
        if (method === "cash") {
            await transaction.commit();
            return { EC: 0, EM: "Create POS order successfully (Cash)", DT: newOrder };
        } else {
            const bodyPayOS = {
                orderCode: payosOrderCode,
                amount: roundedTotalAmount,
                description: `POS ${String(payosOrderCode)}`,
                returnUrl: process.env.PAYOS_RETURN_URL,
                cancelUrl: process.env.PAYOS_CANCEL_URL,
            };
            const paymentLinkResponse = await payOSInstance.paymentRequests.create(bodyPayOS);
            await transaction.commit();
            return { EC: 0, EM: "Create POS order successfully (PayOS)", DT: paymentLinkResponse.checkoutUrl };
        }

    } catch (error) {
        await transaction.rollback();
        console.error(">>> Error in createPosOrderService:", error);
        return { EC: 500, EM: "Internal server error", DT: "" };
    }
};

export {
  createOrderAndPaymentService,
  getUserOrdersService,
  reCreatePaymentLinkService,
  getAllOrdersService,
  updateOrderStatusService,
  createPosOrderService
};
