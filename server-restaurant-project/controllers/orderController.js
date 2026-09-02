import {
  cancelPendingCustomerOrderService,
  createOrderAndPaymentService,
  getAllOrdersService,
  getKitchenOrdersService,
  getManagedOrderDetailsService,
  getUserOrderDetailsService,
  getUserOrdersService,
  reCreatePaymentLinkService,
  updateOrderStatusService,
} from "../services/orderService.js";
import { addDineInItemsService, checkoutDineInOrderService, createDineInOrderService } from "../services/dineInOrderService.js";
import {
  emitProductAvailability,
  emitToKitchen,
  emitToOperations,
  emitToUser,
} from "../socket/socket.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const phonePattern = /^\+?[0-9\s\-()]{7,20}$/;

const getResponseStatus = (result, successStatus = 200) => {
  if (result.EC === 0) return successStatus;
  return [400, 401, 403, 404, 409].includes(result.EC) ? result.EC : 500;
};

const sendResult = (res, result, successStatus = 200) => {
  return res.status(getResponseStatus(result, successStatus)).json(result);
};

const emitProductChanges = (changes = []) => {
  changes.forEach((change) => emitProductAvailability(change));
};

const emitTableChange = (change) => {
  if (!change) return;
  emitToOperations("table:status_changed", { ...change, changedAt: new Date().toISOString() });
};

const emitOrderStatus = (order) => {
  const payload = { orderId: order.id, newStatus: order.order_status, changedAt: new Date().toISOString() };
  emitToUser(order.user_id, "order:status_changed", payload);
  emitToKitchen("order:status_changed", payload);
  emitToOperations("order:status_changed", payload);
};

const normalizeCheckout = (body = {}) => {
  const contactName = String(body.contact_name || "").trim();
  const phone = String(body.phone_receiver || "").trim();
  const note = String(body.note || "").trim();
  const paymentMethod = String(body.payment_method || "").trim().toLowerCase();
  if (!contactName || contactName.length > 100) {
    return { error: "Contact name is required and must be 100 characters or fewer." };
  }
  if (!phonePattern.test(phone)) return { error: "Enter a valid phone number." };
  if (note.length > 500) return { error: "Order note must be 500 characters or fewer." };
  if (!["cash", "payos"].includes(paymentMethod)) {
    return { error: "Payment method must be cash or PayOS." };
  }
  return {
    data: {
      contact_name: contactName,
      phone_receiver: phone,
      note: note || null,
      payment_method: paymentMethod,
    },
  };
};

const handleCheckout = async (req, res) => {
  try {
    const normalized = normalizeCheckout(req.body);
    if (normalized.error) {
      return res.status(400).json({ EC: 400, EM: normalized.error, DT: "" });
    }
    const result = await createOrderAndPaymentService(req.user.id, normalized.data);
    if (result.EC === 0) {
      emitProductChanges(result.DT.productChanges);
      if (result.DT.order.order_status === "confirmed") {
        emitToKitchen("order:new", { orderId: result.DT.order.id, confirmedAt: new Date().toISOString() });
      }
    }
    return sendResult(res, result, 201);
  } catch (error) {
    console.error("Error in checkout controller:", error);
    return res.status(500).json({ EC: 500, EM: "Server error.", DT: "" });
  }
};

const handleGetUserOrders = async (req, res) => {
  try {
    return sendResult(res, await getUserOrdersService(req.user.id));
  } catch (error) {
    console.error("Error in customer orders controller:", error);
    return res.status(500).json({ EC: 500, EM: "Server error.", DT: "" });
  }
};

const handleGetUserOrderDetails = async (req, res) => {
  try {
    if (!uuidPattern.test(req.params.id)) {
      return res.status(400).json({ EC: 400, EM: "A valid order ID is required.", DT: "" });
    }
    return sendResult(res, await getUserOrderDetailsService(req.user.id, req.params.id));
  } catch (error) {
    console.error("Error in customer order details controller:", error);
    return res.status(500).json({ EC: 500, EM: "Server error.", DT: "" });
  }
};

const handleRePayOrder = async (req, res) => {
  try {
    const orderId = req.params.id || req.body?.order_id;
    if (!uuidPattern.test(orderId || "")) {
      return res.status(400).json({ EC: 400, EM: "A valid order ID is required.", DT: "" });
    }
    return sendResult(res, await reCreatePaymentLinkService(req.user.id, orderId));
  } catch (error) {
    console.error("Error in PayOS retry controller:", error);
    return res.status(500).json({ EC: 500, EM: "Server error.", DT: "" });
  }
};

const handleCancelCustomerOrder = async (req, res) => {
  try {
    if (!uuidPattern.test(req.params.id || "")) {
      return res.status(400).json({ EC: 400, EM: "A valid order ID is required.", DT: "" });
    }
    const result = await cancelPendingCustomerOrderService(req.user.id, req.params.id);
    if (result.EC === 0) {
      emitProductChanges(result.DT.productChanges);
      const payload = { orderId: result.DT.order.id, newStatus: "cancelled", changedAt: new Date().toISOString() };
      emitToUser(result.DT.order.user_id, "order:status_changed", payload);
      emitToOperations("order:status_changed", payload);
    }
    return sendResult(res, result);
  } catch (error) {
    console.error("Error in customer cancellation controller:", error);
    return res.status(500).json({ EC: 500, EM: "Server error.", DT: "" });
  }
};

const handleGetAllOrders = async (req, res) => {
  try {
    return sendResult(res, await getAllOrdersService(req.query));
  } catch (error) {
    console.error("Error in managed orders controller:", error);
    return res.status(500).json({ EC: 500, EM: "Server error.", DT: "" });
  }
};

