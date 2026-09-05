import { Op } from "sequelize";
import { Order, Reservation, Table, User, sequelize } from "../models/index.js";
import {
  DINNER_SLOTS,
  LUNCH_SLOTS,
  NO_SHOW_GRACE_MINUTES,
  RESERVATION_DURATION_MINUTES,
  RESERVATION_SLOTS,
  addWallClockMinutes,
  getRestaurantWallClockNow,
  getWallClockDateString,
  getWallClockDayBounds,
  isValidDate,
  parseReservationWallClock,
} from "../utils/reservationTime.js";

const ACTIVE_STATUSES = ["pending", "confirmed", "seated"];
const ALL_STATUSES = ["pending", "confirmed", "seated", "completed", "cancelled", "no_show"];
const MANAGED_SCOPES = ["all", "today", "upcoming", "past"];
const ASSIGNED_STATUSES = ["confirmed", "seated"];
const ACTIVE_ORDER_STATUSES = ["pending", "pending_payment", "confirmed", "preparing", "processing", "ready"];
const SEATING_EARLY_MINUTES = 30;
const makeResult = (EC, EM, DT = "") => ({ EC, EM, DT });

const rollbackIfNeeded = async (transaction) => {
  if (transaction && !transaction.finished) await transaction.rollback();
};

const serializeReservation = (reservation) => {
  const value = typeof reservation?.get === "function" ? reservation.get({ plain: true }) : reservation;
  if (!value) return value;
  const now = getRestaurantWallClockNow();
  const reservationTime = new Date(value.reservation_time);
  const seatingOpensAt = addWallClockMinutes(reservationTime, -SEATING_EARLY_MINUTES);
  return {
    ...value,
    can_customer_cancel: ["pending", "confirmed"].includes(value.status) && now < reservationTime,
    can_mark_no_show: value.status === "confirmed" && now >= addWallClockMinutes(reservationTime, NO_SHOW_GRACE_MINUTES),
    can_seat: value.status === "confirmed" && Boolean(value.table_id) && now >= seatingOpensAt,
    seating_opens_at: seatingOpensAt,
  };
};

const getUsableTables = (options = {}) => Table.findAll({
  where: { status: { [Op.in]: ["available", "occupied"] } },
  attributes: ["id", "capacity"],
  order: [["id", "ASC"]],
  ...options,
});

const getReservationsForDate = (date, options = {}) => {
  const bounds = getWallClockDayBounds(date);
  return Reservation.findAll({
    where: {
      reservation_time: { [Op.gte]: bounds.start, [Op.lt]: bounds.end },
      status: { [Op.in]: ACTIVE_STATUSES },
    },
    ...options,
  });
};

const calculateOccupiedSeats = (reservations, startTime) => {
  const endTime = addWallClockMinutes(startTime, RESERVATION_DURATION_MINUTES);
  return reservations.reduce((total, reservation) => {
    const existingStart = new Date(reservation.reservation_time);
    const existingEnd = addWallClockMinutes(existingStart, RESERVATION_DURATION_MINUTES);
    return startTime < existingEnd && endTime > existingStart
      ? total + Number(reservation.number_of_people)
      : total;
  }, 0);
};

const checkAvailabilityService = async (date, partySize) => {
  try {
    const normalizedPartySize = Number(partySize);
    if (!isValidDate(date) || !Number.isInteger(normalizedPartySize) || normalizedPartySize < 1 || normalizedPartySize > 10) {
      return makeResult(400, "Enter a valid date and a party size from 1 to 10.", []);
    }
    const tables = await getUsableTables();
    const totalSeats = tables.reduce((total, table) => total + Number(table.capacity), 0);
    const reservations = await getReservationsForDate(date);
    const now = getRestaurantWallClockNow();
    const slots = RESERVATION_SLOTS.map((time) => {
      const slotTime = parseReservationWallClock(date, time);
      const remainingSeats = totalSeats - calculateOccupiedSeats(reservations, slotTime);
      const isPast = slotTime <= now;
      return {
        time,
        status: isPast ? "unavailable" : remainingSeats >= normalizedPartySize ? "available" : "booked",
        type: LUNCH_SLOTS.includes(time) ? "lunch" : "dinner",
      };
    });
    return makeResult(0, "Available slots retrieved successfully.", slots);
  } catch (error) {
    console.error("Error while checking reservation availability:", error);
    return makeResult(500, "Unable to check reservation availability.", []);
  }
};

