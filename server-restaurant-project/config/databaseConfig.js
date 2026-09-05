import { Sequelize } from "sequelize";
import dotenv from "dotenv";

dotenv.config();

const commonOptions = {
  logging: false,
  define: {
    timestamps: true,
    underscored: true,
  },
};

const railwayMySqlUrl = process.env.MYSQL_URL?.trim();
const configuredPort = Number.parseInt(process.env.DB_PORT, 10);

if (process.env.NODE_ENV === "production" && !railwayMySqlUrl) {
  throw new Error("MYSQL_URL is required when NODE_ENV is production.");
}

const sequelize = railwayMySqlUrl
  ? new Sequelize(railwayMySqlUrl, commonOptions)
  : new Sequelize(
      process.env.DB_NAME,
      process.env.DB_USER,
      process.env.DB_PASSWORD,
      {
        ...commonOptions,
        host: process.env.DB_HOST || "localhost",
        port: Number.isInteger(configuredPort) ? configuredPort : 3306,
        dialect: process.env.DB_DIALECT || "mysql",
      },
    );

const connectDB = async () => {
  try {
    await sequelize.authenticate();
    console.log("Connection has been established successfully.");
  } catch (error) {
    console.error("Unable to connect to the database:", error.message);
    throw error;
  }
};

export { sequelize, connectDB };
