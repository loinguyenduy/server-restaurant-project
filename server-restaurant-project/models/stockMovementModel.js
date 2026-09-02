import { DataTypes } from "sequelize";
import { sequelize } from "../config/databaseConfig.js";

const StockMovement = sequelize.define("StockMovement", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  product_id: { type: DataTypes.UUID, allowNull: false },
  type: {
    type: DataTypes.ENUM("RESTOCK", "SALE", "ORDER_CANCELLATION", "MANUAL_ADJUSTMENT"),
    allowNull: false,
  },
  quantity_change: { type: DataTypes.INTEGER, allowNull: false },
  stock_before: { type: DataTypes.INTEGER, allowNull: false },
  stock_after: { type: DataTypes.INTEGER, allowNull: false },
  reference_type: { type: DataTypes.ENUM("ORDER", "PRODUCT"), allowNull: true },
  reference_id: { type: DataTypes.UUID, allowNull: true },
  note: { type: DataTypes.STRING(500), allowNull: true },
  created_by: { type: DataTypes.UUID, allowNull: true },
}, {
  tableName: "stock_movements",
  updatedAt: false,
  indexes: [
    { fields: ["product_id", "created_at"] },
    { fields: ["type", "created_at"] },
    { fields: ["reference_type", "reference_id"] },
    { fields: ["created_by"] },
  ],
});

export default StockMovement;
