import { adjustProductStockService, getInventoryService, getStockMovementsService, restockProductService } from "../services/inventoryService.js";
import { emitProductAvailability } from "../socket/socket.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statusFor = (result) => result.EC === 0 ? 200 : [400, 404, 409].includes(result.EC) ? result.EC : 500;
const parseAvailability = (value) => value === true || value === "true";
const emitInventoryProduct = (result) => {
  if (result.EC !== 0) return;
  const product = result.DT.product;
  emitProductAvailability({ productId: product.id, stock_quantity: product.stock_quantity, is_available: product.is_available });
};

const handleGetInventory = async (req, res) => {
  const result = await getInventoryService(req.query);
  return res.status(statusFor(result)).json(result);
};

const handleRestockProduct = async (req, res) => {
  if (!uuidPattern.test(req.params.productId || "")) return res.status(400).json({ EC: 400, EM: "A valid product ID is required.", DT: "" });
  const quantity = Number(req.body?.quantity);
  const note = String(req.body?.note || "").trim();
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 100000) return res.status(400).json({ EC: 400, EM: "Restock quantity must be a positive integer.", DT: "" });
  if (note.length > 500) return res.status(400).json({ EC: 400, EM: "Note must be 500 characters or fewer.", DT: "" });
  const result = await restockProductService(req.params.productId, { quantity, note, make_available: parseAvailability(req.body?.make_available) }, req.user.id);
  emitInventoryProduct(result);
  return res.status(statusFor(result)).json(result);
};

const handleAdjustProductStock = async (req, res) => {
  if (!uuidPattern.test(req.params.productId || "")) return res.status(400).json({ EC: 400, EM: "A valid product ID is required.", DT: "" });
  const quantityChange = Number(req.body?.quantity_change);
  const note = String(req.body?.note || "").trim();
  if (!Number.isInteger(quantityChange) || quantityChange === 0 || Math.abs(quantityChange) > 100000) return res.status(400).json({ EC: 400, EM: "Adjustment must be a non-zero integer.", DT: "" });
  if (!note || note.length > 500) return res.status(400).json({ EC: 400, EM: "A note of 500 characters or fewer is required.", DT: "" });
  const result = await adjustProductStockService(req.params.productId, { quantity_change: quantityChange, note, make_available: parseAvailability(req.body?.make_available) }, req.user.id);
  emitInventoryProduct(result);
  return res.status(statusFor(result)).json(result);
};

const handleGetStockMovements = async (req, res) => {
  if (!uuidPattern.test(req.params.productId || "")) return res.status(400).json({ EC: 400, EM: "A valid product ID is required.", DT: "" });
  const result = await getStockMovementsService(req.params.productId, req.query);
  return res.status(statusFor(result)).json(result);
};

export { handleAdjustProductStock, handleGetInventory, handleGetStockMovements, handleRestockProduct };
