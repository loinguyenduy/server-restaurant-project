import express from "express";
import categoryRoute from "./categoryRoute.js";
import productRoute from "./productRoute.js";

const router = express.Router();
const apiRoutes = (app) => {
  //category routes
  router.use("/", categoryRoute);
  //product routes
  router.use("/", productRoute);

  return app.use("/api/v1/", router);
};

export default apiRoutes;
