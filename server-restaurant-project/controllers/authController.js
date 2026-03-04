import { handleRegisterUser } from "../services/authService.js";

const registerNewUser = async (req, res) => {
  try {
    // Check missing input fields
    if (!req.body.email || !req.body.password || !req.body.full_name || !req.body.username) {
      return res.status(400).json({
        EM: "Missing required parameters.",
        EC: 400,
        DT: [],
      });
    }

    //Check length of password
    if (req.body.password && req.body.password.length < 6) {
      return res.status(400).json({
        EM: "Your password must have more than 6 letters.",
        EC: 400,
        DT: [],
      });
    }

    let data = await handleRegisterUser(req.body);
    return res.status(200).json({
      EM: data.EM,
      EC: data.EC,
      DT: [],
    });
  } catch (error) {
    console.log("Error in registerNewUser server: ", error);
    return res.status(500).json({
      EM: "Something wrongs in server...",
      EC: 500,
      DT: [],
    });
  }
};

export { registerNewUser };
