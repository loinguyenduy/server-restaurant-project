import { Op } from "sequelize";
import payOSInstance from "../config/payosConfig.js";
import {
  Cart,
  CartItem,
  Order,
  OrderItem,
  OrderStatusHistory,
  Product,
  Reservation,
  Review,
  Table,
  User,
} from "../models/index.js";
import { sequelize } from "../config/databaseConfig.js";
import { getCartData } from "./cartService.js";
import { cancelDineInOrderService, processDineInPayOSWebhookService } from "./dineInOrderService.js";
import { applyStockChange } from "./stockMovementService.js";

const ORDER_ITEM_INCLUDE = {
  model: OrderItem,
  include: [{
    model: Product,
    attributes: ["id", "name", "image_url", "prep_time_minutes"],
  }],
};

const ORDER_DETAIL_INCLUDE = [
  ORDER_ITEM_INCLUDE,
  { model: Table, attributes: ["table_number"] },
  { model: Reservation, attributes: ["id", "reservation_time", "number_of_people", "contact_name", "status"] },
  {
    model: OrderStatusHistory,
    as: "StatusHistory",
    separate: true,
    order: [["createdAt", "ASC"]],
  },
];

const OWN_REVIEW_ATTRIBUTES = ["id", "rating", "comment", "status", "createdAt", "updatedAt"];

const getCustomerOrderInclude = (userId, includeHistory = false) => [
  ORDER_ITEM_INCLUDE,
  ...(includeHistory ? [
    { model: Table, attributes: ["table_number"] },
    { model: Reservation, attributes: ["id", "reservation_time", "number_of_people", "contact_name", "status"] },
    {
      model: OrderStatusHistory,
      as: "StatusHistory",
      separate: true,
      order: [["createdAt", "ASC"]],
    },
  ] : [
    { model: Reservation, attributes: ["id", "reservation_time", "number_of_people", "contact_name", "status"] },
  ]),
  { model: Review, attributes: OWN_REVIEW_ATTRIBUTES, where: { user_id: userId }, required: false },
];

const getCustomerOrderOwnershipWhere = (userId) => ({
  [Op.or]: [
    // Order.user_id is the customer owner for direct web orders, but the POS operator for POS orders.
    { user_id: userId },
    {
      "$Reservation.user_id$": userId,
      reservation_id: { [Op.ne]: null },
      fulfillment_type: "dine_in",
      source: "pos",
      order_status: "completed",
    },
  ],
});

const LEGACY_PENDING_STATUSES = ["pending", "pending_payment"];
const ORDER_STATUSES = ["pending", "processing", "pending_payment", "confirmed", "preparing", "ready", "completed", "cancelled"];
const PAYMENT_STATUSES = ["pending", "paid", "failed", "refunded"];
const PAYMENT_METHODS = ["cash", "payos", "card", "legacy_unknown"];
const FULFILLMENT_TYPES = ["takeaway", "dine_in", "legacy"];
const TABLE_ACTIVE_ORDER_STATUSES = ["pending", "pending_payment", "confirmed", "preparing", "processing", "ready"];
const makeResult = (EC, EM, DT = "") => ({ EC, EM, DT });

const parsePositiveInteger = (value, fallback, maximum = 100) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (!/^\d+$/.test(String(value))) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : null;
};

const parseDateBoundary = (value, useNextDay = false) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const boundary = new Date(`${value}T00:00:00+07:00`);
  if (Number.isNaN(boundary.getTime())) return null;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  if (formatter.format(boundary) !== value) return null;
  if (useNextDay) boundary.setUTCDate(boundary.getUTCDate() + 1);
  return boundary;
};

const rollbackIfNeeded = async (transaction) => {
  if (transaction && !transaction.finished) await transaction.rollback();
};

const createPayOSOrderCode = () => {
  const code = (Date.now() * 100) + Math.floor(Math.random() * 100);
  if (!Number.isSafeInteger(code)) throw new Error("Unable to create a safe PayOS order code.");
  return code;
};

