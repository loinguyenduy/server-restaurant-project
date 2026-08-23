import cron from "node-cron";
import { Order, Reservation } from "../models/index.js";
import { Op } from "sequelize";
import { expirePendingOrderService } from "../services/orderService.js";
import { emitProductAvailability, emitToOperations, emitToUser } from "../socket/socket.js";
import payOSInstance from "../config/payosConfig.js";

const initCronJobs = () => {
  // Schedule a cron job to run every 15 minutes
  cron.schedule("*/15 * * * *", async () => {
    // cron.schedule("* * * * *", async () => {
    console.log(">>> Checking for expired pending orders...");
    try {
      const configuredTimeout = Number.parseInt(
        process.env.PAYOS_ORDER_TIMEOUT_MINUTES,
        10,
      );
      const timeoutMinutes = Number.isInteger(configuredTimeout) && configuredTimeout >= 5
        ? configuredTimeout
        : 30;
      const expirationTime = new Date(Date.now() - timeoutMinutes * 60 * 1000);

      // Find all orders that are still pending and created before the expiration time
      const expiredOrders = await Order.findAll({
        where: {
          payment_method: "payos",
          payment_status: "pending",
          order_status: { [Op.in]: ["pending", "pending_payment"] },
          createdAt: { [Op.lt]: expirationTime },
        },
        attributes: ["id", "transaction_id"],
      });

      let expiredCount = 0;
      for (const order of expiredOrders) {
        if (order.transaction_id) {
          try {
            await payOSInstance.paymentRequests.cancel(
              Number(order.transaction_id),
              "Order expired before payment confirmation.",
            );
          } catch (error) {
            console.warn(`Unable to cancel PayOS link for expired order ${order.id}.`);
          }
        }
        const result = await expirePendingOrderService(order.id);
        if (result.EC === 0 && result.DT?.expired) {
          expiredCount += 1;
          result.DT.productChanges?.forEach((change) => emitProductAvailability(change));
          const statusPayload = { orderId: result.DT.order.id, newStatus: "cancelled", changedAt: new Date().toISOString() };
          emitToUser(result.DT.order.user_id, "order:status_changed", statusPayload);
          emitToOperations("order:status_changed", statusPayload);
        }
      }
      if (expiredCount > 0) {
        console.log(`>>> Cancelled ${expiredCount} expired PayOS orders and restored stock.`);
      }
    } catch (error) {
      console.error(">>> Error in Cron Job:", error);
    }
  });

  cron.schedule("*/5 * * * *", async () => {
    console.log(">>> Checking for expired pending reservations...");
    try {
      // Mốc thời gian: Hiện tại trừ đi 15 phút
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

      // Tìm và cập nhật: Những đơn pending có giờ hẹn nhỏ hơn (trước) mốc 15 phút trước
      const [affectedCount] = await Reservation.update(
        { status: "cancelled" },
        {
          where: {
            status: "pending",
            reservation_time: {
              [Op.lt]: fifteenMinutesAgo,
            },
          },
        },
      );

      if (affectedCount > 0) {
        console.log(
          `>>> Successfully auto-cancelled ${affectedCount} expired reservations.`,
        );
      }
    } catch (error) {
      console.error(">>> Error in Reservation Cron Job:", error);
    }
  });
};

export { initCronJobs };
