import {
  handleLoginUser,
  handleRefreshToken,
  handleRegisterUser,
} from "../services/authService.js";
import dotenv from "dotenv";
dotenv.config();

const isProduction = process.env.NODE_ENV === "production";
const refreshTokenMaxAge =
  Number(process.env.COOKIE_REFRESH_MAX_AGE) || 7 * 24 * 60 * 60 * 1000;
const refreshTokenCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? "none" : "lax",
  maxAge: refreshTokenMaxAge,
  path: "/",
};
const refreshTokenClearOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? "none" : "lax",
  path: "/",
};

const getResponseStatus = (data) => {
  if (data.EC === 0) return 200;
  return [400, 401, 403, 404, 409].includes(data.EC) ? data.EC : 500;
};

const registerNewUser = async (req, res) => {
  try {
    // Check missing input fields
    if (
      !req.body.email ||
      !req.body.password ||
      !req.body.full_name ||
      !req.body.username
    ) {
      return res.status(400).json({
        EM: "Missing required parameters.",
        EC: 400,
        DT: [],
      });
    }

    //Check length of password
    if (req.body.password && req.body.password.length < 6) {
      return res.status(400).json({
        EM: "Your password must be at least 6 characters long.",
        EC: 400,
        DT: [],
      });
    }

    let data = await handleRegisterUser(req.body);
    return res.status(getResponseStatus(data)).json({
      EM: data.EM,
      EC: data.EC,
      DT: data.DT || [],
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

const loginUser = async (req, res) => {
  try {
    //Check missing input
    if (!req.body.valueLogin || !req.body.password) {
      return res.status(400).json({
        EM: "Missing your account or password.",
        EC: 400,
        DT: "",
      });
    }

    let data = await handleLoginUser(req.body);
    // console.log("check data: ", data)

    if (data && data.EC === 0) {
      res.cookie(
        "refreshToken",
        data.DT.refreshToken,
        refreshTokenCookieOptions,
      );

      delete data.DT.refreshToken;

      // console.log("check data after delete: ", data)
    }

    return res.status(getResponseStatus(data)).json({
      EM: data.EM,
      EC: data.EC,
      DT: data.DT,
    });
  } catch (error) {
    console.log("Error in loginUser server: ", error);
    return res.status(500).json({
      EM: "Something wrongs in server...",
      EC: 500,
      DT: [],
    });
  }
};

const requestRefreshToken = async (req, res) => {
  try {
    const cookieToken = req.cookies.refreshToken;

    if (!cookieToken) {
      return res.status(401).json({
        EM: "No refresh token found. Please login again.",
        EC: 401,
        DT: "",
      });
    }

    let data = await handleRefreshToken(cookieToken);

    if (data && data.EC === 0) {
      res.cookie(
        "refreshToken",
        data.DT.refreshToken,
        refreshTokenCookieOptions,
      );

      delete data.DT.refreshToken;
    } else {
      res.clearCookie("refreshToken", refreshTokenClearOptions);
    }

    return res.status(getResponseStatus(data)).json({
      EM: data.EM,
      EC: data.EC,
      DT: data.DT,
    });
  } catch (error) {
    console.log("Error in requestRefreshToken server: ", error);
    return res.status(500).json({
      EM: "Something wrongs in server...",
      EC: 500,
      DT: "",
    });
  }
};

const logoutUser = async (req, res) => {
  try {
    res.clearCookie("refreshToken", refreshTokenClearOptions);
    
    return res.status(200).json({
      EM: "Logout successfully.",
      EC: 0,
      DT: "",
    });
  } catch (error) {
    console.log("Error in logoutUser server: ", error);
    return res.status(500).json({
      EM: "Something wrongs in server...",
      EC: 500,
      DT: "",
    });
  }
};
export { registerNewUser, loginUser, requestRefreshToken, logoutUser };
