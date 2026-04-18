import { Order, OrderItem, Cart, CartItem, Product } from "../models/index.js";
import payOSInstance from "../config/payosConfig.js";
import { sequelize } from "../config/databaseConfig.js";

const createOrderAndPaymentService = async (userId, checkoutData) => {
    const transaction = await sequelize.transaction();

    try {
        const { address, phone_receiver, note, type } = checkoutData;

        const cart = await Cart.findOne({
            where: { user_id: userId },
            include: [{ model: CartItem, include: [{ model: Product }] }]
        });

        if (!cart || !cart.CartItems || cart.CartItems.length === 0) {
            return { EC: 404, EM: "Cart is empty", DT: "" };
        }

        let totalAmount = 0;
        cart.CartItems.forEach(item => {
            if (item.Product && item.Product.is_available) {
                totalAmount += parseFloat(item.Product.price) * item.quantity;
            }
        });

        const roundedTotalAmount = Math.round(totalAmount);

        const payosOrderCode = Number(String(Date.now()).slice(-6) + Math.floor(Math.random() * 100));

        const newOrder = await Order.create({
            user_id: userId,
            type: type || "online",
            total_amount: roundedTotalAmount,
            final_amount: roundedTotalAmount,
            payment_method: "payos", 
            payment_status: "pending", 
            transaction_id: String(payosOrderCode), 
            address: address,
            phone_receiver: phone_receiver,
            note: note,
            order_status: "pending"
        }, { transaction });

        const orderItemsData = cart.CartItems.map(item => {
            return {
                order_id: newOrder.id,
                product_id: item.product_id,
                quantity: item.quantity,
                price: item.Product.price
            };
        });
        await OrderItem.bulkCreate(orderItemsData, { transaction });

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
            DT: paymentLinkResponse.checkoutUrl
        };

    } catch (error) {
        await transaction.rollback();
        console.error(">>> Error in createOrderService:", error);
        return { EC: 500, EM: "Internal server error", DT: "" };
    }
};

export { createOrderAndPaymentService };