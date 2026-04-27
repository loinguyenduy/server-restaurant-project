import {
  checkAvailabilityService,
  createReservationService,
  getUserReservationsService,
  cancelReservationService,
} from "../services/reservationService.js";

const handleCheckAvailability = async (req, res) => {
  try {
    const { date, partySize } = req.query;

    if (!date || !partySize) {
      return res.status(400).json({
        EC: 1,
        EM: "Missing required parameters (date, partySize)",
        DT: "",
      });
    }

    const result = await checkAvailabilityService(date, parseInt(partySize));
    return res.status(200).json({
      EC: result.EC,
      EM: result.EM,
      DT: result.DT,
    });
  } catch (error) {
    console.error(">>> Error in handleCheckAvailability:", error);
    return res.status(500).json({
      EC: -1,
      EM: "Server error",
      DT: "",
    });
  }
};

const handleCreateReservation = async (req, res) => {
  try {
    const userId = req.user.id; // Lấy từ middleware checkUserJWT
    const { date, time, partySize, contact_name, contact_phone } = req.body;

    // Validate dữ liệu đầu vào
    if (!date || !time || !partySize || !contact_name || !contact_phone) {
      return res.status(400).json({
        EC: 1,
        EM: "Missing required booking details",
        DT: "",
      });
    }

    const result = await createReservationService(userId, req.body);
    return res.status(200).json(result);
  } catch (error) {
    console.error(">>> Error in handleCreateReservation:", error);
    return res.status(500).json({
      EC: -1,
      EM: "Server error",
      DT: "",
    });
  }
};

const handleGetUserReservations = async (req, res) => {
    try {
        const userId = req.user.id;
        const result = await getUserReservationsService(userId);
        return res.status(200).json(result);
    } catch (error) {
        console.error(">>> Error in handleGetUserReservations:", error);
        return res.status(500).json({ EC: -1, EM: "Server error", DT: "" });
    }
};

const handleCancelReservation = async (req, res) => {
    try {
        const userId = req.user.id;
        const reservationId = req.params.id; // Lấy ID từ URL params

        if (!reservationId) {
            return res.status(400).json({ EC: 1, EM: "Missing reservation ID", DT: "" });
        }

        const result = await cancelReservationService(userId, reservationId);
        return res.status(200).json(result);
    } catch (error) {
        console.error(">>> Error in handleCancelReservation:", error);
        return res.status(500).json({ EC: -1, EM: "Server error", DT: "" });
    }
};

export {
  handleCheckAvailability,
  handleCreateReservation,
  handleGetUserReservations,
  handleCancelReservation
};
