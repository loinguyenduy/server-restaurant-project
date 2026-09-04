import { DataTypes } from "sequelize";
import { sequelize } from "../config/databaseConfig.js";

const OrderItem = sequelize.define(
  "OrderItem",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    order_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    product_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    product_name: {
      type: DataTypes.STRING(150),
      allowNull: true,
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    prep_time_minutes: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: {
        min: 1,
        max: 180,
      },
    },
    kitchen_batch_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    kitchen_status: {
      type: DataTypes.ENUM("confirmed", "preparing", "ready"),
      allowNull: true,
    },
  },
  {
    tableName: "order_items",
    indexes: [
      { fields: ["order_id", "kitchen_batch_id", "kitchen_status"] },
    ],
  },
);

export default OrderItem;
