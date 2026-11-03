import { Router, type Request } from "express";
import { z } from "zod";
import { authenticate, currentAuth } from "../../core/auth";
import { requireTenant, currentTenant } from "../../core/tenant";
import { requirePermission } from "../../core/rbac";
import { validate } from "../../core/validate";
import { prisma } from "../../core/prisma";
import { conflict, forbidden, notFound } from "../../core/errors";
import { cuidSchema } from "../../core/schemas";

// ─── Labels (organisation-wide) ──────────────────────────────────────────────

export const labelsRouter = Router();
labelsRouter.use(authenticate, requireTenant);

const labelBody = z.object({
  name: z.string({ error: "Name is required" }).trim().min(1, "Name is required").max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color must be a hex value").default("#64748b"),
});
const labelParams = z.object({ labelId: cuidSchema });

labelsRouter.get("/", requirePermission("tasks:read"), async (req, res) => {
  const { organizationId } = currentTenant(req);
  res.json(await prisma.label.findMany({ where: { organizationId }, orderBy: { name: "asc" } }));
});

labelsRouter.post("/", requirePermission("labels:manage"), validate({ body: labelBody }), async (req, res) => {
  const { organizationId } = currentTenant(req);
  if (await prisma.label.findFirst({ where: { organizationId, name: { equals: req.body.name, mode: "insensitive" } } })) {
    throw conflict("A label with that name already exists");
  }
  res.status(201).json(await prisma.label.create({ data: { organizationId, ...req.body } }));
});

labelsRouter.patch("/:labelId", requirePermission("labels:manage"), validate({ params: labelParams, body: labelBody.partial() }), async (req, res) => {
  const { organizationId } = currentTenant(req);
  const { count } = await prisma.label.updateMany({ where: { id: req.params.labelId as string, organizationId }, data: req.body });
  if (count === 0) throw notFound("Label not found");
  res.json(await prisma.label.findUnique({ where: { id: req.params.labelId as string } }));
});

labelsRouter.delete("/:labelId", requirePermission("labels:manage"), validate({ params: labelParams }), async (req, res) => {
  const { organizationId } = currentTenant(req);
  const { count } = await prisma.label.deleteMany({ where: { id: req.params.labelId as string, organizationId } });
  if (count === 0) throw notFound("Label not found");
  res.json({ message: "Label deleted" });
});

// ─── Saved views (personal, optionally shared with the org) ──────────────────

export const viewsRouter = Router();
viewsRouter.use(authenticate, requireTenant);

const viewBody = z.object({
  name: z.string({ error: "Name is required" }).trim().min(1).max(60),
  viewType: z.enum(["board", "list", "calendar", "gantt", "my-tasks"]),
  projectId: z.union([cuidSchema, z.null()]).optional(),
  // Opaque to the server; only ever used as query parameters for /tasks, which validates them
  filters: z.record(z.string(), z.union([z.string().max(200), z.array(z.string().max(100)).max(50), z.boolean(), z.null()])).default({}),
  shared: z.boolean().default(false),
});
const viewParams = z.object({ viewId: cuidSchema });
const viewsQuery = z.object({ projectId: cuidSchema.optional() });

const who = (req: Request) => ({ userId: currentAuth(req).userId, ...currentTenant(req) });

viewsRouter.get("/", validate({ query: viewsQuery }), async (req, res) => {
  const { organizationId, userId } = who(req);
  const { projectId } = res.locals.query as z.infer<typeof viewsQuery>;
  res.json(
    await prisma.savedView.findMany({
      where: { organizationId, OR: [{ userId }, { shared: true }], ...(projectId ? { projectId } : {}) },
      orderBy: { name: "asc" },
      include: { user: { select: { id: true, email: true, name: true } } },
    })
  );
});

viewsRouter.post("/", validate({ body: viewBody }), async (req, res) => {
  const { organizationId, userId } = who(req);
  if (req.body.projectId) {
    const project = await prisma.project.findFirst({ where: { id: req.body.projectId, organizationId } });
    if (!project) throw notFound("Project not found");
  }
  res.status(201).json(await prisma.savedView.create({ data: { ...req.body, organizationId, userId } }));
});

const ownView = async (req: Request) => {
  const { organizationId, userId, role } = who(req);
  // Someone else's private view behaves as if it doesn't exist
  const view = await prisma.savedView.findFirst({ where: { id: req.params.viewId as string, organizationId, OR: [{ userId }, { shared: true }] } });
  if (!view) throw notFound("View not found");
  if (view.userId !== userId && role !== "ORG_ADMIN") throw forbidden("You can only change your own views");
  return view;
};

viewsRouter.patch("/:viewId", validate({ params: viewParams, body: viewBody.partial() }), async (req, res) => {
  const view = await ownView(req);
  res.json(await prisma.savedView.update({ where: { id: view.id }, data: req.body }));
});

viewsRouter.delete("/:viewId", validate({ params: viewParams }), async (req, res) => {
  const view = await ownView(req);
  await prisma.savedView.delete({ where: { id: view.id } });
  res.json({ message: "View deleted" });
});
