import { 
    createOrderAndPaymentService, 
    getUserOrdersService, 
    reCreatePaymentLinkService,
    getAllOrdersService,
    updateOrderStatusService
} from "../services/orderService.js";

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

        return res.status(200).json({
            EC: result.EC,
            EM: result.EM,
            DT: result.DT
        });
    } catch (error) {
        console.error(">>> Error in handleCheckout controller:", error);
        return res.status(500).json({
            EC: -1,
            EM: "Server error",
            DT: ""
        });
    }
};

const handleGetUserOrders = async (req, res) => {
    try {
        const userId = req.user.id; 

        const result = await getUserOrdersService(userId);

        return res.status(200).json({
            EC: result.EC,
            EM: result.EM,
            DT: result.DT
        });
    } catch (error) {
        console.error(">>> Error in handleGetUserOrders controller:", error);
        return res.status(500).json({
            EC: -1,
            EM: "Server error",
            DT: ""
        });
    }
};

const handleRePayOrder = async (req, res) => {
    try {
        const userId = req.user.id; 
        const orderId = req.body.order_id; 

        if (!orderId) {
            return res.status(400).json({
                EC: 1,
                EM: "Missing order_id",
                DT: ""
            });
        }

        const result = await reCreatePaymentLinkService(userId, orderId);

        return res.status(200).json({
            EC: result.EC,
            EM: result.EM,
            DT: result.DT
        });
    } catch (error) {
        console.error(">>> Error in handleRePayOrder controller:", error);
        return res.status(500).json({
            EC: -1,
            EM: "Server error",
            DT: ""
        });
    }
};



const handleGetAllOrders = async (req, res) => {
    try {
        const options = {
            page: req.query.page || 1,
            limit: req.query.limit || 10,
            status: req.query.status,
            search: req.query.search
        };

        const result = await getAllOrdersService(options);
        return res.status(200).json(result);
    } catch (error) {
        console.error(">>> Error in handleGetAllOrders controller:", error);
        return res.status(500).json({ EC: -1, EM: "Server error", DT: "" });
    }
};

const handleUpdateOrderStatus = async (req, res) => {
    try {
        const orderId = req.params.id;
        const { status } = req.body;

        if (!status) {
            return res.status(400).json({ EC: 1, EM: "Missing status", DT: "" });
        }

        const result = await updateOrderStatusService(orderId, status);
        return res.status(200).json(result);
    } catch (error) {
        console.error(">>> Error in handleUpdateOrderStatus controller:", error);
        return res.status(500).json({ EC: -1, EM: "Server error", DT: "" });
    }
};

export { handleCheckout, handleGetUserOrders, handleRePayOrder, handleGetAllOrders, handleUpdateOrderStatus };