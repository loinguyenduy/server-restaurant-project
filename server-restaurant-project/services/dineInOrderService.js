import { randomUUID } from "node:crypto";
import { Op } from "sequelize";
import {
  Order,
  OrderItem,
  OrderStatusHistory,
  Product,
  Reservation,
  Table,
  sequelize,
} from "../models/index.js";
import {
  RESERVATION_DURATION_MINUTES,
  addWallClockMinutes,
  getRestaurantWallClockNow,
} from "../utils/reservationTime.js";
import { cancelPaymentAttempt, createDineInPaymentLink, makeExistingAttemptSafe } from "./payosService.js";
import { applyStockChange } from "./stockMovementService.js";

const ACTIVE_ORDER_STATUSES = ["pending", "pending_payment", "confirmed", "preparing", "processing", "ready"];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const makeResult = (EC, EM, DT = "") => ({ EC, EM, DT });
const rollbackIfNeeded = async (transaction) => { if (transaction && !transaction.finished) await transaction.rollback(); };
const kitchenStatusForOrder = (status) => status === "ready" ? "ready" : ["preparing", "processing"].includes(status) ? "preparing" : "confirmed";
const aggregateKitchenStatus = (items) => {
  const statuses = items.map((item) => item.kitchen_status).filter(Boolean);
  if (statuses.length === 0) return null;
  if (statuses.every((status) => status === "ready")) return "ready";
  if (statuses.every((status) => status === "confirmed")) return "confirmed";
  return "preparing";
};

const orderInclude = [
  { model: OrderItem, include: [{ model: Product, attributes: ["id", "name", "image_url", "prep_time_minutes"] }] },
  { model: Table, attributes: ["id", "table_number", "capacity", "status"] },
  { model: Reservation, attributes: ["id", "reservation_time", "number_of_people", "contact_name", "status"] },
  { model: OrderStatusHistory, as: "StatusHistory", separate: true, order: [["createdAt", "ASC"]] },
];

const serializeOrder = (order) => {
  if (!order) return order;
  const value = typeof order.get === "function" ? order.get({ plain: true }) : order;
  return {
    ...value,
    total_amount: Number(value.total_amount),
    discount_amount: Number(value.discount_amount || 0),
    shipping_fee: Number(value.shipping_fee || 0),
    tax_price: Number(value.tax_price || 0),
    final_amount: Number(value.final_amount),
  };
};

const loadDineInOrder = async (orderId) => serializeOrder(await Order.findByPk(orderId, { include: orderInclude }));

const normalizeItems = (input) => {
  if (!Array.isArray(input) || input.length === 0) return { error: "Add at least one menu item." };
  const quantities = new Map();
  for (const item of input) {
    const productId = String(item?.product_id || "").trim();
    if (!uuidPattern.test(productId)) return { error: "Every item must have a valid product ID." };
    if (!Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > 100) {
      return { error: "Item quantities must be whole numbers from 1 to 100." };
    }
    const merged = (quantities.get(productId) || 0) + item.quantity;
    if (!Number.isSafeInteger(merged) || merged > 100) return { error: "A merged item quantity cannot exceed 100." };
    quantities.set(productId, merged);
  }
  return { items: [...quantities.entries()].map(([product_id, quantity]) => ({ product_id, quantity })).sort((a, b) => a.product_id.localeCompare(b.product_id)) };
};

const validateAndSnapshotProducts = (products, items) => {
  const productsById = new Map(products.map((product) => [product.id, product]));
  const snapshots = [];
  let subtotal = 0;
  for (const item of items) {
    const product = productsById.get(item.product_id);
    if (!product) return { error: "A selected product no longer exists." };
    if (!product.is_available || Number(product.stock_quantity) <= 0) return { error: `${product.name} is unavailable.` };
    if (Number(product.stock_quantity) < item.quantity) return { error: `Only ${product.stock_quantity} of ${product.name} are available.` };
    const price = Number(product.price);
    if (!Number.isSafeInteger(price) || price <= 0) return { error: `${product.name} does not have a valid VND integer price.` };
    const lineTotal = price * item.quantity;
    if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(subtotal + lineTotal)) return { error: "The order total is too large." };
    subtotal += lineTotal;
    snapshots.push({
      product,
      product_id: product.id,
      product_name: product.name,
      quantity: item.quantity,
      price,
      prep_time_minutes: Number(product.prep_time_minutes) || 15,
    });
  }
  return { snapshots, subtotal };
};

const readyAtForItems = (items, start = new Date()) => {
  const prepMinutes = items.reduce((maximum, item) => Math.max(maximum, Number(item.prep_time_minutes) || 15), 15);
  return new Date(start.getTime() + prepMinutes * 60 * 1000);
};

