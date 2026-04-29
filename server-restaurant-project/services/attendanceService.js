import { Attendance, User } from "../models/index.js";
import { Op } from "sequelize";

// --- DÀNH CHO STAFF: THAO TÁC CÁ NHÂN ---

// 1. Kiểm tra trạng thái hiện tại (Đang trong ca hay ngoài ca?)
const checkCurrentStatusService = async (userId) => {
    try {
        // Tìm bản ghi mới nhất của user này
        const latestRecord = await Attendance.findOne({
            where: { user_id: userId },
            order: [['createdAt', 'DESC']]
        });

        if (!latestRecord || latestRecord.check_out_time !== null) {
            return { EC: 0, EM: "User is clocked out", DT: { isClockedIn: false, latestRecord: null } };
        } else {
            return { EC: 0, EM: "User is clocked in", DT: { isClockedIn: true, latestRecord } };
        }
    } catch (error) {
        console.error("Error in checkCurrentStatusService:", error);
        return { EC: 500, EM: "Internal server error", DT: "" };
    }
};

// 2. Thực hiện Check-In
const checkInService = async (userId) => {
    try {
        // Kiểm tra xem đã check-out ca trước chưa
        const statusCheck = await checkCurrentStatusService(userId);
        if (statusCheck.DT.isClockedIn) {
            return { EC: 400, EM: "You are already clocked in. Please check out first.", DT: "" };
        }

        const newRecord = await Attendance.create({
            user_id: userId,
            check_in_time: new Date()
        });

        return { EC: 0, EM: "Check-in successful", DT: newRecord };
    } catch (error) {
        console.error("Error in checkInService:", error);
        return { EC: 500, EM: "Internal server error", DT: "" };
    }
};

// 3. Thực hiện Check-Out
const checkOutService = async (userId) => {
    try {
        const statusCheck = await checkCurrentStatusService(userId);
        if (!statusCheck.DT.isClockedIn) {
            return { EC: 400, EM: "No active shift found. Please check in first.", DT: "" };
        }

        const activeRecord = statusCheck.DT.latestRecord;
        await activeRecord.update({ check_out_time: new Date() });

        return { EC: 0, EM: "Check-out successful", DT: activeRecord };
    } catch (error) {
        console.error("Error in checkOutService:", error);
        return { EC: 500, EM: "Internal server error", DT: "" };
    }
};

// --- DÀNH CHO ADMIN: XEM TỔNG HỢP ---

// 4. Lấy lịch sử chấm công
const getAttendanceLogService = async (options) => {
    try {
        const { page = 1, limit = 20, userId } = options;
        let whereCondition = {};
        
        // Nếu là Staff gọi, ép buộc chỉ lấy của chính họ. Nếu Admin gọi có userId, lọc theo User đó.
        if (userId) {
            whereCondition.user_id = userId;
        }

        const offset = (page - 1) * limit;
        
        const { count, rows } = await Attendance.findAndCountAll({
            where: whereCondition,
            order: [['createdAt', 'DESC']],
            limit: +limit,
            offset: +offset,
            include: [{ model: User, attributes: ['id', 'full_name', 'email'] }] // Lấy kèm tên nhân viên
        });

        return {
            EC: 0,
            EM: "Get attendance logs successfully",
            DT: {
                totalRows: count,
                totalPages: Math.ceil(count / limit),
                logs: rows
            }
        };
    } catch (error) {
        console.error("Error in getAttendanceLogService:", error);
        return { EC: 500, EM: "Internal server error", DT: "" };
    }
};

export { checkCurrentStatusService, checkInService, checkOutService, getAttendanceLogService };