const appendOrderId = (urlValue, orderId, fallbackPath) => {
  const clientUrl = String(process.env.CLIENT_URL || "http://localhost:3000")
    .split(",")[0]
    .trim()
    .replace(/\/$/, "");
  const url = new URL(String(urlValue || `${clientUrl}${fallbackPath}`).trim());
  url.searchParams.set("orderId", orderId);
  return url.toString();
};

const buildPayOSRequest = (order, orderCode) => {
  const amount = Number(order.final_amount);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("Order total must be a positive VND integer before PayOS payment.");
  }
  return {
    orderCode,
    amount,
    description: `Royal ${orderCode}`.slice(0, 25),
    returnUrl: appendOrderId(process.env.PAYOS_RETURN_URL, order.id, "/payment-success"),
    cancelUrl: appendOrderId(process.env.PAYOS_CANCEL_URL, order.id, "/payment-cancel"),
  };
};

const createPayOSLink = async (order, orderCode) => {
  const response = await payOSInstance.paymentRequests.create(buildPayOSRequest(order, orderCode));
  return response.checkoutUrl;
};

const calculateReadyAt = (items, confirmedAt = new Date()) => {
  const prepMinutes = items.reduce((maximum, item) => {
    const value = Number(item.prep_time_minutes ?? item.Product?.prep_time_minutes ?? 15);
    return Number.isInteger(value) && value >= 1 && value <= 180
      ? Math.max(maximum, value)
      : maximum;
  }, 15);
  return new Date(confirmedAt.getTime() + prepMinutes * 60 * 1000);
};

const serializeOrder = (order) => {
  if (!order) return order;
  const plain = typeof order.get === "function" ? order.get({ plain: true }) : { ...order };
  const ownReview = plain.Review;
  delete plain.Review;
  return {
    ...plain,
    ...(ownReview !== undefined ? { review: ownReview || null } : {}),
    total_amount: Number(plain.total_amount),
    discount_amount: Number(plain.discount_amount || 0),
    shipping_fee: Number(plain.shipping_fee || 0),
    tax_price: Number(plain.tax_price || 0),
    final_amount: Number(plain.final_amount),
    requires_manual_refund:
      plain.order_status === "cancelled" &&
      plain.payment_status === "paid" &&
      plain.payment_method === "payos",
  };
};

const loadOrderDetails = async (orderId, where = {}) => {
  const order = await Order.findOne({
    where: { id: orderId, ...where },
    include: ORDER_DETAIL_INCLUDE,
  });
  return serializeOrder(order);
};

const loadManagedOrderDetails = async (orderId) => {
  const order = await Order.findByPk(orderId, {
    include: [
      ORDER_ITEM_INCLUDE,
      { model: Table, attributes: ["id", "table_number", "capacity"] },
      { model: Reservation, attributes: ["id", "reservation_time", "number_of_people", "contact_name", "status"] },
      { model: User, attributes: ["id", "username", "full_name", "email", "phone_number"] },
      {
        model: OrderStatusHistory,
        as: "StatusHistory",
        separate: true,
        order: [["createdAt", "ASC"]],
        include: [{ model: User, as: "ChangedBy", attributes: ["id", "full_name", "role"] }],
      },
    ],
  });
  return serializeOrder(order);
};

