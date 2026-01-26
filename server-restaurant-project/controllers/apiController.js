const testApi = (req, res) => {
  console.log("test api success");
  return res.status(200).json({
    message: "ok",
    data: "test api",
  });
};

const apiController = {
  testApi,
};

export default apiController;
