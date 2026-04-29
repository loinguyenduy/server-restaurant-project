import { getAllTablesService, createTableService, updateTableStatusService, deleteTableService } from "../services/tableService.js";

const handleGetAllTables = async (req, res) => {
    try {
        let data = await getAllTablesService();
        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({ EM: "Server Error", EC: 500, DT: "" });
    }
};

const handleCreateTable = async (req, res) => {
    try {
        const { table_number, capacity } = req.body;
        if (!table_number || !capacity) {
            return res.status(400).json({ EM: "Missing table number or capacity", EC: 400, DT: "" });
        }
        let data = await createTableService(req.body);
        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({ EM: "Server Error", EC: 500, DT: "" });
    }
};

const handleUpdateTableStatus = async (req, res) => {
    try {
        const { status } = req.body;
        let data = await updateTableStatusService(req.params.id, status);
        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({ EM: "Server Error", EC: 500, DT: "" });
    }
};

const handleDeleteTable = async (req, res) => {
    try {
        let data = await deleteTableService(req.params.id);
        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({ EM: "Server Error", EC: 500, DT: "" });
    }
};

export { handleGetAllTables, handleCreateTable, handleUpdateTableStatus, handleDeleteTable };