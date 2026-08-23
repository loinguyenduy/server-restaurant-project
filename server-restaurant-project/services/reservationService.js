import { Op } from "sequelize";
import { Reservation, Table, User, sequelize } from "../models/index.js";
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
const makeResult = (EC, EM, DT = "") => ({ EC, EM, DT });

const rollbackIfNeeded = async (transaction) => {
  if (transaction && !transaction.finished) await transaction.rollback();
};

const serializeReservation = (reservation) => {
  const value = typeof reservation?.get === "function" ? reservation.get({ plain: true }) : reservation;
  if (!value) return value;
  const now = getRestaurantWallClockNow();
  const reservationTime = new Date(value.reservation_time);
  return {
    ...value,
    can_customer_cancel: ["pending", "confirmed"].includes(value.status) && now < reservationTime,
    can_mark_no_show: value.status === "confirmed" && now >= addWallClockMinutes(reservationTime, NO_SHOW_GRACE_MINUTES),
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
    const reservations = await Reservation.findAll({ where: { user_id: userId }, order: [["reservation_time", "DESC"]] });
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
      include: [{ model: User, attributes: ["id", "username", "full_name"] }],
      distinct: true,
    });
    return makeResult(0, "Reservations retrieved successfully.", { page, limit, totalRows: count, totalPages: Math.ceil(count / limit), reservations: rows.map(serializeReservation) });
  } catch (error) {
    console.error("Error while retrieving managed reservations:", error);
    return makeResult(500, "Unable to retrieve reservations.");
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
  cancelReservationService,
  checkAvailabilityService,
  createReservationService,
  expirePendingReservationService,
  getAllReservationsService,
  getManagedReservationDetailsService,
  getUserReservationsService,
  updateReservationStatusService,
};
