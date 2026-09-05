import { QueryTypes } from "sequelize";
import { Order, Reservation, User, sequelize } from "../models/index.js";
import { addDateDays, getVietnamDateString, parseVietnamDateRange } from "../utils/dateRange.js";
import { getLowStockThreshold } from "./inventoryService.js";

const makeResult = (EC, EM, DT = "") => ({ EC, EM, DT });

const getDashboardStatsService = async () => {
  try {
    const [totalRevenue, totalOrders, totalUsers, totalReservations] = await Promise.all([
      Order.sum("final_amount", { where: { payment_status: "paid", order_status: "completed" } }),
      Order.count({ where: { order_status: "completed" } }),
      User.count({ where: { role: "customer" } }),
      Reservation.count(),
    ]);
    return makeResult(0, "Dashboard stats retrieved successfully.", { totalRevenue: Number(totalRevenue || 0), totalOrders, totalUsers, totalReservations });
  } catch (error) { console.error("Error retrieving dashboard stats:", error); return makeResult(500, "Unable to retrieve dashboard stats."); }
};

const normalizePeriod = (options = {}) => {
  const today = getVietnamDateString();
  const dateFrom = options.dateFrom || addDateDays(today, -6);
  const dateTo = options.dateTo || today;
  const parsed = parseVietnamDateRange(dateFrom, dateTo);
  if (parsed.error) return parsed;
  const days = Math.round((new Date(`${dateTo}T00:00:00Z`) - new Date(`${dateFrom}T00:00:00Z`)) / 86400000) + 1;
  if (days > 366) return { error: "Analytics range cannot exceed 366 days." };
  return { dateFrom, dateTo, from: parsed.from, to: parsed.to, days };
};
const rowsToMap = (rows, key, value = "count") => Object.fromEntries(rows.map((row) => [row[key] || "legacy_unknown", Number(row[value] || 0)]));

