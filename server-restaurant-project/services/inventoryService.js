import { Op } from "sequelize";
import { Category, Product, StockMovement, User, sequelize } from "../models/index.js";
import { MOVEMENT_TYPES, applyStockChange } from "./stockMovementService.js";

const makeResult = (EC, EM, DT = "") => ({ EC, EM, DT });
const getLowStockThreshold = () => {
  const configured = Number.parseInt(process.env.LOW_STOCK_THRESHOLD, 10);
  return Number.isInteger(configured) && configured >= 1 && configured <= 100 ? configured : 5;
};
const parsePage = (value, fallback, max) => {
  if (value === undefined || value === "") return fallback;
  return /^\d+$/.test(String(value)) && Number(value) >= 1 && Number(value) <= max ? Number(value) : null;
};

const serializeProduct = (product, threshold = getLowStockThreshold()) => {
  const value = product.get ? product.get({ plain: true }) : product;
  const stock = Number(value.stock_quantity);
  return {
    ...value,
    stock_quantity: stock,
    effective_available: Boolean(value.is_available) && stock > 0,
    inventory_status: stock === 0 ? "sold_out" : stock <= threshold ? "low_stock" : "in_stock",
  };
};

const getInventoryService = async (options = {}) => {
  try {
    const page = parsePage(options.page, 1, 100000);
    const limit = parsePage(options.limit, 20, 100);
    if (!page || !limit) return makeResult(400, "Invalid inventory pagination.");
    const status = String(options.status || "all").trim().toLowerCase();
    if (!["all", "low_stock", "sold_out"].includes(status)) return makeResult(400, "Invalid inventory status filter.");
    const search = String(options.search || "").trim();
    if (search.length > 100) return makeResult(400, "Search must be 100 characters or fewer.");

    const threshold = getLowStockThreshold();
    const where = {};
    if (search) where.name = { [Op.like]: `%${search}%` };
    if (status === "sold_out") where.stock_quantity = 0;
    if (status === "low_stock") where.stock_quantity = { [Op.between]: [1, threshold] };

    const { count, rows } = await Product.findAndCountAll({
      where,
      include: [{ model: Category, attributes: ["id", "name"] }],
      order: [["stock_quantity", "ASC"], ["name", "ASC"]],
      limit,
      offset: (page - 1) * limit,
    });
    return makeResult(0, "Inventory retrieved successfully.", {
      products: rows.map((item) => serializeProduct(item, threshold)),
      threshold,
      page,
      limit,
      totalRows: count,
      totalPages: Math.ceil(count / limit),
    });
  } catch (error) {
    console.error("Error while retrieving inventory:", error);
    return makeResult(500, "Unable to retrieve inventory.");
  }
};

const changeInventoryStock = async ({ productId, quantityChange, type, note, makeAvailable, actorId }) => {
  const transaction = await sequelize.transaction();
  try {
    const product = await Product.findByPk(productId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!product) { await transaction.rollback(); return makeResult(404, "Product not found."); }
    const { movement } = await applyStockChange({
      product,
      quantityChange,
      type,
      referenceType: "PRODUCT",
      referenceId: product.id,
      note,
      actorId,
      transaction,
    });
    if (makeAvailable === true && !product.is_available) {
      await product.update({ is_available: true }, { transaction });
    }
    await transaction.commit();
    return makeResult(0, "Inventory updated successfully.", {
      product: serializeProduct(product),
      movement,
    });
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    if (String(error.message).includes("negative")) return makeResult(409, "Stock cannot become negative.");
    console.error("Error while updating inventory:", error);
    return makeResult(500, "Unable to update inventory.");
  }
};

const restockProductService = (productId, input, actorId) => changeInventoryStock({
  productId,
  quantityChange: input.quantity,
  type: "RESTOCK",
  note: input.note || "Product restocked.",
  makeAvailable: input.make_available,
  actorId,
});

const adjustProductStockService = (productId, input, actorId) => changeInventoryStock({
  productId,
  quantityChange: input.quantity_change,
  type: "MANUAL_ADJUSTMENT",
  note: input.note,
  makeAvailable: input.make_available,
  actorId,
});

const getStockMovementsService = async (productId, options = {}) => {
  try {
    const page = parsePage(options.page, 1, 100000);
    const limit = parsePage(options.limit, 20, 100);
    if (!page || !limit) return makeResult(400, "Invalid movement pagination.");
    const type = String(options.type || "all").trim().toUpperCase();
    if (type !== "ALL" && !MOVEMENT_TYPES.includes(type)) return makeResult(400, "Invalid movement type filter.");
    const product = await Product.findByPk(productId, { attributes: ["id", "name", "stock_quantity", "is_available"] });
    if (!product) return makeResult(404, "Product not found.");
    const where = { product_id: productId };
    if (type !== "ALL") where.type = type;
    const { count, rows } = await StockMovement.findAndCountAll({
      where,
      include: [{ model: User, as: "Actor", attributes: ["id", "full_name", "role"] }],
      order: [["createdAt", "DESC"]],
      limit,
      offset: (page - 1) * limit,
    });
    return makeResult(0, "Stock movements retrieved successfully.", {
      product: serializeProduct(product),
      movements: rows,
      page,
      limit,
      totalRows: count,
      totalPages: Math.ceil(count / limit),
    });
  } catch (error) {
    console.error("Error while retrieving stock movements:", error);
    return makeResult(500, "Unable to retrieve stock movements.");
  }
};

export { adjustProductStockService, getInventoryService, getLowStockThreshold, getStockMovementsService, restockProductService };
