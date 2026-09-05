import { DataTypes } from "sequelize";
import { sequelize } from "../config/databaseConfig.js";

const User = sequelize.define(
  "User",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: { isEmail: true },
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    username: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    full_name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    gender: {
      type: DataTypes.ENUM("male", "female", "other"),
      allowNull: true,
      defaultValue: "other",
      validate: {
        isIn: {
          args: [["male", "female", "other"]],
          msg: "Gender must be male, female, or other.",
        },
      }
    },
    phone_number: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        is: {
          args: /^[0-9]+$/,
          msg: "Phone number must only contain numbers."
        }
      }
    },
    role: {
      type: DataTypes.ENUM("admin", "staff", "customer"),
      defaultValue: "customer",
      validate: {
        isIn: {
          args: [["admin", "staff", "customer"]],
          msg: "Role must be admin, staff, or customer.",
        },
      },
    },
    avatar_url: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true, 
    },
  },
  {
    tableName: "users",
  },
);

export default User;
