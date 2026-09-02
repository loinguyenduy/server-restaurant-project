import { createTableService, deleteTableService, getAllTablesService, getPosTablesService, updateTableService, updateTableStatusService } from "../services/tableService.js";
import { emitToOperations } from "../socket/socket.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const responseStatus = (result, success = 200) => result.EC === 0 ? success : [400, 401, 403, 404, 409].includes(result.EC) ? result.EC : 500;
const send = (res, result, success = 200) => res.status(responseStatus(result, success)).json(result);
const emitTableChange = (tableId, status, changeType) => emitToOperations("table:status_changed", { tableId, status, changeType, changedAt: new Date().toISOString() });

const normalizeTable = (body = {}) => {
  const tableNumber = String(body.table_number || "").trim();
  const capacity = Number(body.capacity);
  if (!tableNumber || tableNumber.length > 20) return { error: "Table number is required and must be 20 characters or fewer." };
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 50) return { error: "Capacity must be a whole number from 1 to 50." };
  return { data: { table_number: tableNumber, capacity } };
};

const handleGetAllTables = async (req, res) => {
  try { return send(res, await getAllTablesService()); }
  catch (error) { console.error("Error in table list controller:", error); return res.status(500).json({ EC: 500, EM: "Server error.", DT: [] }); }
};

const handleGetPosTables = async (req, res) => {
  try { return send(res, await getPosTablesService()); }
  catch (error) { console.error("Error in POS table overview controller:", error); return res.status(500).json({ EC: 500, EM: "Server error.", DT: [] }); }
};

const handleCreateTable = async (req, res) => {
  try {
    const normalized = normalizeTable(req.body);
    if (normalized.error) return res.status(400).json({ EC: 400, EM: normalized.error, DT: "" });
    const result = await createTableService(normalized.data);
    if (result.EC === 0) emitTableChange(result.DT.id, result.DT.status, "created");
    return send(res, result, 201);
  } catch (error) { console.error("Error in create table controller:", error); return res.status(500).json({ EC: 500, EM: "Server error.", DT: "" }); }
};

const handleUpdateTable = async (req, res) => {
  try {
    if (!uuidPattern.test(req.params.id || "")) return res.status(400).json({ EC: 400, EM: "A valid table ID is required.", DT: "" });
    const normalized = normalizeTable(req.body);
    if (normalized.error) return res.status(400).json({ EC: 400, EM: normalized.error, DT: "" });
    const result = await updateTableService(req.params.id, normalized.data);
    if (result.EC === 0) emitTableChange(result.DT.id, result.DT.status, "updated");
    return send(res, result);
  } catch (error) { console.error("Error in update table controller:", error); return res.status(500).json({ EC: 500, EM: "Server error.", DT: "" }); }
};

const handleUpdateTableStatus = async (req, res) => {
  try {
    if (!uuidPattern.test(req.params.id || "")) return res.status(400).json({ EC: 400, EM: "A valid table ID is required.", DT: "" });
    const status = String(req.body?.status || "").trim().toLowerCase();
    const result = await updateTableStatusService(req.params.id, status, req.user);
    if (result.EC === 0) emitTableChange(result.DT.id, result.DT.status, "status_changed");
    return send(res, result);
  } catch (error) { console.error("Error in table status controller:", error); return res.status(500).json({ EC: 500, EM: "Server error.", DT: "" }); }
};

const handleDeleteTable = async (req, res) => {
  try {
    if (!uuidPattern.test(req.params.id || "")) return res.status(400).json({ EC: 400, EM: "A valid table ID is required.", DT: "" });
    const result = await deleteTableService(req.params.id);
    if (result.EC === 0) emitTableChange(req.params.id, null, "deleted");
    return send(res, result);
  } catch (error) { console.error("Error in delete table controller:", error); return res.status(500).json({ EC: 500, EM: "Server error.", DT: "" }); }
};

export { handleCreateTable, handleDeleteTable, handleGetAllTables, handleGetPosTables, handleUpdateTable, handleUpdateTableStatus };
