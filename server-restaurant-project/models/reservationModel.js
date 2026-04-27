import { DataTypes } from "sequelize";
import { sequelize } from "../config/databaseConfig.js";

const Reservation = sequelize.define(
  "Reservation",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    table_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    reservation_time: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    number_of_people: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("pending", "confirmed", "cancelled", "completed"),
      defaultValue: "pending",
    },
  contact_name: {
    type: DataTypes.STRING,
    allowLength: false, 
  },
  contact_phone: {
    type: DataTypes.STRING,
    allowLength: false,
  },
  note: {
    type: DataTypes.TEXT,
    allowLength: true,
  }
  },
  {
    tableName: "reservations",
  },
);

export default Reservation;
