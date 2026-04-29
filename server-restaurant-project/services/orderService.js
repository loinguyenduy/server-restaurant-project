import { Order, OrderItem, Cart, CartItem, Product, Table } from "../models/index.js";
import payOSInstance from "../config/payosConfig.js";
import { sequelize } from "../config/databaseConfig.js";
import { Op } from "sequelize";

const createOrderAndPaymentService = async (userId, checkoutData) => {
  const transaction = await sequelize.transaction();

  try {
    const { address, phone_receiver, note, type, payment_method } = checkoutData;

    const cart = await Cart.findOne({
      where: { user_id: userId },
      include: [{ model: CartItem, include: [{ model: Product }] }],
    });

    if (!cart || !cart.CartItems || cart.CartItems.length === 0) {
      return { EC: 404, EM: "Cart is empty", DT: "" };
    }

    let totalAmount = 0;
    
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

        totalAmount += parseFloat(item.Product.price) * item.quantity;

        // Trừ tồn kho và tự động cập nhật is_available
        const newStock = item.Product.stock_quantity - item.quantity;
        await Product.update(
          { 
            stock_quantity: newStock,
            is_available: newStock > 0
          },
          { where: { id: item.product_id }, transaction }
        );
      }
    }

    const shippingFee = 5.0;
    const taxRate = 0.08;
    const taxAmount = totalAmount * taxRate;
    const finalAmount = totalAmount + taxAmount + shippingFee;

    const roundedTotalAmount = Math.round(finalAmount);
    const payosOrderCode = Number(
      String(Date.now()).slice(-6) + Math.floor(Math.random() * 100)
    );

    const method = payment_method || "cash";

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
      { transaction }
    );

    const orderItemsData = cart.CartItems.map((item) => {
      return {
        order_id: newOrder.id,
        product_id: item.product_id,
        quantity: item.quantity,
        price: item.Product.price,
      };
    });
    
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

      const paymentLinkResponse = await payOSInstance.paymentRequests.create(bodyPayOS);
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
      return { EC: 404, EM: "No orders found", DT: [] };
    }

    return { EC: 0, EM: "Get user orders successfully", DT: orders };
  } catch (error) {
    console.error(">>> Error in getUserOrdersService:", error);
    return { EC: 500, EM: "Internal server error while fetching orders", DT: "" };
  }
};

const reCreatePaymentLinkService = async (userId, orderId) => {
  try {
    const order = await Order.findOne({
      where: { id: orderId, user_id: userId },
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

    const newPayosOrderCode = Number(
      String(Date.now()).slice(-6) + Math.floor(Math.random() * 100)
    );

    await order.update({ transaction_id: String(newPayosOrderCode) });

    const bodyPayOS = {
      orderCode: newPayosOrderCode,
      amount: Number(order.final_amount),
      description: `Re-pay ${String(newPayosOrderCode)}`,
      returnUrl: process.env.PAYOS_RETURN_URL,
      cancelUrl: process.env.PAYOS_CANCEL_URL,
    };

    const paymentLinkResponse = await payOSInstance.paymentRequests.create(bodyPayOS);

    return {
      EC: 0,
      EM: "Create new payment link successfully",
      DT: paymentLinkResponse.checkoutUrl,
    };
  } catch (error) {
    console.error(">>> Error in reCreatePaymentLinkService:", error);
    return { EC: 500, EM: "Internal server error while re-creating payment link", DT: "" };
  }
};

const getAllOrdersService = async (options) => {
    try {
        const { page, limit, status, search } = options;
        let whereCondition = {};
        let offset = (page - 1) * limit;

        if (status && status !== 'all') {
            whereCondition.order_status = status;
        }

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

        if (newStatus === 'completed') {
            if (order.payment_method === 'cash') {
                updateData.payment_status = 'paid';
            }
        }

        if (newStatus === 'cancelled' && order.payment_status === 'pending') {
            updateData.payment_status = 'failed'; 
        }

        await order.update(updateData);

        if ((newStatus === 'completed' || newStatus === 'cancelled') && order.table_id) {
            await Table.update({ status: 'available' }, { where: { id: order.table_id } });
        }

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
        // Nhận thêm return_url và cancel_url từ Frontend gửi lên
        const { table_id, items, payment_method, note, return_url, cancel_url } = posData;

        if (!items || items.length === 0) {
            return { EC: 400, EM: "No items in the order", DT: "" };
        }

        let totalAmount = 0;
        let orderItemsData = [];

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

            const newStock = product.stock_quantity - item.quantity;
            await product.update(
                { 
                    stock_quantity: newStock,
                    is_available: newStock > 0 
                },
                { transaction }
            );

            orderItemsData.push({
                product_id: product.id,
                quantity: item.quantity,
                price: product.price
            });
        }

        const taxRate = 0.08;
        const taxAmount = totalAmount * taxRate;
        const finalAmount = totalAmount + taxAmount; 
        const roundedTotalAmount = Math.round(finalAmount);
        
        const payosOrderCode = Number(String(Date.now()).slice(-6) + Math.floor(Math.random() * 100));
        const method = payment_method || "cash";

        const newOrder = await Order.create({
            user_id: staffId, 
            table_id: table_id || null,
            type: "offline",
            total_amount: totalAmount,
            final_amount: finalAmount,
            payment_method: method,
            payment_status: "pending",
            transaction_id: String(payosOrderCode),
            order_status: "processing", 
            note: note || ""
        }, { transaction });

        const finalOrderItems = orderItemsData.map(item => ({ ...item, order_id: newOrder.id }));
        await OrderItem.bulkCreate(finalOrderItems, { transaction });

        if (table_id) {
            await Table.update({ status: 'occupied' }, { where: { id: table_id }, transaction });
        }

        if (method === "cash") {
            await transaction.commit();
            return { EC: 0, EM: "Create POS order successfully (Cash)", DT: newOrder };
        } else {
            // DÙNG URL TỪ FRONTEND ĐỂ REDIRECT ĐÚNG VỀ TRANG POS
            const bodyPayOS = {
                orderCode: payosOrderCode,
                amount: roundedTotalAmount,
                description: `POS ${String(payosOrderCode)}`,
                returnUrl: return_url || process.env.PAYOS_RETURN_URL, // Ưu tiên URL từ POS
                cancelUrl: cancel_url || process.env.PAYOS_CANCEL_URL,
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