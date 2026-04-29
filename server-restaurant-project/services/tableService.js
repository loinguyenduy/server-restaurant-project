import { Table } from "../models/index.js";

const getAllTablesService = async () => {
    try {
        const tables = await Table.findAll({
            order: [['table_number', 'ASC']]
        });
        return { EC: 0, EM: "Get all tables successfully", DT: tables };
    } catch (error) {
        console.error("Error in getAllTablesService:", error);
        return { EC: 500, EM: "Internal server error", DT: [] };
    }
};

const createTableService = async (tableData) => {
    try {
        const { table_number, capacity } = tableData;
        
        // Kiểm tra trùng số bàn
        const existingTable = await Table.findOne({ where: { table_number } });
        if (existingTable) {
            return { EC: 409, EM: "Table number already exists", DT: "" };
        }

        const newTable = await Table.create({
            table_number,
            capacity: parseInt(capacity),
            status: "available"
        });

        return { EC: 0, EM: "Create new table successfully", DT: newTable };
    } catch (error) {
        console.error("Error in createTableService:", error);
        return { EC: 500, EM: "Internal server error", DT: "" };
    }
};

const updateTableStatusService = async (tableId, newStatus) => {
    try {
        const validStatuses = ["available", "occupied", "reserved"];
        if (!validStatuses.includes(newStatus)) {
            return { EC: 400, EM: "Invalid table status", DT: "" };
        }

        const table = await Table.findOne({ where: { id: tableId } });
        if (!table) return { EC: 404, EM: "Table not found", DT: "" };

        await table.update({ status: newStatus });
        return { EC: 0, EM: `Table status updated to ${newStatus}`, DT: table };
    } catch (error) {
        console.error("Error in updateTableStatusService:", error);
        return { EC: 500, EM: "Internal server error", DT: "" };
    }
};

const deleteTableService = async (tableId) => {
    try {
        const table = await Table.findOne({ where: { id: tableId } });
        if (!table) return { EC: 404, EM: "Table not found", DT: "" };

        // Lưu ý: Nên check xem bàn này có Order nào đang 'processing' hay không trước khi xóa
        await table.destroy();
        return { EC: 0, EM: "Delete table successfully", DT: "" };
    } catch (error) {
        console.error("Error in deleteTableService:", error);
        return { EC: 500, EM: "Internal server error", DT: "" };
    }
};

export { getAllTablesService, createTableService, updateTableStatusService, deleteTableService };