const productChangesFrom = (snapshots) => snapshots.map(({ product }) => ({
  productId: product.id,
  stock_quantity: product.stock_quantity,
  is_available: product.is_available,
}));

const createDineInOrderService = async (staffId, input = {}) => {
  const normalized = normalizeItems(input.items);
  if (normalized.error) return makeResult(400, normalized.error);
  const tableId = String(input.table_id || "").trim();
  const reservationId = input.reservation_id ? String(input.reservation_id).trim() : null;
  const walkInContactName = String(input.contact_name || "").trim();
  const note = String(input.note || "").trim();
  if (!uuidPattern.test(tableId)) return makeResult(400, "A valid table ID is required.");
  if (reservationId && !uuidPattern.test(reservationId)) return makeResult(400, "A valid reservation ID is required.");
  if (!reservationId && walkInContactName.length > 100) return makeResult(400, "Customer name must be 100 characters or fewer.");
  if (note.length > 500) return makeResult(400, "Order note must be 500 characters or fewer.");

  const transaction = await sequelize.transaction();
  try {
    const table = await Table.findByPk(tableId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!table) { await transaction.rollback(); return makeResult(404, "The selected table no longer exists."); }

    const now = getRestaurantWallClockNow();
    const reservationWindowEnd = addWallClockMinutes(now, RESERVATION_DURATION_MINUTES);
    const reservationWhere = reservationId
      ? { [Op.or]: [{ id: reservationId }, { table_id: tableId, status: "seated", id: { [Op.ne]: reservationId } }] }
      : {
        table_id: tableId,
        [Op.or]: [
          { status: "seated" },
          {
            status: "confirmed",
            reservation_time: {
              [Op.lt]: reservationWindowEnd,
              [Op.gt]: addWallClockMinutes(now, -RESERVATION_DURATION_MINUTES),
            },
          },
        ],
      };
    const reservations = await Reservation.findAll({ where: reservationWhere, order: [["id", "ASC"]], transaction, lock: transaction.LOCK.UPDATE });
    const reservation = reservationId ? reservations.find((item) => item.id === reservationId) : null;

    const activeOrders = await Order.findAll({
      where: { table_id: tableId, order_status: { [Op.in]: ACTIVE_ORDER_STATUSES } },
      order: [["id", "ASC"]],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (activeOrders.length) { await transaction.rollback(); return makeResult(409, "This table already has an active order."); }

    let guestCount;
    let contactName = walkInContactName || null;
    if (reservationId) {
      if (!reservation || reservation.status !== "seated" || reservation.table_id !== table.id) {
        await transaction.rollback();
        return makeResult(409, "The seated reservation no longer matches this table.");
      }
      if (reservations.some((item) => item.id !== reservation.id && item.status === "seated")) {
        await transaction.rollback();
        return makeResult(409, "Another seated reservation is already using this table.");
      }
      if (table.status !== "occupied") {
        await transaction.rollback();
        return makeResult(409, "A seated reservation table must remain occupied.");
      }
      guestCount = Number(reservation.number_of_people);
      const reservationContactName = String(reservation.contact_name || "").trim();
      if (reservationContactName.length > 100) {
        await transaction.rollback();
        return makeResult(409, "The reservation customer name exceeds the supported 100-character limit.");
      }
      // Reservation identity is canonical. Never accept a client-supplied name for this branch.
      contactName = reservationContactName || null;
    } else {
      guestCount = Number(input.guest_count);
      if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > Number(table.capacity)) {
        await transaction.rollback();
        return makeResult(400, `Guest count must be from 1 to ${table.capacity}.`);
      }
      if (table.status !== "available") {
        await transaction.rollback();
        return makeResult(409, "The selected table is no longer available for a walk-in.");
      }
      if (reservations.some((item) => item.status === "seated")) {
        await transaction.rollback();
        return makeResult(409, "This table belongs to a seated reservation. Open that reservation session instead.");
      }
      if (reservations.some((item) => item.status === "confirmed")) {
        await transaction.rollback();
        return makeResult(409, "A confirmed reservation overlaps the next 120 minutes on this table.");
      }
    }

    const productIds = normalized.items.map((item) => item.product_id);
    const products = await Product.findAll({ where: { id: { [Op.in]: productIds } }, order: [["id", "ASC"]], transaction, lock: transaction.LOCK.UPDATE });
    const validated = validateAndSnapshotProducts(products, normalized.items);
    if (validated.error) { await transaction.rollback(); return makeResult(409, validated.error); }
    const tax = Math.round(validated.subtotal * 0.08);
    const order = await Order.create({
      user_id: staffId,
      table_id: table.id,
      reservation_id: reservation?.id || null,
      guest_count: guestCount,
      contact_name: contactName,
      type: "offline",
      fulfillment_type: "dine_in",
      source: "pos",
      total_amount: validated.subtotal,
      discount_amount: 0,
      shipping_fee: 0,
      tax_price: tax,
      final_amount: validated.subtotal + tax,
      payment_method: null,
      payment_status: "pending",
      transaction_id: null,
      order_status: "confirmed",
      note: note || null,
      estimated_ready_at: readyAtForItems(validated.snapshots),
    }, { transaction });
    await OrderItem.bulkCreate(validated.snapshots.map((item) => ({
      order_id: order.id,
      product_id: item.product_id,
      product_name: item.product_name,
      quantity: item.quantity,
      price: item.price,
      prep_time_minutes: item.prep_time_minutes,
      kitchen_batch_id: order.id,
      kitchen_status: "confirmed",
    })), { transaction });
    for (const item of validated.snapshots) {
      await applyStockChange({ product: item.product, quantityChange: -item.quantity, type: "SALE", referenceType: "ORDER", referenceId: order.id, note: "Initial dine-in items sent to kitchen.", actorId: staffId, transaction });
    }
    await OrderStatusHistory.create({
      order_id: order.id,
      from_status: null,
      to_status: "confirmed",
      changed_by: staffId,
      note: reservation ? "Reservation dine-in order sent to kitchen." : "Walk-in dine-in order sent to kitchen.",
    }, { transaction });
    if (table.status !== "occupied") await table.update({ status: "occupied" }, { transaction });
    await transaction.commit();
    return makeResult(0, reservation && input.replacement_order ? "Replacement order sent to kitchen." : "Dine-in order sent to kitchen.", {
      order: await loadDineInOrder(order.id),
      tableChange: { tableId: table.id, status: "occupied", changeType: reservation ? "reservation_order_created" : "walk_in_order_created" },
      productChanges: productChangesFrom(validated.snapshots),
    });
  } catch (error) {
    await rollbackIfNeeded(transaction);
    console.error("Error while creating dine-in order:", error);
    return makeResult(500, "Unable to create the dine-in order.");
  }
};

const addDineInItemsService = async (staffId, orderId, input = {}) => {
  const normalized = normalizeItems(input.items);
  if (normalized.error) return makeResult(400, normalized.error);
  const snapshot = await Order.findByPk(orderId, { attributes: ["id", "table_id", "reservation_id"] });
  if (!snapshot) return makeResult(404, "Order not found.");
  if (!snapshot.table_id) return makeResult(409, "This order is not attached to a valid table session.");

  const transaction = await sequelize.transaction();
  try {
    const table = await Table.findByPk(snapshot.table_id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!table) { await transaction.rollback(); return makeResult(404, "Order table not found."); }
    let reservation = null;
    if (snapshot.reservation_id) {
      reservation = await Reservation.findByPk(snapshot.reservation_id, { transaction, lock: transaction.LOCK.UPDATE });
    }
    const lockedOrders = await Order.findAll({
      where: { [Op.or]: [{ id: orderId }, { table_id: table.id, order_status: { [Op.in]: ACTIVE_ORDER_STATUSES } }] },
      order: [["id", "ASC"]],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const order = lockedOrders.find((item) => item.id === orderId);
    if (!order) { await transaction.rollback(); return makeResult(404, "Order not found."); }
    if (order.table_id !== snapshot.table_id || order.reservation_id !== snapshot.reservation_id) {
      await transaction.rollback();
      return makeResult(409, "The table session changed. Refresh and try again.");
    }
    if (lockedOrders.some((item) => item.id !== order.id && ACTIVE_ORDER_STATUSES.includes(item.order_status))) {
      await transaction.rollback();
      return makeResult(409, "Another active order owns this table session.");
    }
    if (order.fulfillment_type !== "dine_in" || order.source !== "pos" || !["confirmed", "preparing", "ready"].includes(order.order_status)) {
      await transaction.rollback();
      return makeResult(409, "Items can only be added to an active dine-in order before checkout.");
    }
    if (order.payment_method || order.transaction_id || order.payment_status !== "pending") {
      await transaction.rollback();
      return makeResult(409, "Checkout has already started for this order.");
    }
    if (table.status !== "occupied") {
      await transaction.rollback();
      return makeResult(409, "The table session is no longer occupied.");
    }
    if (snapshot.reservation_id && (!reservation || reservation.status !== "seated" || reservation.table_id !== table.id)) {
      await transaction.rollback();
      return makeResult(409, "The seated reservation no longer matches this order.");
    }

    const products = await Product.findAll({ where: { id: { [Op.in]: normalized.items.map((item) => item.product_id) } }, order: [["id", "ASC"]], transaction, lock: transaction.LOCK.UPDATE });
    const validated = validateAndSnapshotProducts(products, normalized.items);
    if (validated.error) { await transaction.rollback(); return makeResult(409, validated.error); }
    const existingItems = await OrderItem.findAll({ where: { order_id: order.id }, order: [["id", "ASC"]], transaction, lock: transaction.LOCK.UPDATE });
    const legacyItems = existingItems.filter((item) => !item.kitchen_batch_id && !item.kitchen_status);
    const partiallyBatchedItems = existingItems.filter((item) => Boolean(item.kitchen_batch_id) !== Boolean(item.kitchen_status));
    const existingBatchStatuses = new Map();
    existingItems.filter((item) => item.kitchen_batch_id).forEach((item) => {
      if (!existingBatchStatuses.has(item.kitchen_batch_id)) existingBatchStatuses.set(item.kitchen_batch_id, new Set());
      existingBatchStatuses.get(item.kitchen_batch_id).add(item.kitchen_status);
    });
    const hasInconsistentBatch = [...existingBatchStatuses.values()].some((statuses) => statuses.size !== 1 || statuses.has(null));
    if (partiallyBatchedItems.length || hasInconsistentBatch || (legacyItems.length > 0 && legacyItems.length !== existingItems.length)) {
      await transaction.rollback();
      return makeResult(409, "Kitchen batch data is inconsistent. Contact an administrator before adding items.");
    }
    if (legacyItems.length) {
      const [normalizedCount] = await OrderItem.update({
        kitchen_batch_id: order.id,
        kitchen_status: kitchenStatusForOrder(order.order_status),
      }, {
        where: { id: { [Op.in]: legacyItems.map((item) => item.id) } },
        transaction,
      });
      if (normalizedCount !== legacyItems.length) throw new Error("Legacy kitchen items were not normalized as one atomic batch.");
      legacyItems.forEach((item) => {
        item.kitchen_batch_id = order.id;
        item.kitchen_status = kitchenStatusForOrder(order.order_status);
      });
    }
    const kitchenBatchId = randomUUID();
    await OrderItem.bulkCreate(validated.snapshots.map((item) => ({
      order_id: order.id,
      product_id: item.product_id,
      product_name: item.product_name,
      quantity: item.quantity,
      price: item.price,
      prep_time_minutes: item.prep_time_minutes,
      kitchen_batch_id: kitchenBatchId,
      kitchen_status: "confirmed",
    })), { transaction });
    for (const item of validated.snapshots) {
      await applyStockChange({ product: item.product, quantityChange: -item.quantity, type: "SALE", referenceType: "ORDER", referenceId: order.id, note: "Additional dine-in items sent to kitchen.", actorId: staffId, transaction });
    }
    const allItems = await OrderItem.findAll({ where: { order_id: order.id }, transaction });
    const subtotal = allItems.reduce((total, item) => total + Number(item.price) * Number(item.quantity), 0);
    const tax = Math.round(subtotal * 0.08);
    if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(tax)) {
      await transaction.rollback();
      return makeResult(409, "The updated order total is too large.");
    }
    const fromStatus = order.order_status;
    const nextReadyAt = readyAtForItems(validated.snapshots);
    const currentReadyAt = order.estimated_ready_at ? new Date(order.estimated_ready_at) : null;
    const updateData = {
      total_amount: subtotal,
      tax_price: tax,
      final_amount: subtotal + tax,
      shipping_fee: 0,
      estimated_ready_at: currentReadyAt && currentReadyAt > nextReadyAt ? currentReadyAt : nextReadyAt,
    };
    const aggregateStatus = aggregateKitchenStatus(allItems);
    if (aggregateStatus && aggregateStatus !== fromStatus) updateData.order_status = aggregateStatus;
    await order.update(updateData, { transaction });
    if (updateData.order_status) {
      await OrderStatusHistory.create({
        order_id: order.id,
        from_status: fromStatus,
        to_status: aggregateStatus,
        changed_by: staffId,
        note: "New kitchen batch added; aggregate order readiness updated.",
      }, { transaction });
    }
    await transaction.commit();
    return makeResult(0, "Additional items sent to kitchen.", {
      order: await loadDineInOrder(order.id),
      kitchenBatchId,
      addedItemCount: validated.snapshots.reduce((total, item) => total + item.quantity, 0),
      statusChanged: Boolean(updateData.order_status),
      productChanges: productChangesFrom(validated.snapshots),
    });
  } catch (error) {
    await rollbackIfNeeded(transaction);
    console.error("Error while adding dine-in items:", error);
    return makeResult(500, "Unable to add items to the order.");
  }
};

const updateKitchenBatchStatusService = async (actorId, orderId, batchId, nextStatus) => {
  const allowedTransitions = { confirmed: "preparing", preparing: "ready" };
  if (!Object.values(allowedTransitions).includes(nextStatus)) return makeResult(400, "Kitchen batch status must be preparing or ready.");
  const transaction = await sequelize.transaction();
  try {
    const order = await Order.findByPk(orderId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!order) { await transaction.rollback(); return makeResult(404, "Order not found."); }
    if (!["confirmed", "preparing", "ready"].includes(order.order_status)) {
      await transaction.rollback();
      return makeResult(409, "Kitchen work can only be updated for an active confirmed order.");
    }

    const batchItems = await OrderItem.findAll({
      where: { order_id: order.id, kitchen_batch_id: batchId },
      order: [["id", "ASC"]],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!batchItems.length) { await transaction.rollback(); return makeResult(404, "Kitchen batch not found for this order."); }
    const currentStatuses = [...new Set(batchItems.map((item) => item.kitchen_status))];
    if (currentStatuses.length !== 1 || !currentStatuses[0]) {
      await transaction.rollback();
      return makeResult(409, "Kitchen batch items do not share one consistent status.");
    }
    const currentStatus = currentStatuses[0];
    if (allowedTransitions[currentStatus] !== nextStatus) {
      await transaction.rollback();
      return makeResult(409, `Cannot change kitchen batch ${currentStatus} to ${nextStatus}.`);
    }

    const [updatedCount] = await OrderItem.update({ kitchen_status: nextStatus }, {
      where: {
        order_id: order.id,
        kitchen_batch_id: batchId,
        id: { [Op.in]: batchItems.map((item) => item.id) },
        kitchen_status: currentStatus,
      },
      transaction,
    });
    if (updatedCount !== batchItems.length) throw new Error("Kitchen batch was not updated atomically.");

    const allItems = await OrderItem.findAll({
      where: { order_id: order.id },
      order: [["id", "ASC"]],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (allItems.some((item) => !item.kitchen_batch_id || !item.kitchen_status)) {
      await transaction.rollback();
      return makeResult(409, "This order has incomplete kitchen batch data.");
    }
    batchItems.forEach((item) => { item.kitchen_status = nextStatus; });
    const nextOrderStatus = aggregateKitchenStatus(allItems);
    const previousOrderStatus = order.order_status;
    const orderStatusChanged = nextOrderStatus !== previousOrderStatus;
    if (orderStatusChanged) {
      await order.update({ order_status: nextOrderStatus }, { transaction });
      await OrderStatusHistory.create({
        order_id: order.id,
        from_status: previousOrderStatus,
        to_status: nextOrderStatus,
        changed_by: actorId,
        note: nextOrderStatus === "ready" ? "All kitchen batches are ready." : "Kitchen batch progress updated aggregate order readiness.",
      }, { transaction });
    }
    await transaction.commit();
    return makeResult(0, nextStatus === "ready" ? "Kitchen batch marked ready." : "Kitchen batch preparation started.", {
      order: await loadDineInOrder(order.id),
      kitchenBatchId: batchId,
      kitchenStatus: nextStatus,
      orderStatusChanged,
    });
  } catch (error) {
    await rollbackIfNeeded(transaction);
    console.error("Error while updating kitchen batch:", error);
    return makeResult(500, "Unable to update the kitchen batch.");
  }
};

const cancelDineInOrderService = async (staffId, orderId) => {
  const snapshot = await Order.findByPk(orderId, { attributes: ["id", "table_id", "reservation_id"] });
  if (!snapshot) return makeResult(404, "Order not found.");
  if (!snapshot.table_id) return makeResult(409, "This dine-in order has no table session.");

  const transaction = await sequelize.transaction();
  try {
    const table = await Table.findByPk(snapshot.table_id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!table) { await transaction.rollback(); return makeResult(404, "Order table not found."); }
    let reservation = null;
    let seatedReservations = [];
    if (snapshot.reservation_id) {
      reservation = await Reservation.findByPk(snapshot.reservation_id, { transaction, lock: transaction.LOCK.UPDATE });
    } else {
      seatedReservations = await Reservation.findAll({ where: { table_id: table.id, status: "seated" }, order: [["id", "ASC"]], transaction, lock: transaction.LOCK.UPDATE });
    }
    const lockedOrders = await Order.findAll({
      where: { [Op.or]: [{ id: orderId }, { table_id: table.id, order_status: { [Op.in]: ACTIVE_ORDER_STATUSES } }] },
      order: [["id", "ASC"]],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const order = lockedOrders.find((item) => item.id === orderId);
    if (!order) { await transaction.rollback(); return makeResult(404, "Order not found."); }
    if (order.fulfillment_type !== "dine_in" || order.source !== "pos") {
      await transaction.rollback();
      return makeResult(409, "This cancellation rule only applies to explicit POS dine-in orders.");
    }
    if (order.order_status !== "confirmed") {
      await transaction.rollback();
      return makeResult(409, "A dine-in order can only be cancelled before preparation starts.");
    }
    const orderItems = await OrderItem.findAll({ where: { order_id: order.id }, transaction });
    const productIds = [...new Set(orderItems.map((item) => item.product_id))].sort();
    const products = await Product.findAll({ where: { id: { [Op.in]: productIds } }, order: [["id", "ASC"]], transaction, lock: transaction.LOCK.UPDATE });
    const restoreByProduct = orderItems.reduce((result, item) => result.set(item.product_id, (result.get(item.product_id) || 0) + Number(item.quantity)), new Map());
    for (const product of products) {
      await applyStockChange({ product, quantityChange: restoreByProduct.get(product.id) || 0, type: "ORDER_CANCELLATION", referenceType: "ORDER", referenceId: order.id, note: "Dine-in order cancelled before preparation.", actorId: staffId, transaction });
    }
    await order.update({ order_status: "cancelled", payment_status: "failed" }, { transaction });
    await OrderStatusHistory.create({
      order_id: order.id,
      from_status: "confirmed",
      to_status: "cancelled",
      changed_by: staffId,
      note: reservation ? "Dine-in order cancelled; seated reservation requires a replacement order." : "Walk-in dine-in order cancelled before preparation.",
    }, { transaction });

    let tableChange = null;
    if (reservation) {
      if (reservation.status !== "seated" || reservation.table_id !== table.id) {
        await transaction.rollback();
        return makeResult(409, "The seated reservation no longer matches this table session.");
      }
      if (table.status !== "occupied") await table.update({ status: "occupied" }, { transaction });
    } else {
      const otherActive = lockedOrders.some((item) => item.id !== order.id && ACTIVE_ORDER_STATUSES.includes(item.order_status));
      if (!otherActive && seatedReservations.length === 0) {
        await table.update({ status: "available" }, { transaction });
        tableChange = { tableId: table.id, status: "available", changeType: "walk_in_order_cancelled" };
      }
    }
    await transaction.commit();
    return makeResult(0, reservation ? "Order cancelled. Create a replacement order for the seated party." : "Walk-in order cancelled and table released.", {
      order: await loadDineInOrder(order.id),
      replacementRequired: Boolean(reservation),
      tableChange,
      productChanges: products.map((product) => ({ productId: product.id, stock_quantity: product.stock_quantity, is_available: product.is_available })),
    });
  } catch (error) {
    await rollbackIfNeeded(transaction);
    console.error("Error while cancelling dine-in order:", error);
    return makeResult(500, "Unable to cancel the dine-in order.");
  }
};

const checkoutDineInOrderService = async (staffId, orderId, paymentMethod) => {
  if (!["cash", "payos"].includes(paymentMethod)) return makeResult(400, "Payment method must be cash or PayOS.");
  const snapshot = await Order.findByPk(orderId, {
    attributes: ["id", "table_id", "reservation_id", "fulfillment_type", "source", "transaction_id", "final_amount", "order_status", "payment_status"],
  });
  if (!snapshot) return makeResult(404, "Order not found.");
  if (snapshot.fulfillment_type !== "dine_in" || snapshot.source !== "pos" || !snapshot.table_id) {
    return makeResult(409, "Checkout Table only supports explicit POS dine-in orders.");
  }
  if (snapshot.order_status !== "ready" || snapshot.payment_status !== "pending") {
    return makeResult(409, "The dine-in order must be ready and unpaid before checkout.");
  }
  const pendingKitchenWork = await OrderItem.count({
    where: {
      order_id: snapshot.id,
      kitchen_batch_id: { [Op.ne]: null },
      kitchen_status: { [Op.ne]: "ready" },
    },
  });
  if (pendingKitchenWork > 0) return makeResult(409, "All kitchen batches must be ready before checkout.");

  let newAttempt = null;
  try {
    const existingAttempt = await makeExistingAttemptSafe(
      snapshot.transaction_id,
      paymentMethod === "cash" ? "Customer switched to cash at the restaurant." : "POS created a replacement payment attempt.",
    );
    if (!existingAttempt.safe) {
      return makeResult(409, `PayOS attempt is ${existingAttempt.status}. Cash or retry is blocked until the provider state is resolved.`);
    }
    if (paymentMethod === "payos") newAttempt = await createDineInPaymentLink(snapshot);
  } catch (error) {
    console.error("Unable to prepare dine-in payment provider state:", error.message);
    return makeResult(409, "PayOS is unavailable, so the existing payment state cannot be changed safely.");
  }

  const transaction = await sequelize.transaction();
  const abortCheckout = async (result) => {
    await rollbackIfNeeded(transaction);
    if (newAttempt?.orderCode) {
      try { await cancelPaymentAttempt(newAttempt.orderCode, "POS state changed before checkout became active."); }
      catch (cancelError) { console.error("Unable to cancel unused PayOS checkout attempt:", cancelError.message); }
    }
    return result;
  };
  try {
    const table = await Table.findByPk(snapshot.table_id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!table) return abortCheckout(makeResult(404, "Order table not found."));
    const reservations = await Reservation.findAll({
      where: snapshot.reservation_id
        ? { [Op.or]: [{ id: snapshot.reservation_id }, { table_id: table.id, status: "seated", id: { [Op.ne]: snapshot.reservation_id } }] }
        : { table_id: table.id, status: "seated" },
      order: [["id", "ASC"]],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const reservation = snapshot.reservation_id ? reservations.find((item) => item.id === snapshot.reservation_id) : null;
    const orders = await Order.findAll({
      where: { [Op.or]: [{ id: orderId }, { table_id: table.id, order_status: { [Op.in]: ACTIVE_ORDER_STATUSES } }] },
      order: [["id", "ASC"]],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const order = orders.find((item) => item.id === orderId);
    if (!order) return abortCheckout(makeResult(404, "Order not found."));
    if (order.table_id !== snapshot.table_id || order.reservation_id !== snapshot.reservation_id || order.transaction_id !== snapshot.transaction_id) {
      return abortCheckout(makeResult(409, "The order or payment state changed. Refresh before trying again."));
    }
    if (order.fulfillment_type !== "dine_in" || order.source !== "pos" || order.order_status !== "ready" || order.payment_status !== "pending") {
      return abortCheckout(makeResult(409, "The dine-in order must be ready and unpaid before checkout."));
    }
    const pendingLockedKitchenWork = await OrderItem.findOne({
      where: {
        order_id: order.id,
        kitchen_batch_id: { [Op.ne]: null },
        kitchen_status: { [Op.ne]: "ready" },
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (pendingLockedKitchenWork) return abortCheckout(makeResult(409, "All kitchen batches must be ready before checkout."));
    if (table.status !== "occupied") {
      return abortCheckout(makeResult(409, "The table session is no longer occupied."));
    }
    if (snapshot.reservation_id && (!reservation || reservation.status !== "seated" || reservation.table_id !== table.id)) {
      return abortCheckout(makeResult(409, "The seated reservation no longer matches this order."));
    }

    if (paymentMethod === "payos") {
      await order.update({ payment_method: "payos", transaction_id: newAttempt.orderCode }, { transaction });
      await transaction.commit();
      return makeResult(0, "PayOS checkout created. The table remains occupied until payment succeeds.", {
        order: await loadDineInOrder(order.id),
        checkoutUrl: newAttempt.checkoutUrl,
        paymentChanged: true,
        tableChange: null,
        reservationChange: null,
      });
    }

    await order.update({ payment_method: "cash", payment_status: "paid", order_status: "completed", transaction_id: null }, { transaction });
    await OrderStatusHistory.create({
      order_id: order.id,
      from_status: "ready",
      to_status: "completed",
      changed_by: staffId,
      note: "Table checked out with cash payment.",
    }, { transaction });
    let reservationChange = null;
    if (reservation) {
      await reservation.update({ status: "completed" }, { transaction });
      reservationChange = { reservationId: reservation.id, status: "completed", userId: reservation.user_id };
    }
    const otherActive = orders.some((item) => item.id !== order.id && ACTIVE_ORDER_STATUSES.includes(item.order_status));
    const otherSeated = reservations.some((item) => item.id !== reservation?.id && item.status === "seated");
    let tableChange = null;
    if (!otherActive && !otherSeated) {
      await table.update({ status: "available" }, { transaction });
      tableChange = { tableId: table.id, status: "available", changeType: "cash_table_checkout" };
    }
    await transaction.commit();
    return makeResult(0, "Cash payment recorded and table checkout completed.", {
      order: await loadDineInOrder(order.id),
      checkoutUrl: null,
      paymentChanged: true,
      tableChange,
      reservationChange,
    });
  } catch (error) {
    await rollbackIfNeeded(transaction);
    if (newAttempt?.orderCode) {
      try { await cancelPaymentAttempt(newAttempt.orderCode, "POS persistence failed before checkout became active."); }
      catch (cancelError) { console.error("Unable to cancel unused PayOS checkout attempt:", cancelError.message); }
    }
    console.error("Error while checking out dine-in table:", error);
    return makeResult(500, "Unable to checkout the table.");
  }
};

const processDineInPayOSWebhookService = async (verifiedData, orderSnapshot) => {
  if (String(verifiedData.code || "") !== "00") {
    return makeResult(0, "Non-success dine-in PayOS webhook acknowledged.", { orderId: orderSnapshot.id, transitioned: false });
  }
  if (Number(verifiedData.amount) !== Number(orderSnapshot.final_amount)) return makeResult(409, "The paid amount does not match the order total.");
  if (!orderSnapshot.table_id) return makeResult(409, "The dine-in order has no table session.");

  const transaction = await sequelize.transaction();
  try {
    const table = await Table.findByPk(orderSnapshot.table_id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!table) { await transaction.rollback(); return makeResult(404, "Order table not found."); }
    const reservations = await Reservation.findAll({
      where: orderSnapshot.reservation_id
        ? { [Op.or]: [{ id: orderSnapshot.reservation_id }, { table_id: table.id, status: "seated", id: { [Op.ne]: orderSnapshot.reservation_id } }] }
        : { table_id: table.id, status: "seated" },
      order: [["id", "ASC"]],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const reservation = orderSnapshot.reservation_id ? reservations.find((item) => item.id === orderSnapshot.reservation_id) : null;
    const orders = await Order.findAll({
      where: { [Op.or]: [{ id: orderSnapshot.id }, { table_id: table.id, order_status: { [Op.in]: ACTIVE_ORDER_STATUSES } }] },
      order: [["id", "ASC"]],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const order = orders.find((item) => item.id === orderSnapshot.id);
    if (!order) { await transaction.rollback(); return makeResult(404, "Order not found."); }
    if (order.payment_status === "paid" && order.order_status === "completed") {
      await transaction.commit();
      return makeResult(0, "Dine-in payment was already processed.", { order: await loadDineInOrder(order.id), transitioned: false });
    }
    if (order.transaction_id !== String(verifiedData.orderCode) || order.payment_method !== "payos") {
      await transaction.rollback();
      return makeResult(409, "The payment transaction does not match this order.");
    }
    if (Number(verifiedData.amount) !== Number(order.final_amount)) {
      await transaction.rollback();
      return makeResult(409, "The paid amount does not match the current order total.");
    }
    if (order.order_status !== "ready" || order.payment_status !== "pending") {
      await transaction.rollback();
      return makeResult(409, "The dine-in order is not ready for payment completion.");
    }
    if (order.reservation_id && (!reservation || reservation.status !== "seated" || reservation.table_id !== table.id)) {
      await transaction.rollback();
      return makeResult(409, "The seated reservation no longer matches this order.");
    }
    await order.update({ payment_status: "paid", order_status: "completed" }, { transaction });
    await OrderStatusHistory.create({
      order_id: order.id,
      from_status: "ready",
      to_status: "completed",
      changed_by: null,
      note: "Table checkout completed by PayOS webhook.",
    }, { transaction });
    let reservationChange = null;
    if (reservation) {
      await reservation.update({ status: "completed" }, { transaction });
      reservationChange = { reservationId: reservation.id, status: "completed", userId: reservation.user_id };
    }
    const otherActive = orders.some((item) => item.id !== order.id && ACTIVE_ORDER_STATUSES.includes(item.order_status));
    const otherSeated = reservations.some((item) => item.id !== reservation?.id && item.status === "seated");
    let tableChange = null;
    if (!otherActive && !otherSeated) {
      await table.update({ status: "available" }, { transaction });
      tableChange = { tableId: table.id, status: "available", changeType: "payos_table_checkout" };
    }
    await transaction.commit();
    return makeResult(0, "Dine-in PayOS payment completed.", {
      order: await loadDineInOrder(order.id),
      transitioned: true,
      tableChange,
      reservationChange,
    });
  } catch (error) {
    await rollbackIfNeeded(transaction);
    throw error;
  }
};

export {
  ACTIVE_ORDER_STATUSES,
  addDineInItemsService,
  cancelDineInOrderService,
  checkoutDineInOrderService,
  createDineInOrderService,
  loadDineInOrder,
  processDineInPayOSWebhookService,
  updateKitchenBatchStatusService,
};
