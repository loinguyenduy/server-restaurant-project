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

export { changePasswordService, updateProfileService };