const handleGetManagedOrderDetails = async (req, res) => {
  try {
    if (!uuidPattern.test(req.params.id || "")) {
      return res.status(400).json({ EC: 400, EM: "A valid order ID is required.", DT: "" });
    }
    return sendResult(res, await getManagedOrderDetailsService(req.params.id));
  } catch (error) {
    console.error("Error in managed order details controller:", error);
    return res.status(500).json({ EC: 500, EM: "Server error.", DT: "" });
  }
};

const handleGetKitchenOrders = async (req, res) => {
  try {
    return sendResult(res, await getKitchenOrdersService());
  } catch (error) {
    console.error("Error in kitchen orders controller:", error);
    return res.status(500).json({ EC: 500, EM: "Server error.", DT: "" });
  }
};

const handleUpdateOrderStatus = async (req, res) => {
  try {
    if (!uuidPattern.test(req.params.id || "")) {
      return res.status(400).json({ EC: 400, EM: "A valid order ID is required.", DT: "" });
    }
    const status = String(req.body?.status || "").trim().toLowerCase();
    if (!status) return res.status(400).json({ EC: 400, EM: "Status is required.", DT: "" });
    const result = await updateOrderStatusService(req.params.id, status, req.user);
    if (result.EC === 0) {
      emitProductChanges(result.DT.productChanges);
      emitTableChange(result.DT.tableChange);
      emitOrderStatus(result.DT.order);
      if (result.DT.paymentChanged) {
        const payload = { orderId: result.DT.order.id, paymentStatus: result.DT.order.payment_status, changedAt: new Date().toISOString() };
        emitToUser(result.DT.order.user_id, "payment:status_changed", payload);
        emitToOperations("payment:status_changed", payload);
      }
    }
    return sendResult(res, result);
  } catch (error) {
    console.error("Error in order status controller:", error);
    return res.status(500).json({ EC: 500, EM: "Server error.", DT: "" });
  }
};

const handleCreatePosOrder = async (req, res) => {
  try {
    const result = await createDineInOrderService(req.user.id, req.body);
    if (result.EC === 0) {
      emitProductChanges(result.DT.productChanges);
      emitTableChange(result.DT.tableChange);
      const payload = { orderId: result.DT.order.id, confirmedAt: new Date().toISOString() };
      emitToKitchen("order:new", payload);
      emitToOperations("order:new", payload);
    }
    return sendResult(res, result, 201);
  } catch (error) {
    console.error("Error in POS order controller:", error);
    return res.status(500).json({ EC: 500, EM: "Server error.", DT: "" });
  }
};

const handleAddDineInItems = async (req, res) => {
  try {
    if (!uuidPattern.test(req.params.id || "")) return res.status(400).json({ EC: 400, EM: "A valid order ID is required.", DT: "" });
    const result = await addDineInItemsService(req.user.id, req.params.id, req.body);
    if (result.EC === 0) {
      emitProductChanges(result.DT.productChanges);
      const payload = { orderId: result.DT.order.id, addedItemCount: result.DT.addedItemCount, changedAt: new Date().toISOString() };
      emitToKitchen("order:items_added", payload);
      emitToOperations("order:items_added", payload);
      if (result.DT.statusChanged) emitOrderStatus(result.DT.order);
    }
    return sendResult(res, result);
  } catch (error) {
    console.error("Error in add dine-in items controller:", error);
    return res.status(500).json({ EC: 500, EM: "Server error.", DT: "" });
  }
};

const handleCheckoutDineInOrder = async (req, res) => {
  try {
    if (!uuidPattern.test(req.params.id || "")) return res.status(400).json({ EC: 400, EM: "A valid order ID is required.", DT: "" });
    const paymentMethod = String(req.body?.payment_method || "").trim().toLowerCase();
    if (!["cash", "payos"].includes(paymentMethod)) return res.status(400).json({ EC: 400, EM: "Payment method must be cash or PayOS.", DT: "" });
    const result = await checkoutDineInOrderService(req.user.id, req.params.id, paymentMethod);
    if (result.EC === 0) {
      const changedAt = new Date().toISOString();
      const order = result.DT.order;
      const paymentPayload = { orderId: order.id, paymentStatus: order.payment_status, changedAt };
      emitToUser(order.user_id, "payment:status_changed", paymentPayload);
      emitToOperations("payment:status_changed", paymentPayload);
      emitTableChange(result.DT.tableChange);
      if (order.order_status === "completed") emitOrderStatus(order);
      if (result.DT.reservationChange) {
        const reservationPayload = { reservationId: result.DT.reservationChange.reservationId, status: result.DT.reservationChange.status, changedAt };
        emitToUser(result.DT.reservationChange.userId, "reservation:status_changed", reservationPayload);
        emitToOperations("reservation:status_changed", reservationPayload);
      }
    }
    return sendResult(res, result);
  } catch (error) {
    console.error("Error in dine-in checkout controller:", error);
    return res.status(500).json({ EC: 500, EM: "Server error.", DT: "" });
  }
};

export {
  handleAddDineInItems,
  handleCancelCustomerOrder,
  handleCheckoutDineInOrder,
  handleCheckout,
  handleCreatePosOrder,
  handleGetAllOrders,
  handleGetKitchenOrders,
  handleGetManagedOrderDetails,
  handleGetUserOrderDetails,
  handleGetUserOrders,
  handleRePayOrder,
  handleUpdateOrderStatus,
};
