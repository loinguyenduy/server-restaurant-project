import express from "express";
import { checkUserJWT, checkUserPermission } from "../middleware/jwtAction.js";
import { handleGetAllTables, handleGetPosTables, handleCreateTable, handleUpdateTable, handleUpdateTableStatus, handleDeleteTable } from "../controllers/tableController.js";

const router = express.Router();

router.get("/manage/tables", checkUserJWT, checkUserPermission(["admin", "staff"]), handleGetAllTables);
router.get("/manage/pos/tables", checkUserJWT, checkUserPermission(["admin", "staff"]), handleGetPosTables);
router.put("/manage/tables/:id/status", checkUserJWT, checkUserPermission(["admin", "staff"]), handleUpdateTableStatus);

router.post("/manage/tables", checkUserJWT, checkUserPermission(["admin"]), handleCreateTable);
router.put("/manage/tables/:id", checkUserJWT, checkUserPermission(["admin"]), handleUpdateTable);
router.delete("/manage/tables/:id", checkUserJWT, checkUserPermission(["admin"]), handleDeleteTable);

export default router;
