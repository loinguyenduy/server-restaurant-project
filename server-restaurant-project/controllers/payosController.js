import payOSInstance from "../config/payosConfig.js";
import { createPaymentLinkService } from "../services/payosService.js";
import { Order, Cart, CartItem } from "../models/index.js";

// Hàm xử lý tạo link thanh toán (đã làm ở bước trước)
const handleCreatePayment = async (req, res) => {
    try {
        const { amount, orderId } = req.body;
        if (!amount || !orderId) {
            return res.status(400).json({
                EC: 1,
                EM: "Missing required parameters: amount or orderId",
                DT: ""
            });
        }
        const result = await createPaymentLinkService(amount, orderId);
        return res.status(200).json(result);
    } catch (error) {
        console.error(">>> Error from Payment Controller:", error);
        return res.status(500).json({
            EC: -1,
            EM: "Internal server error",
            DT: ""
        });
    }
};

const handlePayOSWebhook = async (req, res) => {
    try {
        const webhookData = req.body;

        const verifiedData = await payOSInstance.webhooks.verify(webhookData);

        const { orderCode, amount, code } = verifiedData;

        if (code === "00") {
            console.log(`>>> Webhook verified. Success payment for OrderCode: ${orderCode}`);
            
            const existingOrder = await Order.findOne({
                where: { transaction_id: String(orderCode) }
            });

            if (existingOrder) {
                await existingOrder.update({
                    payment_status: "paid",
                    order_status: "processing"
                });

                const userCart = await Cart.findOne({
                    where: { user_id: existingOrder.user_id }
                });

                if (userCart) {
                    await CartItem.destroy({
                        where: { cart_id: userCart.id }
                    });
                    console.log(">>> Cart cleared for user:", existingOrder.user_id);
                }

                console.log(">>> Order and Cart updated successfully!");
            } else {
                console.warn(">>> Order not found for transaction_id:", orderCode);
            }
        }

        return res.status(200).json({
            success: true,
            message: "Webhook processed"
        });

    } catch (error) {
        console.error(">>> Webhook processing failed:", error);
        return res.status(400).json({
            success: false,
            message: "Invalid webhook data"
        });
    }
};

export { handleCreatePayment, handlePayOSWebhook };