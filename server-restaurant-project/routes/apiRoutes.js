import express from "express";
import categoryRoute from "./categoryRoute.js";
import productRoute from "./productRoute.js";
import authRoute from "./authRoute.js";
import cartRoute from "./cartRoute.js"
import payosRoute from "./payosRoute.js"
import orderRoute from "./orderRoute.js"
import reservationRoute from "./reservationRoute.js"

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
  //payos routes
  router.use("/", payosRoute)
  //order routes
  router.use("/", orderRoute)
  //reservation routes
  router.use("/", reservationRoute)


  return app.use("/api/v1/", router);
};

export default apiRoutes;