const createReservationService = async (userId, bookingData) => {
  const transaction = await sequelize.transaction();
  try {
    const reservationTime = parseReservationWallClock(bookingData.date, bookingData.time);
    if (!reservationTime || reservationTime <= getRestaurantWallClockNow()) {
      await transaction.rollback();
      return makeResult(400, "Choose a valid future reservation slot.");
    }
    const tables = await getUsableTables({ transaction, lock: transaction.LOCK.UPDATE });
    const totalSeats = tables.reduce((total, table) => total + Number(table.capacity), 0);
    if (totalSeats === 0) {
      await transaction.rollback();
      return makeResult(409, "The restaurant has no reservable capacity for this date.");
    }
    const existing = await getReservationsForDate(bookingData.date, { transaction });
    const occupiedSeats = calculateOccupiedSeats(existing, reservationTime);
    if (totalSeats - occupiedSeats < bookingData.partySize) {
      await transaction.rollback();
      return makeResult(409, "This time slot has just become unavailable. Choose another time.");
    }
    const reservation = await Reservation.create({
      user_id: userId,
      table_id: null,
      reservation_time: reservationTime,
      number_of_people: bookingData.partySize,
      contact_name: bookingData.contact_name,
      contact_phone: bookingData.contact_phone,
      note: bookingData.note || null,
      status: "pending",
    }, { transaction });
    await transaction.commit();
    return makeResult(0, "Reservation booked successfully.", serializeReservation(reservation));
  } catch (error) {
    await rollbackIfNeeded(transaction);
    console.error("Error while creating reservation:", error);
    return makeResult(500, "Unable to create the reservation.");
  }
};

const getUserReservationsService = async (userId) => {
  try {
    const reservations = await Reservation.findAll({
      where: { user_id: userId },
      include: [{ model: Table, attributes: ["id", "table_number", "capacity"] }],
      order: [["reservation_time", "DESC"]],
    });
    return makeResult(0, "Reservations retrieved successfully.", reservations.map(serializeReservation));
  } catch (error) {
    console.error("Error while retrieving customer reservations:", error);
    return makeResult(500, "Unable to retrieve reservations.", []);
  }
};

const cancelReservationService = async (userId, reservationId) => {
  const transaction = await sequelize.transaction();
  try {
    const reservation = await Reservation.findOne({ where: { id: reservationId, user_id: userId }, transaction, lock: transaction.LOCK.UPDATE });
    if (!reservation) {
      await transaction.rollback();
      return makeResult(404, "Reservation not found.");
    }
    if (!["pending", "confirmed"].includes(reservation.status)) {
      await transaction.rollback();
      return makeResult(409, `A ${reservation.status} reservation cannot be cancelled.`);
    }
    if (getRestaurantWallClockNow() >= new Date(reservation.reservation_time)) {
      await transaction.rollback();
      return makeResult(409, "This reservation can no longer be cancelled online. Contact the restaurant.");
    }
    await reservation.update({ status: "cancelled" }, { transaction });
    await transaction.commit();
    return makeResult(0, "Reservation cancelled successfully.", serializeReservation(reservation));
  } catch (error) {
    await rollbackIfNeeded(transaction);
    console.error("Error while cancelling customer reservation:", error);
    return makeResult(500, "Unable to cancel the reservation.");
  }
};

const addLowerBound = (range, value) => {
  if (!range[Op.gte] || value > range[Op.gte]) range[Op.gte] = value;
};
const addUpperBound = (range, value) => {
  if (!range[Op.lt] || value < range[Op.lt]) range[Op.lt] = value;
};

