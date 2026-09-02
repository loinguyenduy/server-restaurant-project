import payOSInstance from "../config/payosConfig.js";

const SAFE_TERMINAL_STATUSES = ["CANCELLED", "FAILED", "EXPIRED"];
const BLOCKING_STATUSES = ["PAID", "PROCESSING", "UNDERPAID"];

const createPayOSOrderCode = () => {
  const code = (Date.now() * 100) + Math.floor(Math.random() * 100);
  if (!Number.isSafeInteger(code)) throw new Error("Unable to create a safe PayOS order code.");
  return code;
};

const appendOrderId = (urlValue, orderId, fallbackPath) => {
  const clientUrl = String(process.env.CLIENT_URL || "http://localhost:3000").split(",")[0].trim().replace(/\/$/, "");
  const url = new URL(String(urlValue || `${clientUrl}${fallbackPath}`).trim());
  url.searchParams.set("orderId", orderId);
  url.searchParams.set("context", "pos");
  return url.toString();
};

const createDineInPaymentLink = async (order) => {
  const amount = Number(order.final_amount);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Order total must be a positive VND integer before PayOS payment.");
  const orderCode = createPayOSOrderCode();
  const response = await payOSInstance.paymentRequests.create({
    orderCode,
    amount,
    description: `Royal ${orderCode}`.slice(0, 25),
    returnUrl: appendOrderId(process.env.PAYOS_RETURN_URL, order.id, "/payment-success"),
    cancelUrl: appendOrderId(process.env.PAYOS_CANCEL_URL, order.id, "/payment-cancel"),
  });
  return { orderCode: String(orderCode), checkoutUrl: response.checkoutUrl, status: String(response.status || "PENDING").toUpperCase() };
};

const parseOrderCode = (transactionId) => {
  if (!/^\d+$/.test(String(transactionId || ""))) throw new Error("The stored PayOS transaction ID is invalid.");
  const orderCode = Number(transactionId);
  if (!Number.isSafeInteger(orderCode)) throw new Error("The stored PayOS transaction ID is invalid.");
  return orderCode;
};

const inspectPaymentAttempt = async (transactionId) => {
  const result = await payOSInstance.paymentRequests.get(parseOrderCode(transactionId));
  return { ...result, status: String(result.status || "").toUpperCase() };
};

const cancelPaymentAttempt = async (transactionId, reason) => {
  const result = await payOSInstance.paymentRequests.cancel(parseOrderCode(transactionId), reason);
  return { ...result, status: String(result.status || "").toUpperCase() };
};

const makeExistingAttemptSafe = async (transactionId, reason) => {
  if (!transactionId) return { safe: true, status: null };
  const attempt = await inspectPaymentAttempt(transactionId);
  if (SAFE_TERMINAL_STATUSES.includes(attempt.status)) return { safe: true, status: attempt.status };
  if (BLOCKING_STATUSES.includes(attempt.status)) return { safe: false, status: attempt.status };
  if (attempt.status !== "PENDING") return { safe: false, status: attempt.status || "UNKNOWN" };
  const cancelled = await cancelPaymentAttempt(transactionId, reason);
  return { safe: SAFE_TERMINAL_STATUSES.includes(cancelled.status), status: cancelled.status };
};

export {
  BLOCKING_STATUSES,
  SAFE_TERMINAL_STATUSES,
  cancelPaymentAttempt,
  createDineInPaymentLink,
  inspectPaymentAttempt,
  makeExistingAttemptSafe,
};
