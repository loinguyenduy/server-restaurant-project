import { Op } from "sequelize";
import { Order, User, Reservation } from "../models/index.js";

const getDashboardStatsService = async () => {
    try {
        // 1. Tổng doanh thu (Chỉ tính đơn đã Paid)
        const totalRevenue = await Order.sum('final_amount', { where: { 
            payment_status: 'paid',
            order_status: 'completed' 
        } });

        // 2. Tổng đơn hàng đã hoàn thành
        const totalOrders = await Order.count({ where: { order_status: 'completed' } });

        // 3. Tổng số lượng khách hàng (Chỉ đếm role customer)
        const totalUsers = await User.count({ where: { role: 'customer' } });

        // 4. Tổng số lượt đặt bàn
        const totalReservations = await Reservation.count({
            where: { status: { [Op.ne]: 'cancelled' } }
        });

        return {
            EC: 0,
            EM: "Get dashboard stats successfully",
            DT: {
                totalRevenue: totalRevenue || 0,
                totalOrders,
                totalUsers,
                totalReservations
            }
        };
    } catch (error) {
        console.log("Error in getDashboardStatsService:", error);
        return { EC: 500, EM: "Internal server error", DT: "" };
    }
};

export { getDashboardStatsService };