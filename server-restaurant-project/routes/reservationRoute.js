import express from "express";
import { 
    handleCheckAvailability, 
    handleCreateReservation,
    handleGetUserReservations,
    handleCancelReservation
} from "../controllers/reservationController.js";
import { checkUserJWT } from "../middleware/jwtAction.js";

const router = express.Router();
//route to check available slots 
router.get("/reservations/available-slots", handleCheckAvailability);
//protected route to create reservation
router.post("/reservations/book", checkUserJWT, handleCreateReservation);
//protected route to get user's reservations
router.get("/reservations/my-reservations", checkUserJWT, handleGetUserReservations);
//protected route to cancel reservation
router.put("/reservations/cancel/:id", checkUserJWT, handleCancelReservation);


export default router;