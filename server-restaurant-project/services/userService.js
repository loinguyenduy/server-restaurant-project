import bcrypt from "bcryptjs";
import { User } from "../models/index.js";
import { Op } from "sequelize";

// Hàm băm mật khẩu
const hashUserPassword = async (userPassword) => {
    const salt = await bcrypt.genSalt(10);
    return await bcrypt.hash(userPassword, salt);
};

const changePasswordService = async (userId, oldPassword, newPassword) => {
    try {
        // 1. Tìm User trong DB
        let user = await User.findOne({ where: { id: userId } });
        if (!user) {
            return { EC: 404, EM: "User not found", DT: "" };
        }

        // 2. Kiểm tra mật khẩu cũ có khớp không
        const isCorrectPassword = await bcrypt.compare(oldPassword, user.password);
        if (!isCorrectPassword) {
            return { EC: 400, EM: "Your current password is incorrect.", DT: "" };
        }

        // 3. Nếu khớp, mã hóa mật khẩu mới
        const hashedNewPassword = await hashUserPassword(newPassword);

        // 4. Lưu vào DB
        await user.update({ password: hashedNewPassword });

        return {
            EC: 0,
            EM: "Password changed successfully. Please login again.",
            DT: ""
        };

    } catch (error) {
        console.log(">>> Error in changePasswordService: ", error);
        return { EC: 500, EM: "Internal server error", DT: "" };
    }
};

const updateProfileService = async (userId, updateData) => {
    try {
        // Chỉ bóc tách những trường được phép sửa
        const { full_name, phone_number, gender } = updateData;

        // Tìm User
        let user = await User.findOne({ where: { id: userId } });
        if (!user) {
            return { EC: 404, EM: "User not found", DT: "" };
        }

        // Validate số điện thoại cơ bản nếu có truyền lên
        if (phone_number) {
            const phoneRegex = /^[0-9]+$/;
            if (!phoneRegex.test(phone_number)) {
                return { EC: 400, EM: "Phone number must contain only digits.", DT: "" };
            }
            
            // Check xem SĐT mới có bị trùng với người khác không (ngoại trừ chính mình)
            const existingPhone = await User.findOne({ 
                where: { 
                    phone_number: phone_number,
                    id: { [Op.ne]: userId } // id Not Equal userId
                } 
            });
            if (existingPhone) {
                return { EC: 409, EM: "This phone number is already registered to another account.", DT: "" };
            }
        }

        // Cập nhật dữ liệu
        await user.update({
            full_name: full_name || user.full_name,
            phone_number: phone_number || user.phone_number,
            gender: gender || user.gender
        });

        // Lấy dữ liệu mới nhất (đã bỏ password) để trả về Frontend cập nhật Redux
        const updatedUser = await User.findOne({ 
            where: { id: userId },
            attributes: { exclude: ["password"] }
        });

        return {
            EC: 0,
            EM: "Profile updated successfully.",
            DT: updatedUser
        };

    } catch (error) {
        console.log(">>> Error in updateProfileService: ", error);
        return { EC: 500, EM: "Internal server error", DT: "" };
    }
};

const getAllUsersService = async (options) => {
    try {
        const { search, role, page, limit } = options;
        let whereCondition = {};
        let offset = (page - 1) * limit;

        // Tìm kiếm đa luồng (Tên, Email hoặc Username)
        if (search) {
            const keyword = search.trim().toLowerCase();
            whereCondition = {
                [Op.or]: [
                    { full_name: sequelize.where(sequelize.fn('LOWER', sequelize.col('full_name')), 'LIKE', `%${keyword}%`) },
                    { email: sequelize.where(sequelize.fn('LOWER', sequelize.col('email')), 'LIKE', `%${keyword}%`) },
                    { username: sequelize.where(sequelize.fn('LOWER', sequelize.col('username')), 'LIKE', `%${keyword}%`) }
                ]
            };
        }

        // Lọc theo Role (nếu có truyền lên, ví dụ chỉ xem staff hoặc customer)
        if (role && role !== "all") {
            whereCondition.role = role;
        }

        const { count, rows } = await User.findAndCountAll({
            where: whereCondition,
            order: [["createdAt", "DESC"]],
            limit: +limit,
            offset: +offset,
            attributes: { exclude: ["password"] } // Cực kỳ quan trọng: Không bao giờ trả về password
        });

        let totalPages = Math.ceil(count / limit);

        return {
            EM: "Get users successfully.",
            EC: 0,
            DT: {
                totalRows: count,
                totalPages: totalPages,
                users: rows
            }
        };
    } catch (error) {
        console.log("Error in getAllUsersService: ", error);
        return { EM: "Something wrongs in service...", EC: 500, DT: [] };
    }
};

const updateUserRoleService = async (targetUserId, newRole) => {
    try {
        // 1. Tìm user mục tiêu
        let user = await User.findOne({ where: { id: targetUserId } });
        if (!user) return { EM: "User not found.", EC: 404, DT: "" };

        // 2. CHỐT CHẶN 1: Nếu user mục tiêu đang là admin, không cho phép đổi role
        if (user.role === 'admin') {
            return { EM: "Cannot change role of an Administrator.", EC: 403, DT: "" };
        }

        // 3. CHỐT CHẶN 2: Không cho phép nâng cấp bất kỳ ai lên admin
        if (newRole === 'admin') {
            return { EM: "You do not have permission to appoint a new Admin.", EC: 403, DT: "" };
        }

        // 4. CHỐT CHẶN 3: Chỉ cho phép xoay quanh customer và staff
        if (!['customer', 'staff'].includes(newRole)) {
            return { EM: "Invalid role selection.", EC: 400, DT: "" };
        }

        await user.update({ role: newRole });
        return { EM: `User role updated to ${newRole} successfully.`, EC: 0, DT: "" };
    } catch (error) {
        console.log("Error in updateUserRoleService: ", error);
        return { EM: "Something wrongs in service...", EC: 500, DT: "" };
    }
};

const toggleUserStatusService = async (targetUserId) => {
    try {
        let user = await User.findOne({ where: { id: targetUserId } });
        if (!user) return { EM: "User not found.", EC: 404, DT: "" };

        // CHỐT CHẶN: Không cho phép khóa tài khoản Admin
        if (user.role === 'admin') {
            return { EM: "Safety protection: Cannot lock an Admin account.", EC: 403, DT: "" };
        }

        const newStatus = !user.is_active;
        await user.update({ is_active: newStatus });

        return { 
            EM: `User account has been ${newStatus ? 'unlocked' : 'locked'}.`, 
            EC: 0, 
            DT: { is_active: newStatus } 
        };
    } catch (error) {
        console.log("Error in toggleUserStatusService: ", error);
        return { EM: "Something wrongs in service...", EC: 500, DT: "" };
    }
};

export { changePasswordService, updateProfileService  , getAllUsersService, updateUserRoleService, toggleUserStatusService };