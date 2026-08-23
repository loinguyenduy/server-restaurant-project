import { DataTypes } from "sequelize";
import { sequelize } from "../config/databaseConfig.js";

const OrderStatusHistory = sequelize.define(
  "OrderStatusHistory",
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
    from_status: {
      type: DataTypes.STRING(30),
      allowNull: true,
    },
    to_status: {
      type: DataTypes.STRING(30),
      allowNull: false,
    },
    changed_by: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    note: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
  },
  {
    tableName: "order_status_histories",
    indexes: [{ fields: ["order_id", "created_at"] }],
  },
);

export default OrderStatusHistory;
