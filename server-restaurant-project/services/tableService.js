import { Op } from "sequelize";
import { Order, Reservation, Table, sequelize } from "../models/index.js";
import { RESERVATION_DURATION_MINUTES, addWallClockMinutes, getRestaurantWallClockNow } from "../utils/reservationTime.js";

const ACTIVE_ORDER_STATUSES = ["pending", "pending_payment", "confirmed", "preparing", "processing", "ready"];
const makeResult = (EC, EM, DT = "") => ({ EC, EM, DT });
const rollbackIfNeeded = async (transaction) => { if (transaction && !transaction.finished) await transaction.rollback(); };

const serializeTable = (table) => {
  const value = table.get({ plain: true });
  const activeOrders = value.Orders || [];
  const seatedReservations = value.Reservations || [];
  delete value.Orders;
  delete value.Reservations;
  return { ...value, active_order: activeOrders[0] || null, seated_reservation: seatedReservations[0] || null };
};

const getAllTablesService = async () => {
  try {
    const tables = await Table.findAll({
      order: [["table_number", "ASC"], [Order, "createdAt", "DESC"]],
      include: [
        { model: Order, where: { order_status: { [Op.in]: ACTIVE_ORDER_STATUSES } }, required: false, attributes: ["id", "order_status", "payment_status", "source", "createdAt"] },
        { model: Reservation, where: { status: "seated" }, required: false, attributes: ["id", "reservation_time", "number_of_people", "contact_name", "status"] },
      ],
    });
    return makeResult(0, "Tables retrieved successfully.", tables.map(serializeTable));
  } catch (error) {
    console.error("Error while retrieving tables:", error);
    return makeResult(500, "Unable to retrieve tables.", []);
  }
};

const getPosTablesService = async () => {
  try {
    const tables = await Table.findAll({ order: [["table_number", "ASC"]] });
    const tableIds = tables.map((table) => table.id);
    if (tableIds.length === 0) return makeResult(0, "POS tables retrieved successfully.", []);
    const now = getRestaurantWallClockNow();
    const windowEnd = addWallClockMinutes(now, RESERVATION_DURATION_MINUTES);
    const [activeOrders, seatedReservations, confirmedReservations, cancelledReservationOrders] = await Promise.all([
      Order.findAll({
        where: { table_id: { [Op.in]: tableIds }, order_status: { [Op.in]: ACTIVE_ORDER_STATUSES } },
        attributes: ["id", "table_id", "reservation_id", "guest_count", "contact_name", "order_status", "payment_status", "payment_method", "transaction_id", "source", "createdAt"],
        order: [["createdAt", "DESC"]],
      }),
      Reservation.findAll({
        where: { table_id: { [Op.in]: tableIds }, status: "seated" },
        attributes: ["id", "table_id", "reservation_time", "number_of_people", "contact_name", "status"],
        order: [["reservation_time", "ASC"]],
      }),
      Reservation.findAll({
        where: { table_id: { [Op.in]: tableIds }, status: "confirmed", reservation_time: { [Op.gt]: addWallClockMinutes(now, -RESERVATION_DURATION_MINUTES) } },
        attributes: ["id", "table_id", "reservation_time", "number_of_people", "contact_name", "status"],
        order: [["reservation_time", "ASC"]],
      }),
      Order.findAll({
        where: { table_id: { [Op.in]: tableIds }, reservation_id: { [Op.ne]: null }, fulfillment_type: "dine_in", source: "pos", order_status: "cancelled" },
        attributes: ["id", "table_id", "reservation_id", "createdAt"],
        order: [["createdAt", "DESC"]],
      }),
    ]);

    return makeResult(0, "POS tables retrieved successfully.", tables.map((table) => {
      const value = table.get({ plain: true });
      const activeOrder = activeOrders.find((order) => order.table_id === table.id) || null;
      const seatedReservation = seatedReservations.find((reservation) => reservation.table_id === table.id) || null;
      const tableConfirmed = confirmedReservations.filter((reservation) => reservation.table_id === table.id);
      const upcomingReservation = tableConfirmed.find((reservation) => new Date(reservation.reservation_time) >= now) || null;
      const walkInConflict = tableConfirmed.some((reservation) => {
        const start = new Date(reservation.reservation_time);
        const end = addWallClockMinutes(start, RESERVATION_DURATION_MINUTES);
        return start < windowEnd && end > now;
      });
      const hasCancelledSessionOrder = seatedReservation && cancelledReservationOrders.some((order) => order.reservation_id === seatedReservation.id);
      const issues = [];
      if (["out_of_service", "reserved"].includes(table.status)) issues.push("Table is not in service.");
      if (table.status === "occupied" && !activeOrder && !seatedReservation) issues.push("Occupied status has no active table session.");
      if (walkInConflict) issues.push("A confirmed reservation overlaps the next 120 minutes.");
      return {
        ...value,
        active_order: activeOrder ? activeOrder.get({ plain: true }) : null,
        seated_reservation: seatedReservation ? seatedReservation.get({ plain: true }) : null,
        upcoming_reservation: upcomingReservation ? upcomingReservation.get({ plain: true }) : null,
        session_state: seatedReservation && !activeOrder ? (hasCancelledSessionOrder ? "replacement_required" : "waiting_for_order") : null,
        can_start_walk_in: table.status === "available" && !activeOrder && !seatedReservation && !walkInConflict,
        can_start_reservation_order: table.status === "occupied" && Boolean(seatedReservation) && !activeOrder,
        issues,
      };
    }));
  } catch (error) {
    console.error("Error while retrieving POS tables:", error);
    return makeResult(500, "Unable to retrieve POS tables.", []);
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
    const seatedReservations = await Reservation.findAll({ where: { table_id: tableId, status: "seated" }, order: [["id", "ASC"]], transaction, lock: transaction.LOCK.UPDATE });
    const activeOrders = await Order.findAll({ where: { table_id: tableId, order_status: { [Op.in]: ACTIVE_ORDER_STATUSES } }, order: [["id", "ASC"]], transaction, lock: transaction.LOCK.UPDATE });
    const activeOrder = activeOrders[0];
    const seatedReservation = seatedReservations[0];
    const isAdmin = actor?.role === "admin";

    if (activeOrder || seatedReservation) {
      if (newStatus !== "occupied") {
        await transaction.rollback();
        return makeResult(409, seatedReservation ? "This table has a seated reservation and must remain occupied." : "This table has an active order and must remain occupied.");
      }
      if (!isAdmin) {
        await transaction.rollback();
        return makeResult(403, "Occupied status is managed automatically by the active table session.");
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

export { createTableService, deleteTableService, getAllTablesService, getPosTablesService, updateTableService, updateTableStatusService };
