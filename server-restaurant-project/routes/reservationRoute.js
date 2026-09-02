import express from "express";
import { 
    handleCheckAvailability, handleCreateReservation, handleGetUserReservations, handleCancelReservation,
    handleAssignReservationTable, handleGetAllReservations, handleGetManagedReservationDetails,
    handleGetSuitableTables, handleSeatReservation, handleUpdateReservationStatus
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
router.get("/manage/reservations/:id/suitable-tables", checkUserJWT, checkUserPermission(["admin", "staff"]), handleGetSuitableTables);
router.put("/manage/reservations/:id/table", checkUserJWT, checkUserPermission(["admin", "staff"]), handleAssignReservationTable);
router.post("/manage/reservations/:id/seat", checkUserJWT, checkUserPermission(["admin", "staff"]), handleSeatReservation);
router.put("/manage/reservations/:id/status", checkUserJWT, checkUserPermission(["admin", "staff"]), handleUpdateReservationStatus);

export default router;