const getAnalyticsOverviewService = async (options = {}) => {
  const period = normalizePeriod(options);
  if (period.error) return makeResult(400, period.error);
  const reservationFrom = new Date(`${period.dateFrom}T00:00:00.000Z`);
  const reservationTo = new Date(`${period.dateTo}T00:00:00.000Z`); reservationTo.setUTCDate(reservationTo.getUTCDate() + 1);
  const replacements = { from: period.from, to: period.to, reservationFrom, reservationTo, threshold: getLowStockThreshold() };
  const select = (sql) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
  try {
    // Revenue is attributed to qualifying orders CREATED in the selected period.
    // Historical payment/completion timestamps are not reliable enough to mix with this rule.
    const [revenueRows, trendRows, fulfillmentRows, paymentRows, statusRows, topProducts, reservationRows, popularSlots, inventoryRows, lowStockProducts, reviewRows, ratingRows, attendanceRows] = await Promise.all([
      select("SELECT COALESCE(SUM(final_amount),0) AS total, COUNT(*) AS order_count FROM orders WHERE created_at >= :from AND created_at < :to AND payment_status='paid' AND order_status='completed'"),
      select("SELECT DATE_FORMAT(CONVERT_TZ(created_at,'+00:00','+07:00'),'%Y-%m-%d') AS day, COALESCE(SUM(final_amount),0) AS revenue, COUNT(*) AS orders FROM orders WHERE created_at >= :from AND created_at < :to AND payment_status='paid' AND order_status='completed' GROUP BY day ORDER BY day"),
      select("SELECT COALESCE(fulfillment_type,'legacy') AS fulfillment, COUNT(*) AS count FROM orders WHERE created_at >= :from AND created_at < :to AND payment_status='paid' AND order_status='completed' GROUP BY fulfillment"),
      select("SELECT COALESCE(payment_method,'legacy_unknown') AS method, COUNT(*) AS count FROM orders WHERE created_at >= :from AND created_at < :to AND payment_status='paid' AND order_status='completed' GROUP BY method"),
      select("SELECT order_status AS status, COUNT(*) AS count FROM orders WHERE created_at >= :from AND created_at < :to GROUP BY order_status"),
      select("SELECT oi.product_id, COALESCE(MAX(oi.product_name),MAX(p.name),'Legacy dish') AS name, SUM(oi.quantity) AS quantity_sold, SUM(oi.quantity * oi.price) AS revenue FROM order_items oi INNER JOIN orders o ON o.id=oi.order_id LEFT JOIN products p ON p.id=oi.product_id WHERE o.created_at >= :from AND o.created_at < :to AND o.payment_status='paid' AND o.order_status='completed' GROUP BY oi.product_id ORDER BY quantity_sold DESC, revenue DESC LIMIT 5"),
      select("SELECT status, COUNT(*) AS count FROM reservations WHERE reservation_time >= :reservationFrom AND reservation_time < :reservationTo GROUP BY status"),
      select("SELECT DATE_FORMAT(reservation_time,'%H:%i') AS slot, COUNT(*) AS count FROM reservations WHERE reservation_time >= :reservationFrom AND reservation_time < :reservationTo GROUP BY slot ORDER BY count DESC, slot ASC LIMIT 1"),
      select("SELECT SUM(CASE WHEN stock_quantity BETWEEN 1 AND :threshold THEN 1 ELSE 0 END) AS low_stock_count, SUM(CASE WHEN stock_quantity=0 THEN 1 ELSE 0 END) AS sold_out_count FROM products"),
      select("SELECT id,name,stock_quantity,is_available FROM products WHERE stock_quantity BETWEEN 1 AND :threshold ORDER BY stock_quantity ASC,name ASC LIMIT 5"),
      select("SELECT COALESCE(AVG(rating),0) AS average_rating, COUNT(*) AS total_reviews FROM reviews WHERE status='visible' AND created_at >= :from AND created_at < :to"),
      select("SELECT rating,COUNT(*) AS count FROM reviews WHERE status='visible' AND created_at >= :from AND created_at < :to GROUP BY rating"),
      select("SELECT SUM(CASE WHEN check_out_time IS NOT NULL AND check_out_time >= check_in_time AND check_in_time >= :from AND check_in_time < :to THEN 1 ELSE 0 END) AS completed_shifts, COALESCE(SUM(CASE WHEN check_out_time IS NOT NULL AND check_out_time >= check_in_time AND check_in_time >= :from AND check_in_time < :to THEN TIMESTAMPDIFF(MINUTE,check_in_time,check_out_time) ELSE 0 END),0) AS total_worked_minutes, SUM(CASE WHEN check_out_time IS NULL THEN 1 ELSE 0 END) AS open_shifts FROM attendances"),
    ]);
    const trendByDay = new Map(trendRows.map((row) => [row.day, { date: row.day, revenue: Number(row.revenue), orders: Number(row.orders) }]));
    const trend = []; for (let day = period.dateFrom; day <= period.dateTo; day = addDateDays(day, 1)) trend.push(trendByDay.get(day) || { date: day, revenue: 0, orders: 0 });
    const revenue = Number(revenueRows[0]?.total || 0); const orderCount = Number(revenueRows[0]?.order_count || 0);
    const reservationByStatus = rowsToMap(reservationRows, "status");
    const ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }; ratingRows.forEach((row) => { ratingDistribution[row.rating] = Number(row.count); });
    return makeResult(0, "Analytics overview retrieved successfully.", {
      period: { dateFrom: period.dateFrom, dateTo: period.dateTo, timeZone: "Asia/Ho_Chi_Minh", attribution: "Revenue and order metrics include qualifying orders created in this period; they are not exact payment-time or completion-time revenue." },
      revenue: { total: revenue, order_count: orderCount, average_order_value: orderCount ? Math.round(revenue / orderCount) : 0, trend },
      orders: { by_fulfillment: rowsToMap(fulfillmentRows, "fulfillment"), by_payment: rowsToMap(paymentRows, "method"), by_status: rowsToMap(statusRows, "status") },
      products: topProducts.map((row) => ({ ...row, quantity_sold: Number(row.quantity_sold), revenue: Number(row.revenue) })),
      reservations: { total: Object.values(reservationByStatus).reduce((sum, count) => sum + count, 0), by_status: reservationByStatus, popular_slot: popularSlots[0]?.slot || null },
      inventory: { low_stock_count: Number(inventoryRows[0]?.low_stock_count || 0), sold_out_count: Number(inventoryRows[0]?.sold_out_count || 0), low_stock_products: lowStockProducts.map((row) => ({ ...row, stock_quantity: Number(row.stock_quantity) })) },
      reviews: { average_rating: Number(reviewRows[0]?.average_rating || 0), total_reviews: Number(reviewRows[0]?.total_reviews || 0), rating_distribution: ratingDistribution },
      attendance: { completed_shifts: Number(attendanceRows[0]?.completed_shifts || 0), total_worked_minutes: Number(attendanceRows[0]?.total_worked_minutes || 0), open_shifts: Number(attendanceRows[0]?.open_shifts || 0), attribution: "Shifts are attributed by check-in time and full completed duration is not split overnight." },
    });
  } catch (error) { console.error("Error retrieving analytics overview:", error); return makeResult(500, "Unable to retrieve analytics overview."); }
};

export { getAnalyticsOverviewService, getDashboardStatsService };
