import type { RequestHandler } from "express";
import type { z } from "zod";

interface Schemas {
  body?: z.ZodType;
  params?: z.ZodType;
  query?: z.ZodType;
}

/**
 * Validates and normalises request input. Parsed values replace the raw ones,
 * so handlers only ever see data that matched the schema (unknown keys are stripped).
 * Parsed query is exposed on res.locals.query because Express 5 makes req.query read-only.
 */
export const validate =
  (schemas: Schemas): RequestHandler =>
  (req, res, next) => {
    if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params;
    if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
    if (schemas.query) res.locals.query = schemas.query.parse(req.query);
    next();
  };
