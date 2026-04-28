import express from "express";
import { 
    handleCheckAvailability, handleCreateReservation, handleGetUserReservations, handleCancelReservation,
    handleGetAllReservations, handleUpdateReservationStatus
} from "../controllers/reservationController.js";
import { checkUserJWT, checkUserPermission } from "../middleware/jwtAction.js";

const router = express.Router();

// Route của Customer
router.get("/reservations/available-slots", handleCheckAvailability);
router.post("/reservations/book", checkUserJWT, handleCreateReservation);
router.get("/reservations/my-reservations", checkUserJWT, handleGetUserReservations);
router.put("/reservations/cancel/:id", checkUserJWT, handleCancelReservation);

// Route của Admin & Staff
router.get("/manage/reservations", checkUserJWT, checkUserPermission(["admin", "staff"]), handleGetAllReservations);
router.put("/manage/reservations/:id/status", checkUserJWT, checkUserPermission(["admin", "staff"]), handleUpdateReservationStatus);

export default router;