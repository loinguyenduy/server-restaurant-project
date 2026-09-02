import payOSInstance from "../config/payosConfig.js";
import { processPayOSWebhookService } from "../services/orderService.js";
import { emitToKitchen, emitToOperations, emitToUser } from "../socket/socket.js";

const handlePayOSWebhook = async (req, res) => {
  try {
    const verifiedData = await payOSInstance.webhooks.verify(req.body);
    const result = await processPayOSWebhookService(verifiedData);
    if (result.EC !== 0) {
      const status = [404, 409].includes(result.EC) ? result.EC : 400;
      return res.status(status).json({ success: false, message: result.EM });
    }
    const order = result.DT?.order;
    if (order && (result.DT.transitioned || result.DT.requires_manual_refund)) {
      const changedAt = new Date().toISOString();
      const paymentPayload = { orderId: order.id, paymentStatus: order.payment_status, changedAt: new Date().toISOString() };
      emitToUser(order.user_id, "payment:status_changed", paymentPayload);
      emitToOperations("payment:status_changed", paymentPayload);
      if (result.DT.transitioned) {
        const statusPayload = { orderId: order.id, newStatus: order.order_status, changedAt: new Date().toISOString() };
        emitToUser(order.user_id, "order:status_changed", statusPayload);
        emitToKitchen("order:status_changed", statusPayload);
        emitToOperations("order:status_changed", statusPayload);
        if (order.fulfillment_type !== "dine_in") emitToKitchen("order:new", { orderId: order.id, confirmedAt: changedAt });
      }
      if (result.DT.tableChange) {
        emitToOperations("table:status_changed", { ...result.DT.tableChange, changedAt });
      }
      if (result.DT.reservationChange) {
        const reservationPayload = { reservationId: result.DT.reservationChange.reservationId, status: result.DT.reservationChange.status, changedAt };
        emitToUser(result.DT.reservationChange.userId, "reservation:status_changed", reservationPayload);
        emitToOperations("reservation:status_changed", reservationPayload);
      }
    }
    return res.status(200).json({ success: true, message: result.EM });
  } catch (error) {
    console.error("PayOS webhook verification failed:", error.message);
    return res.status(400).json({ success: false, message: "Invalid webhook data." });
  }
};

export { handlePayOSWebhook };
