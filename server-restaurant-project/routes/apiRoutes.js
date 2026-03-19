import express from "express";
import categoryRoute from "./categoryRoute.js";
import productRoute from "./productRoute.js";
import authRoute from "./authRoute.js";
import cartRoute from "./cartRoute.js"

const router = express.Router();
const apiRoutes = (app) => {
  //category routes
  router.use("/", categoryRoute);
  //product routes
  router.use("/", productRoute);
  //auth routes
  router.use("/", authRoute);
  //cart routes
  router.use("/", cartRoute)

  return app.use("/api/v1/", router);
};

export default apiRoutes;
