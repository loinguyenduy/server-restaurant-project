import express from "express";
import { checkUserJWT, checkUserPermission } from "../middleware/jwtAction.js";
import { handleGetAllTables, handleCreateTable, handleUpdateTableStatus, handleDeleteTable } from "../controllers/tableController.js";

const router = express.Router();

router.get("/manage/tables", checkUserJWT, checkUserPermission(["admin", "staff"]), handleGetAllTables);
router.put("/manage/tables/:id/status", checkUserJWT, checkUserPermission(["admin", "staff"]), handleUpdateTableStatus);

router.post("/manage/tables", checkUserJWT, checkUserPermission(["admin"]), handleCreateTable);
router.delete("/manage/tables/:id", checkUserJWT, checkUserPermission(["admin"]), handleDeleteTable);

export default router;