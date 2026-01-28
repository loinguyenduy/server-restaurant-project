import { DataTypes } from "sequelize";
import { sequelize } from "../config/databaseConfig.js";

const Cart = sequelize.define(
  "Cart",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
    },
  },
  {
    tableName: "carts",
  },
);

export default Cart;
