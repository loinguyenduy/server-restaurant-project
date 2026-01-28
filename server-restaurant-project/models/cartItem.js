import { DataTypes } from "sequelize";
import { sequelize } from "../config/databaseConfig.js";

const CartItem = sequelize.define(
  "CartItem",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    cart_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    product_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    quantity: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
    },
  },
  {
    tableName: "cart_items",
  },
);
export default CartItem;