const getAllReservationsService = async (options = {}) => {
  try {
    const page = /^\d+$/.test(String(options.page || 1)) ? Number(options.page || 1) : 0;
    const limit = /^\d+$/.test(String(options.limit || 20)) ? Number(options.limit || 20) : 0;
    if (page < 1 || limit < 1 || limit > 100) return makeResult(400, "Invalid reservation pagination.");
    const status = String(options.status || "all").trim().toLowerCase();
    const scope = String(options.scope || "all").trim().toLowerCase();
    if (status !== "all" && !ALL_STATUSES.includes(status)) return makeResult(400, "Invalid reservation status filter.");
    if (!MANAGED_SCOPES.includes(scope)) return makeResult(400, "Invalid reservation scope.");
    const search = String(options.search || "").trim();
    if (search.length > 100) return makeResult(400, "Search must be 100 characters or fewer.");
    const where = {};
    if (status !== "all") where.status = status;
    if (search) where[Op.or] = [{ id: { [Op.like]: `%${search}%` } }, { contact_name: { [Op.like]: `%${search}%` } }, { contact_phone: { [Op.like]: `%${search}%` } }];
    if (options.partySize !== undefined && options.partySize !== "") {
      const partySize = Number(options.partySize);
      if (!Number.isInteger(partySize) || partySize < 1 || partySize > 10) return makeResult(400, "Party size filter must be from 1 to 10.");
      where.number_of_people = partySize;
    }

    const range = {};
    const now = getRestaurantWallClockNow();
    if (scope === "today") {
      const bounds = getWallClockDayBounds(getWallClockDateString(now));
      addLowerBound(range, bounds.start); addUpperBound(range, bounds.end);
    } else if (scope === "upcoming") addLowerBound(range, now);
    else if (scope === "past") addUpperBound(range, now);
    if (options.dateFrom) {
      const bounds = getWallClockDayBounds(options.dateFrom);
      if (!bounds) return makeResult(400, "Date filters must use YYYY-MM-DD.");
      addLowerBound(range, bounds.start);
    }
    if (options.dateTo) {
      const bounds = getWallClockDayBounds(options.dateTo);
      if (!bounds) return makeResult(400, "Date filters must use YYYY-MM-DD.");
      addUpperBound(range, bounds.end);
    }
    if (range[Op.gte] && range[Op.lt] && range[Op.gte] >= range[Op.lt]) return makeResult(400, "Reservation date filters do not overlap.");
    if (Object.getOwnPropertySymbols(range).length) where.reservation_time = range;

    const { count, rows } = await Reservation.findAndCountAll({
      where,
      order: [["reservation_time", scope === "past" ? "DESC" : "ASC"]],
      limit,
      offset: (page - 1) * limit,
      include: [
        { model: User, attributes: ["id", "username", "full_name"] },
        { model: Table, attributes: ["id", "table_number", "capacity", "status"] },
      ],
      distinct: true,
    });
    return makeResult(0, "Reservations retrieved successfully.", { page, limit, totalRows: count, totalPages: Math.ceil(count / limit), reservations: rows.map(serializeReservation) });
  } catch (error) {
    console.error("Error while retrieving managed reservations:", error);
    return makeResult(500, "Unable to retrieve reservations.");
  }
};

const getAssignmentWindow = (reservation) => {
  const start = new Date(reservation.reservation_time);
  return { start, end: addWallClockMinutes(start, RESERVATION_DURATION_MINUTES) };
};

const getOverlapWhere = (reservation, tableIds) => {
  const { start, end } = getAssignmentWindow(reservation);
  return {
    id: { [Op.ne]: reservation.id },
    table_id: { [Op.in]: tableIds },
    status: { [Op.in]: ASSIGNED_STATUSES },
    reservation_time: {
      [Op.lt]: end,
      [Op.gt]: addWallClockMinutes(start, -RESERVATION_DURATION_MINUTES),
    },
  };
};

const getSuitableTablesService = async (reservationId) => {
  try {
    const reservation = await Reservation.findByPk(reservationId);
    if (!reservation) return makeResult(404, "Reservation not found.", []);
    if (reservation.status !== "confirmed") return makeResult(409, "Only confirmed reservations can be assigned a table.", []);

    const tables = await Table.findAll({
      where: {
        capacity: { [Op.gte]: reservation.number_of_people },
        status: { [Op.in]: ["available", "occupied"] },
      },
      attributes: ["id", "table_number", "capacity", "status"],
      order: [["capacity", "ASC"], ["table_number", "ASC"]],
    });
    const tableIds = tables.map((table) => table.id);
    const conflicts = tableIds.length
      ? await Reservation.findAll({
        where: getOverlapWhere(reservation, tableIds),
        attributes: ["id", "table_id", "reservation_time", "status"],
      })
      : [];
    const conflictedTableIds = new Set(conflicts.map((item) => item.table_id));
    const { start, end } = getAssignmentWindow(reservation);
    const suitableTables = tables
      .filter((table) => !conflictedTableIds.has(table.id))
      .map((table) => ({
        ...table.get({ plain: true }),
        physical_status: table.status,
        interval_conflict: false,
        interval_start: start,
        interval_end: end,
        is_current_assignment: table.id === reservation.table_id,
      }));
    return makeResult(0, "Suitable tables retrieved successfully.", suitableTables);
  } catch (error) {
    console.error("Error while retrieving suitable tables:", error);
    return makeResult(500, "Unable to retrieve suitable tables.", []);
  }
};

