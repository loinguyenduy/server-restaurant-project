import payOSInstance from "../config/payosConfig.js";

const createPaymentLinkService = async (amount, orderId) => {
    try {
        // Generate a unique order code for PayOS
        const orderCode = Number(String(Date.now()).slice(-6));

        // Prepare the request body for PayOS
        const body = {
            orderCode: orderCode,
            amount: Number(amount),
            description: `Pay ${String(orderId).slice(0, 10)}`,
            returnUrl: process.env.PAYOS_RETURN_URL,
            cancelUrl: process.env.PAYOS_CANCEL_URL,
        };

        // Call PayOS API to create a payment link
        const paymentLinkResponse = await payOSInstance.paymentRequests.create(body);
        
        return {
            EC: 0,
            EM: "Success",
            DT: paymentLinkResponse.checkoutUrl
        };
    } catch (error) {
        console.error(">>> Error from PayOS Service:", error);
        return {
            EC: -1,
            EM: error.message || "Failed to create payment link",
            DT: null
        };
    }
};

export { createPaymentLinkService };