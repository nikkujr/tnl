import type { ErrorRequestHandler, RequestHandler } from "express";
import type { ZodType } from "zod";

export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly details?: unknown) {
    super(message);
  }
}

export const validate = (schema: ZodType): RequestHandler => (req, _res, next) => {
  const result = schema.safeParse({ body: req.body, query: req.query, params: req.params });
  if (!result.success) return next(new HttpError(400, "Validation failed", result.error.flatten()));
  const validated = result.data as { body?: unknown };
  if (validated.body !== undefined) req.body = validated.body;
  next();
};

export const notFound: RequestHandler = (_req, _res, next) => next(new HttpError(404, "Route not found"));

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: { message: error.message, details: error.details } });
    return;
  }
  console.error(error);
  res.status(500).json({ error: { message: "Unexpected server error" } });
};
