import { DataTypes } from "sequelize";
import { sequelize } from "../config/databaseConfig.js";

const Review = sequelize.define("Review", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  user_id: { type: DataTypes.UUID, allowNull: false },
  order_id: { type: DataTypes.UUID, allowNull: false, unique: true },
  rating: { type: DataTypes.TINYINT, allowNull: false, validate: { min: 1, max: 5, isInt: true } },
  comment: { type: DataTypes.STRING(1000), allowNull: false },
  status: { type: DataTypes.ENUM("visible", "hidden"), allowNull: false, defaultValue: "visible" },
}, {
  tableName: "reviews",
  indexes: [
    { fields: ["status", "created_at"] },
    { fields: ["user_id", "created_at"] },
    { fields: ["status", "rating"] },
  ],
});

export default Review;
