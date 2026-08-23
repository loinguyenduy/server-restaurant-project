import { verifyToken } from "../services/jwtService.js";
import { User } from "../models/index.js";

// Access tokens are sent through the Authorization header.
const extractToken = (req) => {
  if (
    req.headers.authorization &&
    req.headers.authorization.split(" ")[0] === "Bearer"
  ) {
    return req.headers.authorization.split(" ")[1];
  }
  return null;
};

//Check valid of token
const checkUserJWT = async (req, res, next) => {
  try {
    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({
        EM: "Not authenticated the user (Missing Token)",
        EC: 401,
        DT: "",
      });
    }

    const verification = verifyToken(token);

    if (verification.isValid) {
      const user = await User.findByPk(verification.decoded.id, {
        attributes: ["id", "email", "username", "role", "is_active"],
      });

      if (!user || !user.is_active) {
        return res.status(401).json({
          EM: "Your account is unavailable or has been locked.",
          EC: 401,
          DT: "",
        });
      }

      req.user = user.get({ plain: true });
      next();
    } else {
      return res.status(401).json({
        EM: "Not authenticated the user (Invalid or Expired Token)",
        EC: 401,
        DT: "",
      });
    }
  } catch (error) {
    console.log("Error in checkUserJWT middleware:", error);
    return res.status(500).json({
      EM: "Something went wrong at the gateway...",
      EC: 500,
      DT: "",
    });
  }
};

//Authorize role
const checkUserPermission = (allowedRoles) => {
  return (req, res, next) => {
    try {
      if (req.user && req.user.role) {
        if (allowedRoles.includes(req.user.role)) {
          next();
        } else {
          return res.status(403).json({
            EM: "You don't have permission to access this resource",
            EC: 403,
            DT: "",
          });
        }
      } else {
        return res.status(401).json({
          EM: "Not authenticated the user",
          EC: 401,
          DT: "",
        });
      }
    } catch (error) {
      console.log("Error in checkUserPermission:", error);
      return res.status(500).json({ EM: "Server Error", EC: 500 });
    }
  };
};

export { checkUserJWT, checkUserPermission };