const createOrderAndPaymentService = async (userId, checkoutData) => {
  const transaction = await sequelize.transaction();
  try {
    const method = checkoutData.payment_method;
    const cart = await Cart.findOne({
      where: { user_id: userId },
      include: [{ model: CartItem }],
      transaction,
    });
    const cartItems = cart?.CartItems || [];
    if (cartItems.length === 0) {
      await transaction.rollback();
      return makeResult(409, "Your cart is empty.");
    }

    const productIds = [...new Set(cartItems.map((item) => item.product_id))].sort();
    const products = await Product.findAll({
      where: { id: { [Op.in]: productIds } },
      order: [["id", "ASC"]],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const productsById = new Map(products.map((product) => [product.id, product]));
    let subtotal = 0;
    const orderItems = [];

    for (const cartItem of cartItems) {
      const product = productsById.get(cartItem.product_id);
      if (!product) {
        await transaction.rollback();
        return makeResult(409, "A dish in your cart no longer exists. Refresh your cart and try again.");
      }
      if (!product.is_available || product.stock_quantity <= 0) {
        await transaction.rollback();
        return makeResult(409, `${product.name} is currently unavailable.`);
      }
      if (!Number.isSafeInteger(cartItem.quantity) || cartItem.quantity <= 0) {
        await transaction.rollback();
        return makeResult(409, `The quantity for ${product.name} is invalid.`);
      }
      if (product.stock_quantity < cartItem.quantity) {
        await transaction.rollback();
        return makeResult(409, `Only ${product.stock_quantity} of ${product.name} are available.`);
      }
      const unitPrice = Number(product.price);
      if (!Number.isSafeInteger(unitPrice) || unitPrice <= 0) {
        await transaction.rollback();
        return makeResult(409, `${product.name} does not have a valid VND integer price. Please contact the restaurant.`);
      }
      const lineTotal = unitPrice * cartItem.quantity;
      if (!Number.isSafeInteger(lineTotal)) {
        await transaction.rollback();
        return makeResult(409, "The order total is too large.");
      }
      subtotal += lineTotal;
      orderItems.push({
        product_id: product.id,
        product_name: product.name,
        quantity: cartItem.quantity,
        price: unitPrice,
        prep_time_minutes: Number(product.prep_time_minutes) || 15,
        Product: product,
      });
    }

    if (!Number.isSafeInteger(subtotal) || subtotal <= 0) {
      await transaction.rollback();
      return makeResult(409, "The order total is invalid.");
    }
    const taxAmount = Math.round(subtotal * 0.08);
    const finalAmount = subtotal + taxAmount;
    const initialStatus = method === "cash" ? "confirmed" : "pending_payment";
    const payOSOrderCode = method === "payos" ? createPayOSOrderCode() : null;
    const estimatedReadyAt = method === "cash" ? calculateReadyAt(orderItems) : null;

    const newOrder = await Order.create({
      user_id: userId,
      type: "online",
      fulfillment_type: "takeaway",
      source: "customer_web",
      contact_name: checkoutData.contact_name,
      total_amount: subtotal,
      discount_amount: 0,
      shipping_fee: 0,
      tax_price: taxAmount,
      final_amount: finalAmount,
      payment_method: method,
      payment_status: "pending",
      transaction_id: payOSOrderCode ? String(payOSOrderCode) : null,
      address: null,
      phone_receiver: checkoutData.phone_receiver,
      note: checkoutData.note || null,
      order_status: initialStatus,
      estimated_ready_at: estimatedReadyAt,
    }, { transaction });

    await OrderItem.bulkCreate(orderItems.map((item) => ({
      order_id: newOrder.id,
      product_id: item.product_id,
      product_name: item.product_name,
      quantity: item.quantity,
      price: item.price,
      prep_time_minutes: item.prep_time_minutes,
    })), { transaction });
    for (const item of orderItems) {
      await applyStockChange({
        product: item.Product,
        quantityChange: -item.quantity,
        type: "SALE",
        referenceType: "ORDER",
        referenceId: newOrder.id,
        note: "Customer takeaway order created.",
        actorId: userId,
        transaction,
      });
    }
    await OrderStatusHistory.create({
      order_id: newOrder.id,
      from_status: null,
      to_status: initialStatus,
      changed_by: userId,
      note: method === "cash" ? "Cash takeaway order created." : "PayOS payment started.",
    }, { transaction });
    await CartItem.destroy({
      where: { id: { [Op.in]: cartItems.map((item) => item.id) } },
      transaction,
    });
    await transaction.commit();

    let checkoutUrl = null;
    let paymentLinkAvailable = method === "cash";
    if (method === "payos") {
      try {
        checkoutUrl = await createPayOSLink(newOrder, payOSOrderCode);
        paymentLinkAvailable = true;
      } catch (error) {
        console.error("Unable to create the PayOS link for the new order:", error.message);
      }
    }
    return makeResult(0, paymentLinkAvailable
      ? "Order created successfully."
      : "Order created, but the payment link is temporarily unavailable.", {
      order: await loadOrderDetails(newOrder.id),
      cart: await getCartData(userId),
      checkoutUrl,
      paymentLinkAvailable,
      productChanges: orderItems.map((item) => ({
        productId: item.Product.id,
        stock_quantity: item.Product.stock_quantity,
        is_available: item.Product.is_available,
      })),
    });
  } catch (error) {
    await rollbackIfNeeded(transaction);
    console.error("Error while creating an order:", error);
    return makeResult(500, "Unable to create the order.");
  }
};

const getUserOrdersService = async (userId) => {
  try {
    const orders = await Order.findAll({
      where: getCustomerOrderOwnershipWhere(userId),
      order: [["createdAt", "DESC"]],
      include: getCustomerOrderInclude(userId),
    });
    return makeResult(0, "Orders retrieved successfully.", orders.map(serializeOrder));
  } catch (error) {
    console.error("Error while retrieving customer orders:", error);
    return makeResult(500, "Unable to retrieve your orders.");
  }
};

const getUserOrderDetailsService = async (userId, orderId) => {
  try {
    const order = serializeOrder(await Order.findOne({
      where: { id: orderId, ...getCustomerOrderOwnershipWhere(userId) },
      include: getCustomerOrderInclude(userId, true),
    }));
    return order ? makeResult(0, "Order retrieved successfully.", order) : makeResult(404, "Order not found.");
  } catch (error) {
    console.error("Error while retrieving customer order details:", error);
    return makeResult(500, "Unable to retrieve the order.");
  }
};

const reCreatePaymentLinkService = async (userId, orderId) => {
  try {
    const order = await Order.findOne({ where: { id: orderId, user_id: userId } });
    if (!order) return makeResult(404, "Order not found.");
    if (order.payment_method !== "payos") return makeResult(409, "Cash orders do not need a payment link.");
    if (order.payment_status !== "pending" || !LEGACY_PENDING_STATUSES.includes(order.order_status)) {
      return makeResult(409, "This order is no longer waiting for PayOS payment.");
    }
    const orderCode = createPayOSOrderCode();
    const checkoutUrl = await createPayOSLink(order, orderCode);
    await order.update({ transaction_id: String(orderCode) });
    return makeResult(0, "Payment link created successfully.", { orderId: order.id, checkoutUrl });
  } catch (error) {
    console.error("Error while recreating a PayOS payment link:", error);
    return makeResult(500, "Unable to create a new payment link.");
  }
};

const processPayOSWebhookService = async (verifiedData) => {
  const orderCode = String(verifiedData.orderCode || "");
  const order = await Order.findOne({ where: { transaction_id: orderCode } });
  if (!order && String(verifiedData.code || "") !== "00") {
    return makeResult(0, "Non-success PayOS webhook acknowledged.", { orderId: null, transitioned: false });
  }
  if (!order) return makeResult(404, "Order not found for this payment.");
  if (order.fulfillment_type === "dine_in" && order.source === "pos") {
    return processDineInPayOSWebhookService(verifiedData, order);
  }
  if (order.payment_method !== "payos") return makeResult(409, "The payment method does not match this order.");
  if (Number(verifiedData.amount) !== Number(order.final_amount)) {
    return makeResult(409, "The paid amount does not match the order total.");
  }
  if (verifiedData.code !== "00") {
    return makeResult(0, "Non-success PayOS webhook acknowledged.", { orderId: order.id, transitioned: false });
  }

  const transaction = await sequelize.transaction();
  try {
    const lockedOrder = await Order.findByPk(order.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (lockedOrder.payment_status === "paid") {
      await transaction.commit();
      return makeResult(0, "Payment was already processed.", { order: serializeOrder(lockedOrder), transitioned: false });
    }
    if (lockedOrder.order_status === "cancelled") {
      await lockedOrder.update({ payment_status: "paid" }, { transaction });
      await transaction.commit();
      return makeResult(0, "Late payment recorded for manual refund.", {
        order: serializeOrder(lockedOrder), transitioned: false, requires_manual_refund: true,
      });
    }
    if (!LEGACY_PENDING_STATUSES.includes(lockedOrder.order_status)) {
      await transaction.rollback();
      return makeResult(409, "The order is not waiting for payment.");
    }
    const items = await OrderItem.findAll({ where: { order_id: lockedOrder.id }, transaction });
    const fromStatus = lockedOrder.order_status;
    await lockedOrder.update({
      payment_status: "paid",
      order_status: "confirmed",
      estimated_ready_at: calculateReadyAt(items),
    }, { transaction });
    await OrderStatusHistory.create({
      order_id: lockedOrder.id,
      from_status: fromStatus,
      to_status: "confirmed",
      changed_by: null,
      note: "PayOS payment confirmed.",
    }, { transaction });
    await transaction.commit();
    return makeResult(0, "Payment confirmed successfully.", { order: serializeOrder(lockedOrder), transitioned: true });
  } catch (error) {
    await rollbackIfNeeded(transaction);
    throw error;
  }
};

const restoreStockAndCancel = async ({ orderId, userId = null, customerOnly = false, note }) => {
  const transaction = await sequelize.transaction();
  try {
    const where = { id: orderId };
    if (userId) where.user_id = userId;
    const order = await Order.findOne({
      where,
      include: [{ model: OrderItem }],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!order) {
      await transaction.rollback();
      return makeResult(404, "Order not found.");
    }
    const isPendingPayOS = order.payment_method === "payos" &&
      order.payment_status === "pending" && LEGACY_PENDING_STATUSES.includes(order.order_status);
    if ((customerOnly && !isPendingPayOS) || (!customerOnly && !isPendingPayOS)) {
      await transaction.rollback();
      return makeResult(409, "This order can no longer be cancelled as an unpaid PayOS order.");
    }

    const productIds = [...new Set(order.OrderItems.map((item) => item.product_id))].sort();
    const products = await Product.findAll({
      where: { id: { [Op.in]: productIds } },
      order: [["id", "ASC"]],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const quantities = new Map();
    for (const item of order.OrderItems) {
      quantities.set(item.product_id, (quantities.get(item.product_id) || 0) + item.quantity);
    }
    for (const product of products) {
      await applyStockChange({
        product,
        quantityChange: quantities.get(product.id) || 0,
        type: "ORDER_CANCELLATION",
        referenceType: "ORDER",
        referenceId: order.id,
        note,
        actorId: userId,
        transaction,
      });
    }
    const fromStatus = order.order_status;
    await order.update({ order_status: "cancelled", payment_status: "failed" }, { transaction });
    await OrderStatusHistory.create({
      order_id: order.id,
      from_status: fromStatus,
      to_status: "cancelled",
      changed_by: userId,
      note,
    }, { transaction });
    await transaction.commit();
    return makeResult(0, "Order cancelled successfully.", {
      order: await loadOrderDetails(order.id),
      productChanges: products.map((product) => ({
        productId: product.id,
        stock_quantity: product.stock_quantity,
        is_available: product.is_available,
      })),
    });
  } catch (error) {
    await rollbackIfNeeded(transaction);
    console.error("Error while cancelling an unpaid PayOS order:", error);
    return makeResult(500, "Unable to cancel the order.");
  }
};

const cancelPendingCustomerOrderService = (userId, orderId) => restoreStockAndCancel({
  orderId,
  userId,
  customerOnly: true,
  note: "Customer cancelled an unpaid PayOS order.",
});

const expirePendingOrderService = async (orderId) => {
  const result = await restoreStockAndCancel({
    orderId,
    note: "System cancelled the unpaid PayOS order after timeout.",
  });
  if (result.EC === 409 || result.EC === 404) {
    return makeResult(0, "Order no longer needs expiration.", { expired: false });
  }
  if (result.EC !== 0) return result;
  return makeResult(0, "Expired order cancelled.", {
    expired: true,
    orderId,
    ...result.DT,
  });
};

const getAllOrdersService = async (options) => {
  try {
    const page = parsePositiveInteger(options.page, 1, 100000);
    const limit = parsePositiveInteger(options.limit, 20, 100);
    if (!page || !limit) return makeResult(400, "Page and limit must be positive integers within the supported range.");

    const where = {};
    const status = String(options.status || "all").trim().toLowerCase();
    const paymentStatus = String(options.paymentStatus || "all").trim().toLowerCase();
    const paymentMethod = String(options.paymentMethod || "all").trim().toLowerCase();
    const fulfillmentType = String(options.fulfillmentType || "all").trim().toLowerCase();
    if (status !== "all" && !ORDER_STATUSES.includes(status)) return makeResult(400, "Invalid order status filter.");
    if (paymentStatus !== "all" && !PAYMENT_STATUSES.includes(paymentStatus)) return makeResult(400, "Invalid payment status filter.");
    if (paymentMethod !== "all" && !PAYMENT_METHODS.includes(paymentMethod)) return makeResult(400, "Invalid payment method filter.");
    if (fulfillmentType !== "all" && !FULFILLMENT_TYPES.includes(fulfillmentType)) return makeResult(400, "Invalid fulfillment filter.");
    if (status !== "all") where.order_status = status;
    if (paymentStatus !== "all") where.payment_status = paymentStatus;
    if (paymentMethod !== "all") where.payment_method = paymentMethod === "legacy_unknown" ? null : paymentMethod;
    if (fulfillmentType !== "all") where.fulfillment_type = fulfillmentType === "legacy" ? null : fulfillmentType;

    const keyword = String(options.search || "").trim();
    if (keyword.length > 100) return makeResult(400, "Search must be 100 characters or fewer.");
    if (keyword) {
      where[Op.or] = [
        { id: { [Op.like]: `%${keyword}%` } },
        { contact_name: { [Op.like]: `%${keyword}%` } },
        { phone_receiver: { [Op.like]: `%${keyword}%` } },
        { transaction_id: { [Op.like]: `%${keyword}%` } },
      ];
    }

    if (options.dateFrom || options.dateTo) {
      const from = options.dateFrom ? parseDateBoundary(options.dateFrom) : null;
      const to = options.dateTo ? parseDateBoundary(options.dateTo, true) : null;
      if ((options.dateFrom && !from) || (options.dateTo && !to)) return makeResult(400, "Date filters must use YYYY-MM-DD.");
      if (from && to && from >= to) return makeResult(400, "The start date must not be after the end date.");
      where.createdAt = {};
      if (from) where.createdAt[Op.gte] = from;
      if (to) where.createdAt[Op.lt] = to;
    }

    const { count, rows } = await Order.findAndCountAll({
      where,
      order: [["createdAt", "DESC"]],
      limit,
      offset: (page - 1) * limit,
      distinct: true,
      include: [
        { model: Table, attributes: ["id", "table_number"] },
        { model: User, attributes: ["id", "username", "full_name"] },
      ],
    });
    return makeResult(0, "Orders retrieved successfully.", {
      totalRows: count,
      totalPages: Math.ceil(count / limit),
      page,
      limit,
      orders: rows.map(serializeOrder),
    });
  } catch (error) {
    console.error("Error while retrieving managed orders:", error);
    return makeResult(500, "Unable to retrieve orders.");
  }
};

const getManagedOrderDetailsService = async (orderId) => {
  try {
    const order = await loadManagedOrderDetails(orderId);
    return order ? makeResult(0, "Order retrieved successfully.", order) : makeResult(404, "Order not found.");
  } catch (error) {
    console.error("Error while retrieving managed order details:", error);
    return makeResult(500, "Unable to retrieve the order.");
  }
};

const getKitchenOrdersService = async () => {
  try {
    const orders = await Order.findAll({
      where: {
        order_status: { [Op.in]: ["confirmed", "preparing", "ready", "processing"] },
      },
      order: [["createdAt", "ASC"]],
      include: ORDER_DETAIL_INCLUDE,
    });
    return makeResult(0, "Kitchen orders retrieved successfully.", orders.map(serializeOrder));
  } catch (error) {
    console.error("Error while retrieving kitchen orders:", error);
    return makeResult(500, "Unable to retrieve kitchen orders.");
  }
};

const updateOrderStatusService = async (orderId, newStatus, actor) => {
  const lifecycleSnapshot = await Order.findByPk(orderId, { attributes: ["id", "fulfillment_type", "source"] });
  if (!lifecycleSnapshot) return makeResult(404, "Order not found.");
  const isExplicitDineIn = lifecycleSnapshot.fulfillment_type === "dine_in" && lifecycleSnapshot.source === "pos";
  if (isExplicitDineIn && newStatus === "cancelled") return cancelDineInOrderService(actor?.id || null, orderId);
  if (isExplicitDineIn && newStatus === "completed") {
    return makeResult(409, "Dine-in orders can only be completed through Checkout Table.");
  }
  const transaction = await sequelize.transaction();
  try {
    const order = await Order.findByPk(orderId, {
      include: [{ model: OrderItem }],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!order) {
      await transaction.rollback();
      return makeResult(404, "Order not found.");
    }

    const allowedTransitions = {
      pending: ["cancelled"],
      pending_payment: ["cancelled"],
      confirmed: ["preparing", "cancelled"],
      preparing: ["ready", "cancelled"],
      processing: ["ready", "cancelled"],
      ready: ["completed"],
    };
    if (!(allowedTransitions[order.order_status] || []).includes(newStatus)) {
      await transaction.rollback();
      return makeResult(409, `Cannot change ${order.order_status} to ${newStatus}.`);
    }

    const fromStatus = order.order_status;
    const productChanges = [];
    if (newStatus === "cancelled") {
      const productIds = [...new Set(order.OrderItems.map((item) => item.product_id))].sort();
      const products = await Product.findAll({
        where: { id: { [Op.in]: productIds } },
        order: [["id", "ASC"]],
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      const quantities = new Map();
      for (const item of order.OrderItems) {
        quantities.set(item.product_id, (quantities.get(item.product_id) || 0) + item.quantity);
      }
      for (const product of products) {
        const quantityChange = quantities.get(product.id) || 0;
        const { stockAfter: nextStock } = await applyStockChange({
          product,
          quantityChange,
          type: "ORDER_CANCELLATION",
          referenceType: "ORDER",
          referenceId: order.id,
          note: "Order cancelled by restaurant staff.",
          actorId: actor?.id || null,
          transaction,
        });
        productChanges.push({
          productId: product.id,
          stock_quantity: nextStock,
          is_available: product.is_available,
        });
      }
    }

    const previousPaymentStatus = order.payment_status;
    const updateData = { order_status: newStatus };
    if (newStatus === "cancelled" && order.payment_status === "pending") {
      updateData.payment_status = "failed";
    }
    if (newStatus === "completed" && order.payment_method === "cash") {
      updateData.payment_status = "paid";
    }
    await order.update(updateData, { transaction });

    let tableChange = null;
    if (["completed", "cancelled"].includes(newStatus) && order.table_id) {
      const table = await Table.findByPk(order.table_id, { transaction, lock: transaction.LOCK.UPDATE });
      if (table) {
        const otherActiveOrder = await Order.findOne({ where: { table_id: order.table_id, order_status: { [Op.in]: TABLE_ACTIVE_ORDER_STATUSES } }, transaction });
        const nextTableStatus = otherActiveOrder ? "occupied" : "available";
        if (table.status !== nextTableStatus) await table.update({ status: nextTableStatus }, { transaction });
        tableChange = { tableId: table.id, status: nextTableStatus, changeType: "order_released" };
      }
    }
    await OrderStatusHistory.create({
      order_id: order.id,
      from_status: fromStatus,
      to_status: newStatus,
      changed_by: actor?.id || null,
      note: newStatus === "cancelled"
        ? "Order cancelled by restaurant staff."
        : `Order moved to ${newStatus}.`,
    }, { transaction });
    await transaction.commit();

    return makeResult(0, "Order status updated successfully.", {
      order: await loadOrderDetails(order.id),
      productChanges,
      paymentChanged: previousPaymentStatus !== order.payment_status,
      tableChange,
    });
  } catch (error) {
    await rollbackIfNeeded(transaction);
    console.error("Error while updating the order lifecycle:", error);
    return makeResult(500, "Unable to update the order status.");
  }
};

export {
  cancelPendingCustomerOrderService,
  createOrderAndPaymentService,
  expirePendingOrderService,
  getAllOrdersService,
  getManagedOrderDetailsService,
  getKitchenOrdersService,
  getUserOrderDetailsService,
  getUserOrdersService,
  processPayOSWebhookService,
  reCreatePaymentLinkService,
  serializeOrder,
  updateOrderStatusService,
};
