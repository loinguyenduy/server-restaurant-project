import { changePasswordService, updateProfileService } from "../services/userService.js";

const handleChangePassword = async (req, res) => {
    try {
        // Lấy ID người dùng từ Token (được gán bởi middleware checkUserJWT)
        const userId = req.user.id; 
        const { oldPassword, newPassword } = req.body;

        // Bắt lỗi thiếu trường dữ liệu
        if (!oldPassword || !newPassword) {
            return res.status(400).json({
                EC: 1,
                EM: "Missing required parameters.",
                DT: ""
            });
        }

        // Bắt lỗi mật khẩu quá ngắn
        if (newPassword.length < 6) {
            return res.status(400).json({
                EC: 1,
                EM: "New password must be at least 6 characters long.",
                DT: ""
            });
        }

        const result = await changePasswordService(userId, oldPassword, newPassword);
        return res.status(200).json(result);

    } catch (error) {
        console.log(">>> Error in handleChangePassword controller: ", error);
        return res.status(500).json({
            EC: -1,
            EM: "Server error",
            DT: ""
        });
    }
};

const handleUpdateProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const updateData = req.body;

        // Bắt lỗi không gửi gì lên
        if (!updateData || Object.keys(updateData).length === 0) {
            return res.status(400).json({
                EC: 1,
                EM: "No data provided to update.",
                DT: ""
            });
        }

        const result = await updateProfileService(userId, updateData);
        return res.status(200).json(result);

    } catch (error) {
        console.log(">>> Error in handleUpdateProfile controller: ", error);
        return res.status(500).json({
            EC: -1,
            EM: "Server error",
            DT: ""
        });
    }
};

export { handleChangePassword, handleUpdateProfile };