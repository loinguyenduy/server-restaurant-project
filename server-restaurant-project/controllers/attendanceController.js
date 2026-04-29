import { checkCurrentStatusService, checkInService, checkOutService, getAttendanceLogService } from "../services/attendanceService.js";

const handleCheckStatus = async (req, res) => {
    try {
        let data = await checkCurrentStatusService(req.user.id);
        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({ EM: "Server Error", EC: 500 });
    }
};

const handleCheckIn = async (req, res) => {
    try {
        let data = await checkInService(req.user.id);
        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({ EM: "Server Error", EC: 500 });
    }
};

const handleCheckOut = async (req, res) => {
    try {
        let data = await checkOutService(req.user.id);
        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({ EM: "Server Error", EC: 500 });
    }
};

const handleGetAttendanceLogs = async (req, res) => {
    try {
        const userId = req.user.role === 'staff' ? req.user.id : (req.query.userId || null);
        const options = {
            page: req.query.page || 1,
            limit: req.query.limit || 20,
            userId: userId
        };
        let data = await getAttendanceLogService(options);
        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({ EM: "Server Error", EC: 500 });
    }
};

export { handleCheckStatus, handleCheckIn, handleCheckOut, handleGetAttendanceLogs };