const assignReservationTableService = async (reservationId, tableId) => {
  const snapshot = await Reservation.findByPk(reservationId, { attributes: ["id", "table_id"] });
  if (!snapshot) return makeResult(404, "Reservation not found.");

  const transaction = await sequelize.transaction();
  try {
    const tableIds = [...new Set([snapshot.table_id, tableId].filter(Boolean))].sort();
    const lockedTables = await Table.findAll({
      where: { id: { [Op.in]: tableIds } },
      order: [["id", "ASC"]],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const candidate = lockedTables.find((table) => table.id === tableId);
    if (!candidate) {
      await transaction.rollback();
      return makeResult(404, "Table not found.");
    }

    const targetSnapshot = await Reservation.findByPk(reservationId, { transaction });
    if (!targetSnapshot) {
      await transaction.rollback();
      return makeResult(404, "Reservation not found.");
    }
    const relevantReservations = await Reservation.findAll({
      where: {
        [Op.or]: [
          { id: reservationId },
          getOverlapWhere(targetSnapshot, [tableId]),
        ],
      },
      order: [["id", "ASC"]],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const reservation = relevantReservations.find((item) => item.id === reservationId);
    if (!reservation || reservation.status !== "confirmed") {
      await transaction.rollback();
      return makeResult(409, "Only confirmed reservations can be assigned a table.");
    }
    if (reservation.table_id && !tableIds.includes(reservation.table_id)) {
      await transaction.rollback();
      return makeResult(409, "The reservation assignment changed. Refresh and try again.");
    }
    if (!["available", "occupied"].includes(candidate.status)) {
      await transaction.rollback();
      return makeResult(409, "This table is not available for reservation assignment.");
    }
    if (Number(candidate.capacity) < Number(reservation.number_of_people)) {
      await transaction.rollback();
      return makeResult(409, "This table is too small for the reservation party.");
    }
    const hasConflict = relevantReservations.some((item) => item.id !== reservation.id && item.table_id === tableId);
    if (hasConflict) {
      await transaction.rollback();
      return makeResult(409, "This table has just been assigned to an overlapping reservation.");
    }

    await reservation.update({ table_id: tableId }, { transaction });
    await transaction.commit();
    const result = await Reservation.findByPk(reservation.id, {
      include: [
        { model: User, attributes: ["id", "username", "full_name", "email", "phone_number"] },
        { model: Table, attributes: ["id", "table_number", "capacity", "status"] },
      ],
    });
    return makeResult(0, "Table assigned successfully.", serializeReservation(result));
  } catch (error) {
    await rollbackIfNeeded(transaction);
    console.error("Error while assigning reservation table:", error);
    return makeResult(500, "Unable to assign the table.");
  }
};

const seatReservationService = async (reservationId) => {
  const snapshot = await Reservation.findByPk(reservationId, { attributes: ["id", "table_id"] });
  if (!snapshot) return makeResult(404, "Reservation not found.");
  if (!snapshot.table_id) return makeResult(409, "Assign a table before seating the guests.");

  const transaction = await sequelize.transaction();
  try {
    const table = await Table.findByPk(snapshot.table_id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!table) {
      await transaction.rollback();
      return makeResult(404, "Assigned table not found.");
    }
    const lockedReservations = await Reservation.findAll({
      where: {
        [Op.or]: [
          { id: reservationId },
          { table_id: snapshot.table_id, status: "seated", id: { [Op.ne]: reservationId } },
        ],
      },
      order: [["id", "ASC"]],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const reservation = lockedReservations.find((item) => item.id === reservationId);
    if (!reservation) {
      await transaction.rollback();
      return makeResult(404, "Reservation not found.");
    }
    if (reservation.table_id !== snapshot.table_id) {
      await transaction.rollback();
      return makeResult(409, "The assigned table changed. Refresh and try again.");
    }
    if (reservation.status !== "confirmed") {
      await transaction.rollback();
      return makeResult(409, `A ${reservation.status} reservation cannot be seated.`);
    }
    if (getRestaurantWallClockNow() < addWallClockMinutes(reservation.reservation_time, -SEATING_EARLY_MINUTES)) {
      await transaction.rollback();
      return makeResult(409, "Guests can be seated from 30 minutes before the reservation time.");
    }
    if (table.status !== "available") {
      await transaction.rollback();
      return makeResult(409, "The assigned table must be available before seating guests.");
    }
    if (Number(table.capacity) < Number(reservation.number_of_people)) {
      await transaction.rollback();
      return makeResult(409, "The assigned table no longer has enough capacity.");
    }
    if (lockedReservations.some((item) => item.id !== reservation.id && item.status === "seated")) {
      await transaction.rollback();
      return makeResult(409, "Another seated reservation is already using this table.");
    }
    const activeOrders = await Order.findAll({
      where: { table_id: table.id, order_status: { [Op.in]: ACTIVE_ORDER_STATUSES } },
      order: [["id", "ASC"]],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (activeOrders.length) {
      await transaction.rollback();
      return makeResult(409, "This table has an active order and cannot seat another party.");
    }

    await reservation.update({ status: "seated" }, { transaction });
    await table.update({ status: "occupied" }, { transaction });
    await transaction.commit();
    const result = await Reservation.findByPk(reservation.id, {
      include: [
        { model: User, attributes: ["id", "username", "full_name", "email", "phone_number"] },
        { model: Table, attributes: ["id", "table_number", "capacity", "status"] },
      ],
    });
    return makeResult(0, "Guests seated successfully.", serializeReservation(result));
  } catch (error) {
    await rollbackIfNeeded(transaction);
    console.error("Error while seating reservation guests:", error);
    return makeResult(500, "Unable to seat the guests.");
  }
};

const getManagedReservationDetailsService = async (reservationId) => {
  try {
    const reservation = await Reservation.findByPk(reservationId, { include: [{ model: User, attributes: ["id", "username", "full_name", "email", "phone_number"] }, { model: Table, attributes: ["id", "table_number", "capacity"] }] });
    return reservation ? makeResult(0, "Reservation retrieved successfully.", serializeReservation(reservation)) : makeResult(404, "Reservation not found.");
  } catch (error) {
    console.error("Error while retrieving reservation details:", error);
    return makeResult(500, "Unable to retrieve the reservation.");
  }
};

const updateReservationStatusService = async (reservationId, newStatus) => {
  const transaction = await sequelize.transaction();
  try {
    if (!["confirmed", "cancelled", "no_show"].includes(newStatus)) {
      await transaction.rollback();
      return makeResult(400, "Unsupported reservation action.");
    }
    const reservation = await Reservation.findByPk(reservationId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!reservation) {
      await transaction.rollback();
      return makeResult(404, "Reservation not found.");
    }
    const allowed = { pending: ["confirmed", "cancelled"], confirmed: ["cancelled", "no_show"] };
    if (!(allowed[reservation.status] || []).includes(newStatus)) {
      await transaction.rollback();
      return makeResult(409, `Cannot change ${reservation.status} to ${newStatus}.`);
    }
    if (newStatus === "no_show" && getRestaurantWallClockNow() < addWallClockMinutes(reservation.reservation_time, NO_SHOW_GRACE_MINUTES)) {
      await transaction.rollback();
      return makeResult(409, "No-show can only be recorded 15 minutes after the reservation time.");
    }
    await reservation.update({ status: newStatus }, { transaction });
    await transaction.commit();
    return makeResult(0, `Reservation ${newStatus.replace("_", " ")} successfully.`, serializeReservation(reservation));
  } catch (error) {
    await rollbackIfNeeded(transaction);
    console.error("Error while updating reservation status:", error);
    return makeResult(500, "Unable to update reservation status.");
  }
};

const expirePendingReservationService = async (reservationId) => {
  const transaction = await sequelize.transaction();
  try {
    const reservation = await Reservation.findByPk(reservationId, { transaction, lock: transaction.LOCK.UPDATE });
    const threshold = addWallClockMinutes(getRestaurantWallClockNow(), -NO_SHOW_GRACE_MINUTES);
    if (!reservation || reservation.status !== "pending" || new Date(reservation.reservation_time) >= threshold) {
      await transaction.rollback();
      return makeResult(0, "Reservation no longer needs expiration.", { expired: false });
    }
    await reservation.update({ status: "cancelled" }, { transaction });
    await transaction.commit();
    return makeResult(0, "Expired reservation cancelled.", { expired: true, reservation: serializeReservation(reservation) });
  } catch (error) {
    await rollbackIfNeeded(transaction);
    console.error("Error while expiring reservation:", error);
    return makeResult(500, "Unable to expire reservation.");
  }
};

export {
  assignReservationTableService,
  cancelReservationService,
  checkAvailabilityService,
  createReservationService,
  expirePendingReservationService,
  getAllReservationsService,
  getManagedReservationDetailsService,
  getSuitableTablesService,
  getUserReservationsService,
  seatReservationService,
  updateReservationStatusService,
};
