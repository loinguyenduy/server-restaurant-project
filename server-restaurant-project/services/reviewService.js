import { Op } from "sequelize";
import { Order, Reservation, Review, User, sequelize } from "../models/index.js";

const makeResult = (EC, EM, DT = "") => ({ EC, EM, DT });
const parsePage = (value, fallback, maximum) => {
  if (value === undefined || value === "") return fallback;
  return /^\d+$/.test(String(value)) && Number(value) >= 1 && Number(value) <= maximum ? Number(value) : null;
};
const normalizeReviewInput = (input = {}) => {
  const rating = Number(input.rating);
  const comment = String(input.comment || "").trim();
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { error: "Rating must be an integer from 1 to 5." };
  if (!comment || comment.length > 1000) return { error: "Comment is required and must be 1,000 characters or fewer." };
  return { rating, comment };
};
const isOrderOwnedByCustomer = (order, userId) => {
  if (order.user_id === userId) return true;
  // POS stores the staff operator in Order.user_id. Reservation ownership is a separate, explicit path.
  return order.fulfillment_type === "dine_in" &&
    order.source === "pos" &&
    Boolean(order.reservation_id) &&
    order.Reservation?.user_id === userId;
};

const getPublicReviewsService = async (options = {}) => {
  try {
    const page = parsePage(options.page, 1, 100000);
    const limit = parsePage(options.limit, 10, 50);
    if (!page || !limit) return makeResult(400, "Invalid review pagination.");
    const rating = options.rating === undefined || options.rating === "" || options.rating === "all" ? null : Number(options.rating);
    if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) return makeResult(400, "Invalid rating filter.");
    const where = { status: "visible" };
    if (rating) where.rating = rating;

    const [list, aggregate, distributionRows] = await Promise.all([
      Review.findAndCountAll({ where, include: [{ model: User, attributes: ["id", "full_name"] }], order: [["createdAt", "DESC"]], limit, offset: (page - 1) * limit }),
      Review.findOne({ where: { status: "visible" }, attributes: [[sequelize.fn("AVG", sequelize.col("rating")), "average_rating"], [sequelize.fn("COUNT", sequelize.col("id")), "total_reviews"]], raw: true }),
      Review.findAll({ where: { status: "visible" }, attributes: ["rating", [sequelize.fn("COUNT", sequelize.col("id")), "count"]], group: ["rating"], raw: true }),
    ]);
    const ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    distributionRows.forEach((row) => { ratingDistribution[row.rating] = Number(row.count); });
    return makeResult(0, "Reviews retrieved successfully.", {
      summary: { average_rating: Number(aggregate?.average_rating || 0), total_reviews: Number(aggregate?.total_reviews || 0), rating_distribution: ratingDistribution },
      reviews: list.rows,
      page,
      limit,
      totalRows: list.count,
      totalPages: Math.ceil(list.count / limit),
    });
  } catch (error) { console.error("Error while retrieving public reviews:", error); return makeResult(500, "Unable to retrieve reviews."); }
};

const getReviewEligibilityService = async (userId) => {
  try {
    const orders = await Order.findAll({
      where: {
        order_status: "completed",
        [Op.or]: [
          { user_id: userId },
          {
            "$Reservation.user_id$": userId,
            reservation_id: { [Op.ne]: null },
            fulfillment_type: "dine_in",
            source: "pos",
          },
        ],
      },
      include: [
        { model: Reservation, attributes: ["id", "reservation_time"], required: false },
        { model: Review, attributes: ["id", "rating", "comment", "status", "createdAt", "updatedAt"], where: { user_id: userId }, required: false },
      ],
      order: [["createdAt", "DESC"]],
    });
    return makeResult(0, "Review eligibility retrieved successfully.", orders.map((order) => ({
      id: order.id,
      fulfillment_type: order.fulfillment_type,
      reservation_id: order.reservation_id,
      createdAt: order.createdAt,
      final_amount: Number(order.final_amount),
      review: order.Review || null,
    })));
  } catch (error) { console.error("Error while retrieving review eligibility:", error); return makeResult(500, "Unable to retrieve review eligibility."); }
};

