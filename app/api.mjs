import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { z } from "zod";
import { mountRunRoutes } from "../packages/execution/routes.mjs";
import {
  checkReadiness, checkTemporalConstraints, readinessSchema, spanSchema,
  temporalEdgeSchema, validateSpan,
} from "../packages/domain/narrative.ts";

import {
  DomainError, addCandidate, addFeedback, addPlan, addScene, commitCandidate,
  protectQuote, publicState, rejectCandidate, restoreSnapshot,
  saveDraft, switchProject, updateProject,
} from "./domain.mjs";
import { generateCandidate } from "./gateway.mjs";
import { buildGenerationContext } from "./readiness.mjs";
import { mountEditionRoutes } from "./edition-routes.mjs";
import { createCommandHandler, prepareCommand } from "./commands.mjs";
import { mountBranchRoutes } from "./branch-routes.mjs";
import { mountRevisionRoutes } from "./change-set-routes.mjs";
import { mountRepairRoutes } from "./repair-routes.mjs";
import { mountMergeRoutes } from "./merge-routes.mjs";
import { mountEvaluationReportRoutes } from "./evaluation-report-routes.mjs";
import { mountProviderRoutes } from "./provider-routes.mjs";
import { assertReadScope, branchHeader } from "./branch-scope.mjs";
import { runtimeInfo } from "../packages/execution/public-contract.mjs";

const id = z.string().min(1).max(200);
const text = z.string().min(1).max(200_000);
const emptySchema = z.strictObject({});
const timelineSchema = z.strictObject({ edges: z.array(temporalEdgeSchema).max(10_000) });
const readonlyPosts = new Set(["/api/readiness", "/api/evidence/validate", "/api/timeline/check"]);
const schemas = {
  draft: z.strictObject({ text, baseSnapshotId: id }),
  protect: z.strictObject({ quote: z.string().min(1).max(10_000) }),
  feedback: z.strictObject({ sceneId: id, text: z.string().min(1).max(20_000), scope: z.enum(["scene", "chapter", "project"]) }),
  candidate: z.strictObject({
    sceneId: id,
    feedbackId: id.optional(),
    instruction: z.string().min(1).max(20_000),
    proposedText: text.optional(),
    baseSnapshotId: id,
  }),
  commit: z.strictObject({ expectedHead: id, hash: z.string().regex(/^[a-f0-9]{64}$/) }),
  restore: z.strictObject({ snapshotId: id, expectedHead: id }),
  plan: z.strictObject({ title: z.string().min(1).max(500), kind: z.string().min(1).max(100), description: z.string().min(1).max(20_000) }),
  project: z.strictObject({ title: z.string().min(1).max(500), direction: z.string().min(1).max(5_000) }),
  scene: z.strictObject({ title: z.string().min(1).max(500), text }),
};

const parseBody = async (context, schema) => {
  let body;
  try {
    body = await context.req.json();
  } catch {
    throw new DomainError("SCHEMA_INVALID", "The request body must be valid JSON.", 400);
  }
  return schema.parse(body);
};

