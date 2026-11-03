import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { logger } from "./logger";

/**
 * Error with an HTTP status and a stable machine-readable code.
 * Throw it from services/controllers; the central handler turns it into JSON.
 * The `message` is shown to clients, so never put internal details in it.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, "BAD_REQUEST", message, details);
export const unauthorized = (message = "Authentication required", code = "UNAUTHORIZED") =>
  new AppError(401, code, message);
export const forbidden = (message = "You do not have permission to perform this action") =>
  new AppError(403, "FORBIDDEN", message);
export const notFound = (message = "Resource not found") =>
  new AppError(404, "NOT_FOUND", message);
export const conflict = (message: string) => new AppError(409, "CONFLICT", message);

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(notFound("Route not found"));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({
      message: err.message,
      code: err.code,
      ...(err.details ? { details: err.details } : {}),
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      message: err.issues[0]?.message ?? "Invalid request",
      code: "VALIDATION_ERROR",
      details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
    return;
  }

  // Malformed JSON body from express.json()
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ message: "Malformed JSON body", code: "BAD_JSON" });
    return;
  }
  if (err?.type === "entity.too.large") {
    res.status(413).json({ message: "Request body too large", code: "PAYLOAD_TOO_LARGE" });
    return;
  }

  logger.error({ err, method: req.method, url: req.originalUrl }, "Unhandled error");
  res.status(500).json({ message: "Internal Server Error", code: "INTERNAL_ERROR" });
};
