import { Router, type Request } from "express";
import { z } from "zod";
import { authenticate, currentAuth } from "../../core/auth";
import { requireTenant, currentTenant } from "../../core/tenant";
import { validate } from "../../core/validate";
import { cuidSchema } from "../../core/schemas";
import type { Actor } from "../../core/access";
import * as fields from "./fields.service";

/** Mounted at /projects/:projectId/fields */
export const fieldsRouter = Router({ mergeParams: true });
fieldsRouter.use(authenticate, requireTenant);

const actor = (req: Request): Actor => ({ userId: currentAuth(req).userId, tenant: currentTenant(req) });
const projectParams = z.object({ projectId: cuidSchema });
const fieldParams = z.object({ projectId: cuidSchema, fieldId: cuidSchema });
const pid = (req: Request) => req.params.projectId as string;

fieldsRouter.get("/", validate({ params: projectParams }), async (req, res) => {
  res.json(await fields.listFields(actor(req), pid(req)));
});
fieldsRouter.post("/", validate({ params: projectParams, body: fields.fieldBody }), async (req, res) => {
  res.status(201).json(await fields.createField(req, actor(req), pid(req), req.body));
});
fieldsRouter.patch("/:fieldId", validate({ params: fieldParams, body: fields.fieldUpdateBody }), async (req, res) => {
  res.json(await fields.updateField(req, actor(req), pid(req), req.params.fieldId as string, req.body));
});
fieldsRouter.delete("/:fieldId", validate({ params: fieldParams }), async (req, res) => {
  await fields.deleteField(req, actor(req), pid(req), req.params.fieldId as string);
  res.json({ message: "Field deleted" });
});
