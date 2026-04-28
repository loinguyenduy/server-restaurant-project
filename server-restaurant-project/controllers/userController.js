import { 
    getAllUsersService, 
    updateUserRoleService, 
    toggleUserStatusService 
} from "../services/userService.js";

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

const handleGetAllUsers = async (req, res) => {
    try {
        const options = {
            search: req.query.search,
            role: req.query.role,
            page: req.query.page || 1,
            limit: req.query.limit || 10
        };
        let data = await getAllUsersService(options);
        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({ EM: "Server error", EC: 500, DT: "" });
    }
};

const handleUpdateUserRole = async (req, res) => {
    try {
        const adminId = req.user.id; // Lấy từ Token của người đang thao tác
        const targetUserId = req.params.id;
        const { role } = req.body;

        if (adminId === targetUserId) {
            return res.status(403).json({ EM: "You cannot change your own role.", EC: 403, DT: "" });
        }

        let data = await updateUserRoleService(targetUserId, role);
        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({ EM: "Server error", EC: 500, DT: "" });
    }
};

const handleToggleUserStatus = async (req, res) => {
    try {
        const adminId = req.user.id;
        const targetUserId = req.params.id;

        if (adminId === targetUserId) {
            return res.status(403).json({ EM: "You cannot lock your own account.", EC: 403, DT: "" });
        }

        let data = await toggleUserStatusService(targetUserId);
        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({ EM: "Server error", EC: 500, DT: "" });
    }
};

export { 
    handleChangePassword, handleUpdateProfile, 
    handleGetAllUsers, handleUpdateUserRole, handleToggleUserStatus 
};