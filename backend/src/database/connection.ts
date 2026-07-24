import mysql from "mysql2/promise";
import { config } from "../config.js";

export const db = mysql.createPool({
  host: config.DB_HOST,
  port: config.DB_PORT,
  database: config.DB_NAME,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  connectionLimit: 10,
  decimalNumbers: true
});
