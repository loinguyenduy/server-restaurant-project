import bcrypt from "bcryptjs";
import { User } from "../models/index.js";
import { Op } from "sequelize";

//Hash password
const hashUserPassword = async (userPassword) => {
  const salt = bcrypt.genSaltSync(10);
  return await bcrypt.hash(userPassword, salt);
};

const checkExistingData = async (email, username, phone) => {
  const orConditions = [];
  if (email) orConditions.push({ email: email });
  if (username) orConditions.push({ username: username });
  if (phone) orConditions.push({ phone_number: phone });

  if (orConditions.length === 0) return null;

  let user = await User.findOne({
    where: {
      [Op.or]: orConditions,
    },
  });

  if (user) {
    if (user.email === email) return "email";
    if (user.username === username) return "username";
    if (user.phone_number === phone) return "phone number";
  }
  return null;
};

//Check existing email
// const checkExistingEmail = async (userEmail) => {
//   let user = await User.findOne({
//     where: { email: userEmail },
//   });

//   if (user) {
//     return true;
//   }
//   return false;
// };

// //Check existing phone number
// const checkExistingPhone = async (userPhone) => {
//   let user = await User.findOne({
//     where: { phone_number: userPhone },
//   });

//   if (user) {
//     return true;
//   }
//   return false;
// };

// //Check existing username
// const checkExistingUsername = async (userUsername) => {
//   let user = await User.findOne({
//     where: { username: userUsername },
//   });

//   if (user) {
//     return true;
//   }
//   return false;
// };

const handleRegisterUser = async (rawUserData) => {
  try {
    //Check existing email, phone number
    // let isEmailExist = await checkExistingEmail(rawUserData.email);
    // if (isEmailExist === true) {
    //   return {
    //     EM: "This email is already exist.",
    //     EC: 409,
    //   };
    // }

    // let isUsernameExist = await checkExistingUsername(rawUserData.username);
    // if (isUsernameExist === true) {
    //   return {
    //     EM: "This username is already exist.",
    //     EC: 409,
    //   };
    // }

    // let isPhoneExist = await checkExistingPhone(rawUserData.phone_number);
    // if (isPhoneExist === true) {
    //   return {
    //     EM: "This phone number is already exist.",
    //     EC: 409,
    //   };
    // }
    const isExistData = await checkExistingData(
      rawUserData.email,
      rawUserData.username,
      rawUserData.phone_number,
    );

    if (isExistData) {
      return {
        EM: `This ${isExistData} is already exist.`,
        EC: 409,
      };
    }

    //Hash password
    let hashPassword = await hashUserPassword(rawUserData.password);
    //Register user
    const userData = {
      email: rawUserData.email,
      password: hashPassword,
      username: rawUserData.username,
      full_name: rawUserData.full_name,
      gender: rawUserData.gender,
      phone_number: rawUserData.phone_number || null,
      role: "customer",
      avatar_url: rawUserData.avatar_url || null,
    };

    if (rawUserData.gender && rawUserData.gender.trim() !== "") {
      userData.gender = rawUserData.gender;
    }

    await User.create(userData);

    return {
      EM: "User account is created successfully.",
      EC: 0,
    };
  } catch (error) {
    console.log("Something wrongs in handleRegisterUser: ", error);

    if (error.name === "SequelizeValidationError") {
      return {
        EM: error.errors[0].message,
        EC: 400,
      };
    }

    return {
      EM: "Something wrongs in service...",
      EC: 500,
    };
  }
};

export { handleRegisterUser };
