import { Op } from "sequelize";
import { Order, Reservation, Table, sequelize } from "../models/index.js";

const ACTIVE_ORDER_STATUSES = ["pending", "pending_payment", "confirmed", "preparing", "processing", "ready"];
const makeResult = (EC, EM, DT = "") => ({ EC, EM, DT });
const rollbackIfNeeded = async (transaction) => { if (transaction && !transaction.finished) await transaction.rollback(); };

const serializeTable = (table) => {
  const value = table.get({ plain: true });
  const activeOrders = value.Orders || [];
  delete value.Orders;
  return { ...value, active_order: activeOrders[0] || null };
};

const getAllTablesService = async () => {
  try {
    const tables = await Table.findAll({
      order: [["table_number", "ASC"], [Order, "createdAt", "DESC"]],
      include: [{ model: Order, where: { order_status: { [Op.in]: ACTIVE_ORDER_STATUSES } }, required: false, attributes: ["id", "order_status", "payment_status", "source", "createdAt"] }],
    });
    return makeResult(0, "Tables retrieved successfully.", tables.map(serializeTable));
  } catch (error) {
    console.error("Error while retrieving tables:", error);
    return makeResult(500, "Unable to retrieve tables.", []);
  }
};

const createTableService = async (tableData) => {
  try {
    const existing = await Table.findOne({ where: { table_number: tableData.table_number } });
    if (existing) return makeResult(409, "Table number already exists.");
    const table = await Table.create({ table_number: tableData.table_number, capacity: tableData.capacity, status: "available" });
    return makeResult(0, "Table created successfully.", serializeTable(table));
  } catch (error) {
    if (error?.name === "SequelizeUniqueConstraintError") {
      return makeResult(409, "Table number already exists.");
    }
    console.error("Error while creating table:", error);
    return makeResult(500, "Unable to create the table.");
  }
};

const updateTableService = async (tableId, tableData) => {
  const transaction = await sequelize.transaction();
  try {
    const table = await Table.findByPk(tableId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!table) { await transaction.rollback(); return makeResult(404, "Table not found."); }
    const duplicate = await Table.findOne({ where: { table_number: tableData.table_number, id: { [Op.ne]: tableId } }, transaction });
    if (duplicate) { await transaction.rollback(); return makeResult(409, "Table number already exists."); }
    await table.update({ table_number: tableData.table_number, capacity: tableData.capacity }, { transaction });
    await transaction.commit();
    return makeResult(0, "Table updated successfully.", table.get({ plain: true }));
  } catch (error) {
    await rollbackIfNeeded(transaction);
    if (error?.name === "SequelizeUniqueConstraintError") {
      return makeResult(409, "Table number already exists.");
    }
    console.error("Error while updating table:", error);
    return makeResult(500, "Unable to update the table.");
  }
};

const updateTableStatusService = async (tableId, newStatus, actor) => {
  const transaction = await sequelize.transaction();
  try {
    if (!["available", "occupied", "out_of_service"].includes(newStatus)) {
      await transaction.rollback();
      return makeResult(400, "Unsupported table status.");
    }
    const table = await Table.findByPk(tableId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!table) { await transaction.rollback(); return makeResult(404, "Table not found."); }
    const activeOrder = await Order.findOne({ where: { table_id: tableId, order_status: { [Op.in]: ACTIVE_ORDER_STATUSES } }, order: [["createdAt", "DESC"]], transaction });
    const isAdmin = actor?.role === "admin";

    if (activeOrder) {
      if (newStatus !== "occupied") {
        await transaction.rollback();
        return makeResult(409, "This table has an active order and must remain occupied.");
      }
      if (!isAdmin) {
        await transaction.rollback();
        return makeResult(403, "Occupied status is managed automatically by POS.");
      }
    } else if (newStatus === "occupied") {
      await transaction.rollback();
      return makeResult(409, "Cannot mark a table occupied without an active order.");
    }

    if (table.status === "reserved" && !isAdmin) {
      await transaction.rollback();
      return makeResult(403, "Only an administrator can resolve a legacy reserved table.");
    }
    if (table.status === "occupied" && !activeOrder && !isAdmin) {
      await transaction.rollback();
      return makeResult(403, "Only an administrator can resolve an orphan occupied table.");
    }
    if (table.status === newStatus) {
      await transaction.commit();
      return makeResult(0, "Table status is already current.", table.get({ plain: true }));
    }
    await table.update({ status: newStatus }, { transaction });
    await transaction.commit();
    return makeResult(0, `Table marked ${newStatus.replaceAll("_", " ")}.`, table.get({ plain: true }));
  } catch (error) {
    await rollbackIfNeeded(transaction);
    console.error("Error while updating table status:", error);
    return makeResult(500, "Unable to update table status.");
  }
};

const deleteTableService = async (tableId) => {
  const transaction = await sequelize.transaction();
  try {
    const table = await Table.findByPk(tableId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!table) { await transaction.rollback(); return makeResult(404, "Table not found."); }
    const orderReferences = await Order.count({ where: { table_id: tableId }, transaction });
    const reservationReferences = await Reservation.count({ where: { table_id: tableId }, transaction });
    if (orderReferences || reservationReferences) {
      await transaction.rollback();
      return makeResult(409, "This table is referenced by restaurant history. Mark it out of service instead.");
    }
    if (table.status === "occupied") {
      await transaction.rollback();
      return makeResult(409, "Resolve the occupied table status before deleting it.");
    }
    await table.destroy({ transaction });
    await transaction.commit();
    return makeResult(0, "Table deleted successfully.", { id: tableId });
  } catch (error) {
    await rollbackIfNeeded(transaction);
    console.error("Error while deleting table:", error);
    return makeResult(500, "Unable to delete the table.");
  }
};

export { createTableService, deleteTableService, getAllTablesService, updateTableService, updateTableStatusService };
