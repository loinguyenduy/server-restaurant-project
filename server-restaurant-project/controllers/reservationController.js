import {
  cancelReservationService,
  checkAvailabilityService,
  createReservationService,
  getAllReservationsService,
  getManagedReservationDetailsService,
  getUserReservationsService,
  updateReservationStatusService,
} from "../services/reservationService.js";
import { emitToOperations, emitToUser } from "../socket/socket.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const phonePattern = /^\+?[0-9\s\-()]{7,20}$/;
const responseStatus = (result, success = 200) => result.EC === 0 ? success : [400, 401, 403, 404, 409].includes(result.EC) ? result.EC : 500;
const sendResult = (res, result, success = 200) => res.status(responseStatus(result, success)).json(result);

const reservationEvent = (reservation) => ({ reservationId: reservation.id, status: reservation.status, changedAt: new Date().toISOString() });

const normalizeBooking = (body = {}) => {
  const partySize = Number(body.partySize);
  const contactName = String(body.contact_name || "").trim();
  const contactPhone = String(body.contact_phone || "").trim();
  const note = String(body.note || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.date || ""))) return { error: "A valid reservation date is required." };
  if (!/^\d{2}:\d{2}$/.test(String(body.time || ""))) return { error: "A valid reservation time is required." };
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 10) return { error: "Party size must be from 1 to 10." };
  if (!contactName || contactName.length > 100) return { error: "Contact name is required and must be 100 characters or fewer." };
  if (!phonePattern.test(contactPhone)) return { error: "Enter a valid contact phone number." };
  if (note.length > 500) return { error: "Reservation note must be 500 characters or fewer." };
  return { data: { date: body.date, time: body.time, partySize, contact_name: contactName, contact_phone: contactPhone, note: note || null } };
};

const handleCheckAvailability = async (req, res) => {
  try {
    return sendResult(res, await checkAvailabilityService(String(req.query.date || ""), Number(req.query.partySize)));
  } catch (error) {
    console.error("Error in reservation availability controller:", error);
    return res.status(500).json({ EC: 500, EM: "Server error.", DT: [] });
  }
};

const handleCreateReservation = async (req, res) => {
  try {
    const normalized = normalizeBooking(req.body);
    if (normalized.error) return res.status(400).json({ EC: 400, EM: normalized.error, DT: "" });
    const result = await createReservationService(req.user.id, normalized.data);
    if (result.EC === 0) emitToOperations("reservation:new", { reservationId: result.DT.id, createdAt: new Date().toISOString() });
    return sendResult(res, result, 201);
  } catch (error) {
    console.error("Error in create reservation controller:", error);
    return res.status(500).json({ EC: 500, EM: "Server error.", DT: "" });
  }
};

const handleGetUserReservations = async (req, res) => {
  try { return sendResult(res, await getUserReservationsService(req.user.id)); }
  catch (error) { console.error("Error in customer reservations controller:", error); return res.status(500).json({ EC: 500, EM: "Server error.", DT: [] }); }
};

const handleCancelReservation = async (req, res) => {
  try {
    if (!uuidPattern.test(req.params.id || "")) return res.status(400).json({ EC: 400, EM: "A valid reservation ID is required.", DT: "" });
    const result = await cancelReservationService(req.user.id, req.params.id);
    if (result.EC === 0) {
      const payload = reservationEvent(result.DT);
      emitToUser(result.DT.user_id, "reservation:status_changed", payload);
      emitToOperations("reservation:status_changed", payload);
    }
    return sendResult(res, result);
  } catch (error) {
    console.error("Error in cancel reservation controller:", error);
    return res.status(500).json({ EC: 500, EM: "Server error.", DT: "" });
  }
};

const handleGetAllReservations = async (req, res) => {
  try { return sendResult(res, await getAllReservationsService(req.query)); }
  catch (error) { console.error("Error in managed reservations controller:", error); return res.status(500).json({ EC: 500, EM: "Server error.", DT: "" }); }
};

const handleGetManagedReservationDetails = async (req, res) => {
  try {
    if (!uuidPattern.test(req.params.id || "")) return res.status(400).json({ EC: 400, EM: "A valid reservation ID is required.", DT: "" });
    return sendResult(res, await getManagedReservationDetailsService(req.params.id));
  } catch (error) {
    console.error("Error in reservation detail controller:", error);
    return res.status(500).json({ EC: 500, EM: "Server error.", DT: "" });
  }
};

const handleUpdateReservationStatus = async (req, res) => {
  try {
    if (!uuidPattern.test(req.params.id || "")) return res.status(400).json({ EC: 400, EM: "A valid reservation ID is required.", DT: "" });
    const status = String(req.body?.status || "").trim().toLowerCase();
    const result = await updateReservationStatusService(req.params.id, status);
    if (result.EC === 0) {
      const payload = reservationEvent(result.DT);
      emitToUser(result.DT.user_id, "reservation:status_changed", payload);
      emitToOperations("reservation:status_changed", payload);
    }
    return sendResult(res, result);
  } catch (error) {
    console.error("Error in update reservation controller:", error);
    return res.status(500).json({ EC: 500, EM: "Server error.", DT: "" });
  }
};

export {
  handleCancelReservation,
  handleCheckAvailability,
  handleCreateReservation,
  handleGetAllReservations,
  handleGetManagedReservationDetails,
  handleGetUserReservations,
  handleUpdateReservationStatus,
};
