import { StockMovement } from "../models/index.js";

const MOVEMENT_TYPES = ["RESTOCK", "SALE", "ORDER_CANCELLATION", "MANUAL_ADJUSTMENT"];
const REFERENCE_TYPES = ["ORDER", "PRODUCT"];

const applyStockChange = async ({
  product,
  quantityChange,
  type,
  referenceType,
  referenceId,
  note = null,
  actorId = null,
  transaction,
}) => {
  if (!transaction) throw new Error("A database transaction is required for stock changes.");
  if (!product?.id) throw new Error("A locked Product instance is required for stock changes.");
  if (!Number.isInteger(quantityChange) || quantityChange === 0) throw new Error("Stock change must be a non-zero integer.");
  if (!MOVEMENT_TYPES.includes(type)) throw new Error("Invalid stock movement type.");
  if (!REFERENCE_TYPES.includes(referenceType) || !referenceId) throw new Error("A valid stock movement reference is required.");

  const stockBefore = Number(product.stock_quantity);
  const stockAfter = stockBefore + quantityChange;
  if (!Number.isInteger(stockBefore) || stockBefore < 0 || !Number.isInteger(stockAfter) || stockAfter < 0) {
    throw new Error("Stock cannot become negative or invalid.");
  }

  await product.update({ stock_quantity: stockAfter }, { transaction });
  const movement = await StockMovement.create({
    product_id: product.id,
    type,
    quantity_change: quantityChange,
    stock_before: stockBefore,
    stock_after: stockAfter,
    reference_type: referenceType,
    reference_id: referenceId,
    note: note ? String(note).trim().slice(0, 500) : null,
    created_by: actorId || null,
  }, { transaction });

  return { movement, stockBefore, stockAfter };
};

export { MOVEMENT_TYPES, applyStockChange };
