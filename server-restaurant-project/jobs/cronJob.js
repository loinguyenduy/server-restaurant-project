import cron from "node-cron";
import { Order, OrderItem, Product } from "../models/index.js";
import { Op } from "sequelize";
import { sequelize } from "../config/databaseConfig.js";

const initCronJobs = () => {
  // Schedule a cron job to run every 15 minutes
  cron.schedule("*/15 * * * *", async () => {
  // cron.schedule("* * * * *", async () => { test 1 minute
    console.log(">>> Checking for expired pending orders...");
    const transaction = await sequelize.transaction();

    try {
      // Calculate the expiration time (30 minutes ago)
      // const expirationTime = new Date(Date.now() - 1 * 60 * 1000); test 1 minute
            const expirationTime = new Date(Date.now() - 30 * 60 * 1000);


      // Find all orders that are still pending and created before the expiration time
      const expiredOrders = await Order.findAll({
        where: {
          payment_status: "pending",
          order_status: "pending",
          createdAt: { [Op.lt]: expirationTime },
        },
        include: [{ model: OrderItem }],
      });

      if (expiredOrders.length > 0) {
        for (const order of expiredOrders) {
          //Revert stock quantity for each product in the order
          for (const item of order.OrderItems) {
            await Product.increment(
              { stock_quantity: item.quantity },
              { where: { id: item.product_id }, transaction },
            );
          }

          // Update order status to cancelled and payment status to failed
          await order.update(
            {
              order_status: "cancelled",
              payment_status: "failed",
              note: order.note
                ? order.note + " (System: Auto-cancelled due to timeout)"
                : "System: Auto-cancelled due to timeout",
            },
            { transaction },
          );
        }

        console.log(
          `>>> Successfully cancelled ${expiredOrders.length} expired orders and reverted stock.`,
        );
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      console.error(">>> Error in Cron Job:", error);
    }
  });
};

export { initCronJobs };
