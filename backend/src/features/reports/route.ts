import { Router } from "express";
import { db } from "../../database/connection.js";
import { authenticate, authorize } from "../../shared/auth.js";
import { HttpError } from "../../shared/http.js";
import { reportQuerySchema } from "./model.js";
import { getReport } from "./query.js";

const router = Router();
router.get("/", authenticate, authorize("ADMIN"), async (req, res, next) => {
  const parsed = reportQuerySchema.safeParse(req.query);
  if (!parsed.success)
    return next(
      new HttpError(
        400,
        "Choose a valid report period and date or month",
        parsed.error.flatten(),
      ),
    );
  let connection;
  try {
    connection = await db.getConnection();
    await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await connection.beginTransaction();
    const data = await getReport(connection, parsed.data);
    await connection.commit();
    res.json({ data });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
});
export default router;