export const createApp = ({ store, distRoot = "./dist", worker }) => {
  const app = new Hono();
  const command = createCommandHandler(store);
  const readScoped = async (context) => {
    const state = await store.read();
    assertReadScope(state, context.req.header(branchHeader));
    return state;
  };

  app.onError((error, context) => {
    if (error instanceof DomainError) return context.json({ error: { code: error.code, message: error.message } }, error.status);
    if (error instanceof z.ZodError) return context.json({ error: { code: "SCHEMA_INVALID", message: z.prettifyError(error) } }, 400);
    return context.json({ error: { code: "INTERNAL_ERROR", message: "The request could not be processed." } }, 500);
  });

  app.use("/api/*", async (context, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(context.req.method) || readonlyPosts.has(context.req.path)) return next();
    const origin = context.req.header("Origin");
    const host = context.req.header("Host") ?? new URL(context.req.url).host;
    let originHost;
    try {
      originHost = origin ? new URL(origin).host : undefined;
    } catch {
      throw new DomainError("SCHEMA_INVALID", "The Origin header is invalid.", 400);
    }
    const configuredOrigin = process.env.APP_ORIGIN?.replace(/\/$/, "");
    const crossOrigin = Boolean(origin && originHost !== host && origin.replace(/\/$/, "") !== configuredOrigin)
      || context.req.header("Sec-Fetch-Site") === "cross-site";
    if (!crossOrigin) return next();
    const token = process.env.APP_TOKEN;
    if (!token || context.req.header("Authorization") !== `Bearer ${token}`) {
      return context.json({ error: { code: "UNAUTHORIZED", message: "Cross-origin changes require a server token." } }, 401);
    }
    return next();
  });

  app.get("/health", (context) => context.json({ ok: true, persistence: store.constructor.name === "PostgresStore" ? "postgresql" : "local-file-single-user" }));
  app.get("/api/runtime-info", (context) => context.json(runtimeInfo()));
  app.get("/api/state", async (context) => context.json(publicState(await store.read())));
  app.get("/api/scenes", async (context) => context.json((await readScoped(context)).scenes));
  app.get("/api/plans", async (context) => context.json((await readScoped(context)).plans));
  app.get("/api/projects/:id", async (context) => {
    const state = await store.read();
    const project = state.project.id === context.req.param("id")
      ? state.project
      : state.workspaces.find((workspace) => workspace.project.id === context.req.param("id"))?.project;
    if (!project) throw new DomainError("NOT_FOUND", "Project not found.", 404);
    return context.json(project);
  });
  app.post("/api/readiness", async (context) => context.json(checkReadiness(await parseBody(context, readinessSchema))));
  app.post("/api/evidence/validate", async (context) => context.json(validateSpan(await parseBody(context, spanSchema))));
  app.post("/api/timeline/check", async (context) => {
    const body = await parseBody(context, timelineSchema);
    return context.json(checkTemporalConstraints(body.edges));
  });

  app.post("/api/scenes/:id/draft", async (context) => {
    const body = await parseBody(context, schemas.draft);
    return command(context, { body, status: 200 }, (state) => saveDraft(state, context.req.param("id"), body));
  });
  app.post("/api/scenes/:id/protect", async (context) => {
    const body = await parseBody(context, schemas.protect);
    return command(context, { body, status: 200 }, (state) => protectQuote(state, context.req.param("id"), body));
  });
  app.post("/api/feedback", async (context) => {
    const body = await parseBody(context, schemas.feedback);
    return command(context, { body, status: 201 }, (state) => addFeedback(state, body));
  });
  app.post("/api/candidates", async (context) => {
    const body = await parseBody(context, schemas.candidate);
    const prepared = await prepareCommand(store, context, { body });
    if (prepared.replay) return context.json(prepared.replay.result, prepared.replay.status);
    const before = prepared.state;
    const generationContext = buildGenerationContext(before, body);
    const maxOutputTokens = Number(process.env.OPENAI_MAX_OUTPUT_TOKENS ?? 4_096);
    if (!body.proposedText && process.env.OPENAI_API_KEY) {
      throw new DomainError("USE_RUN_ENGINE", "Request live provider generation through an /api/runs job.", 409);
    }
    const generated = await generateCandidate({
      scene: generationContext.scene,
      instruction: body.instruction,
      proposedText: body.proposedText,
      maxOutputTokens,
      plans: generationContext.plans,
      reviewExcerpts: generationContext.reviewExcerpts,
    });
    return command(context, { body, status: 201 }, (state) => addCandidate(state, {
      input: body,
      proposedText: generated.text,
      adapterLabel: generated.adapterLabel,
      contextHash: generationContext.contextHash,
      contextVersion: before.contextVersion ?? 0,
      branchId: prepared.scope.branchId,
    }));
  });
  app.post("/api/candidates/:id/commit", async (context) => {
    const body = await parseBody(context, schemas.commit);
    return command(context, { body, status: 200 }, (state) => commitCandidate(state, context.req.param("id"), body));
  });
  app.post("/api/candidates/:id/reject", async (context) => {
    const body = await parseBody(context, emptySchema);
    return command(context, { body, status: 200 }, (state) => rejectCandidate(state, context.req.param("id")));
  });
  app.post("/api/restore", async (context) => {
    const body = await parseBody(context, schemas.restore);
    return command(context, { body, status: 200 }, (state) => restoreSnapshot(state, body));
  });
  app.post("/api/plans", async (context) => {
    const body = await parseBody(context, schemas.plan);
    return command(context, { body, status: 201 }, (state) => addPlan(state, body));
  });
  app.post("/api/projects", async (context) => {
    const body = await parseBody(context, schemas.project);
    return command(context, { body, status: 201 }, (state) => updateProject(state, body));
  });
  app.post("/api/projects/:id/switch", async (context) => {
    const body = await parseBody(context, emptySchema);
    return command(context, { body, status: 200 }, (state) => switchProject(state, context.req.param("id")));
  });
  app.post("/api/scenes", async (context) => {
    const body = await parseBody(context, schemas.scene);
    return command(context, { body, status: 201 }, (state) => addScene(state, body));
  });

  if (worker) mountRunRoutes(app, { store, worker });
  mountEditionRoutes(app, { store, command: (context, input, operation) => command(context, { body: input, status: 201 }, operation) });
  mountBranchRoutes(app, { store, command });
  mountRevisionRoutes(app, { store, command });
  mountEvaluationReportRoutes(app, { store, command });
  mountProviderRoutes(app);
  mountRepairRoutes(app, { store });
  mountMergeRoutes(app, { store, command });

  app.all("/api/*", (context) => context.json({ error: { code: "NOT_FOUND", message: "API route not found." } }, 404));

  app.use("/*", serveStatic({ root: distRoot }));
  app.get("/*", serveStatic({ path: `${distRoot}/index.html` }));
  return app;
};
