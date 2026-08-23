import { DataTypes } from "sequelize";
import { sequelize } from "../config/databaseConfig.js";

const Table = sequelize.define(
  "Table",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    table_number: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    capacity: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("available", "occupied", "reserved", "out_of_service"),
      allowNull: false,
      defaultValue: "available",
    },
    qr_code_url: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  {
    tableName: "tables",
  },
);

export default Table;
