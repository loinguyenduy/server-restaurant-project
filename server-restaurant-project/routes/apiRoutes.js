import express from "express";
import categoryRoute from "./categoryRoute.js";

const router = express.Router();
const apiRoutes = (app) => {
  //category routes
  router.use("/", categoryRoute);
  


  
  return app.use("/api/v1/", router);
};

export default apiRoutes;