const createReviewService = async (userId, input) => {
  const normalized = normalizeReviewInput(input);
  if (normalized.error) return makeResult(400, normalized.error);
  const transaction = await sequelize.transaction();
  try {
    const order = await Order.findByPk(input.order_id, { include: [{ model: Reservation, attributes: ["user_id"], required: false }], transaction, lock: transaction.LOCK.UPDATE });
    if (!order || !isOrderOwnedByCustomer(order, userId)) { await transaction.rollback(); return makeResult(404, "Eligible completed order not found."); }
    if (order.order_status !== "completed") { await transaction.rollback(); return makeResult(409, "Only completed orders can be reviewed."); }
    if (await Review.findOne({ where: { order_id: order.id }, transaction, lock: transaction.LOCK.UPDATE })) { await transaction.rollback(); return makeResult(409, "This order has already been reviewed."); }
    const review = await Review.create({ user_id: userId, order_id: order.id, ...normalized, status: "visible" }, { transaction });
    await transaction.commit();
    return makeResult(0, "Review submitted successfully.", review);
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    if (error.name === "SequelizeUniqueConstraintError") return makeResult(409, "This order has already been reviewed.");
    console.error("Error while creating review:", error); return makeResult(500, "Unable to submit review.");
  }
};

const updateOwnReviewService = async (userId, reviewId, input) => {
  const normalized = normalizeReviewInput(input);
  if (normalized.error) return makeResult(400, normalized.error);
  try {
    const review = await Review.findOne({ where: { id: reviewId, user_id: userId } });
    if (!review) return makeResult(404, "Review not found.");
    await review.update(normalized);
    return makeResult(0, "Review updated successfully.", review);
  } catch (error) { console.error("Error while updating review:", error); return makeResult(500, "Unable to update review."); }
};

const getManagedReviewsService = async (options = {}) => {
  try {
    const page = parsePage(options.page, 1, 100000); const limit = parsePage(options.limit, 20, 100);
    if (!page || !limit) return makeResult(400, "Invalid review pagination.");
    const status = String(options.status || "all").toLowerCase();
    if (!["all", "visible", "hidden"].includes(status)) return makeResult(400, "Invalid review status filter.");
    const rating = options.rating && options.rating !== "all" ? Number(options.rating) : null;
    if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) return makeResult(400, "Invalid rating filter.");
    const search = String(options.search || "").trim(); if (search.length > 100) return makeResult(400, "Search must be 100 characters or fewer.");
    const where = {}; if (status !== "all") where.status = status; if (rating) where.rating = rating;
    if (search) where[Op.or] = [{ order_id: { [Op.like]: `%${search}%` } }, { "$User.full_name$": { [Op.like]: `%${search}%` } }];
    const result = await Review.findAndCountAll({ where, include: [{ model: User, attributes: ["id", "full_name", "email"] }, { model: Order, attributes: ["id", "fulfillment_type", "createdAt"] }], order: [["createdAt", "DESC"]], limit, offset: (page - 1) * limit, distinct: true });
    return makeResult(0, "Managed reviews retrieved successfully.", { reviews: result.rows, page, limit, totalRows: result.count, totalPages: Math.ceil(result.count / limit) });
  } catch (error) { console.error("Error while retrieving managed reviews:", error); return makeResult(500, "Unable to retrieve managed reviews."); }
};

const updateReviewStatusService = async (reviewId, status) => {
  try {
    if (!["visible", "hidden"].includes(status)) return makeResult(400, "Review status must be visible or hidden.");
    const review = await Review.findByPk(reviewId); if (!review) return makeResult(404, "Review not found.");
    await review.update({ status });
    return makeResult(0, `Review marked ${status}.`, review);
  } catch (error) { console.error("Error while moderating review:", error); return makeResult(500, "Unable to moderate review."); }
};

export { createReviewService, getManagedReviewsService, getPublicReviewsService, getReviewEligibilityService, updateOwnReviewService, updateReviewStatusService };
