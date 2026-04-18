import { createOrderAndPaymentService } from "../services/orderService.js";

const handleCheckout = async (req, res) => {
    try {
        const userId = req.user.id; 
        const checkoutData = req.body; 

        if (!checkoutData.address || !checkoutData.phone_receiver) {
            return res.status(400).json({
                EC: 1,
                EM: "Missing shipping information",
                DT: ""
            });
        }

        const result = await createOrderAndPaymentService(userId, checkoutData);

        return res.status(200).json(result);
    } catch (error) {
        console.error(">>> Error in handleCheckout controller:", error);
        return res.status(500).json({
            EC: -1,
            EM: "Server error",
            DT: ""
        });
    }
};

export { handleCheckout };