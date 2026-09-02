import { getAnalyticsOverviewService, getDashboardStatsService } from "../services/dashboardService.js";

const handleGetDashboardStats = async (req, res) => {
    try {
        const result = await getDashboardStatsService();
        return res.status(200).json(result);
    } catch (error) {
        console.error(">>> Error in handleGetDashboardStats controller:", error);
        return res.status(500).json({ EC: -1, EM: "Server error", DT: "" });
    }
};

export { handleGetDashboardStats };
const handleGetAnalyticsOverview = async (req, res) => {
    const result = await getAnalyticsOverviewService(req.query);
    const status = result.EC === 0 ? 200 : result.EC === 400 ? 400 : 500;
    return res.status(status).json(result);
};

export { handleGetAnalyticsOverview };
