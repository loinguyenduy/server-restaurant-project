import dotenv from "dotenv"
import jwt from "jsonwebtoken"

dotenv.config()

const createAccessToken = (payload) => {
  try {
    const accessToken = jwt.sign(payload, process.env.JWT_ACCESS_SECRET, {
      expiresIn: process.env.JWT_ACCESS_EXPIRES_IN,
    });
    return accessToken;
  } catch (error) {
    console.log("Error in createAccessToken:", error);
    return null;
  }
};

const createRefreshToken = (payload) => {
  try {
    const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN,
    });
    return refreshToken;
  } catch (error) {
    console.log("Error in createRefreshToken:", error);
    return null;
  }
};

const verifyToken = (token, isRefreshToken = false) => {
  try {
    const secretKey = isRefreshToken 
        ? process.env.JWT_REFRESH_SECRET 
        : process.env.JWT_ACCESS_SECRET;

    const decoded = jwt.verify(token, secretKey);
    // console.log("Decoded: ", decoded)
    
    return {
        isValid: true,
        decoded: decoded 
    };
  } catch (error) {
    console.log(`JWT Verify Error (${isRefreshToken ? 'Refresh' : 'Access'}):`, error.message);
    return {
        isValid: false,
        error: error.message
    };
  }
};



export {
  createAccessToken, createRefreshToken, verifyToken
}