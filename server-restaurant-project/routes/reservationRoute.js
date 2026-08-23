import express from "express";
import { 
    handleCheckAvailability, handleCreateReservation, handleGetUserReservations, handleCancelReservation,
    handleGetAllReservations, handleGetManagedReservationDetails, handleUpdateReservationStatus
} from "../controllers/reservationController.js";
import { checkUserJWT, checkUserPermission } from "../middleware/jwtAction.js";

const router = express.Router();

// Route của Customer
router.get("/reservations/available-slots", handleCheckAvailability);
const customerOnly = checkUserPermission(["customer"]);
router.post("/reservations/book", checkUserJWT, customerOnly, handleCreateReservation);
router.get("/reservations/my-reservations", checkUserJWT, customerOnly, handleGetUserReservations);
router.put("/reservations/cancel/:id", checkUserJWT, customerOnly, handleCancelReservation);

// Route của Admin & Staff
router.get("/manage/reservations", checkUserJWT, checkUserPermission(["admin", "staff"]), handleGetAllReservations);
router.get("/manage/reservations/:id", checkUserJWT, checkUserPermission(["admin", "staff"]), handleGetManagedReservationDetails);
router.put("/manage/reservations/:id/status", checkUserJWT, checkUserPermission(["admin", "staff"]), handleUpdateReservationStatus);

export default router;
