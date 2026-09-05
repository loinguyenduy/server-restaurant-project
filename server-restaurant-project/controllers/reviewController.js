import { createReviewService, getManagedReviewsService, getPublicReviewsService, getReviewEligibilityService, updateOwnReviewService, updateReviewStatusService } from "../services/reviewService.js";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statusFor = (result, success = 200) => result.EC === 0 ? success : [400, 404, 409].includes(result.EC) ? result.EC : 500;
const handleGetPublicReviews = async (req, res) => { const result = await getPublicReviewsService(req.query); return res.status(statusFor(result)).json(result); };
const handleGetReviewEligibility = async (req, res) => { const result = await getReviewEligibilityService(req.user.id); return res.status(statusFor(result)).json(result); };
const handleCreateReview = async (req, res) => {
  if (!uuidPattern.test(req.body?.order_id || "")) return res.status(400).json({ EC: 400, EM: "A valid order ID is required.", DT: "" });
  const result = await createReviewService(req.user.id, req.body); return res.status(statusFor(result, 201)).json(result);
};
const handleUpdateOwnReview = async (req, res) => {
  if (!uuidPattern.test(req.params.id || "")) return res.status(400).json({ EC: 400, EM: "A valid review ID is required.", DT: "" });
  const result = await updateOwnReviewService(req.user.id, req.params.id, req.body); return res.status(statusFor(result)).json(result);
};
const handleGetManagedReviews = async (req, res) => { const result = await getManagedReviewsService(req.query); return res.status(statusFor(result)).json(result); };
const handleUpdateReviewStatus = async (req, res) => {
  if (!uuidPattern.test(req.params.id || "")) return res.status(400).json({ EC: 400, EM: "A valid review ID is required.", DT: "" });
  const result = await updateReviewStatusService(req.params.id, String(req.body?.status || "").toLowerCase()); return res.status(statusFor(result)).json(result);
};
export { handleCreateReview, handleGetManagedReviews, handleGetPublicReviews, handleGetReviewEligibility, handleUpdateOwnReview, handleUpdateReviewStatus };
