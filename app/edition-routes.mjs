import { z } from 'zod';
import { documentManifest, exportPreview, getEdition, publishEdition, snapshotDocument } from './editions.mjs';
import { editionSummary } from './queries.mjs';
import { manuscriptDocx, manuscriptMarkdown } from './exporter.mjs';
import { DomainError } from './domain.mjs';
import { assertReadScope, branchHeader } from './branch-scope.mjs';

const id = z.string().min(1).max(200);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const exportQuery = z.strictObject({ snapshotId: id.optional(), branchId: id.optional(), format: z.enum(['markdown', 'docx', 'manifest']).default('markdown') });
const publishSchema = z.strictObject({
  title: z.string().trim().min(1).max(200), snapshotId: id, expectedHead: id,
  approvedManifestHash: sha256, revisionOf: id.nullable(), approvedPreviousManifestHash: sha256.nullable(),
  decision: z.literal('publish'), policyVersion: z.literal(1),
});

async function exportResponse(context, document, options) {
  const filename = options.edition ? `novail-edition-${options.edition.id.slice(0, 8)}` : `novail-snapshot-${options.manifest.snapshotId.slice(-8)}`;
  context.header('Cache-Control', 'private, no-store');
  context.header('X-Novail-Manifest-Hash', options.manifest.manifestHash);
  switch (options.format) {
    case 'markdown':
      context.header('Content-Disposition', `attachment; filename="${filename}.md"`);
      return context.body(manuscriptMarkdown(document), 200, { 'content-type': 'text/markdown; charset=utf-8' });
    case 'docx':
      context.header('Content-Disposition', `attachment; filename="${filename}.docx"`);
      return context.body(new Uint8Array(await manuscriptDocx(document)), 200, { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    case 'manifest':
      context.header('Content-Disposition', `attachment; filename="${filename}.manifest.json"`);
      return context.json(options.edition ? { ...options.manifest, edition: options.edition } : options.manifest);
    default:
      throw new DomainError('SCHEMA_INVALID', '지원하지 않는 내보내기 형식입니다.', 422);
  }
}

export function mountEditionRoutes(app, { store, command }) {
  app.get('/api/export-preview', async (context) => {
    const query = z.strictObject({ snapshotId: id, branchId: id.optional() }).parse(context.req.query());
    const state = await store.read();
    assertReadScope(state, query.branchId ?? context.req.header(branchHeader));
    return context.json(exportPreview(state, query.snapshotId));
  });
  app.get('/api/export', async (context) => {
    const query = exportQuery.parse(context.req.query());
    const state = await store.read();
    assertReadScope(state, query.branchId ?? context.req.header(branchHeader));
    const snapshotId = query.snapshotId ?? state.head;
    const document = snapshotDocument(state, snapshotId);
    return exportResponse(context, document, { format: query.format, manifest: documentManifest(document, snapshotId) });
  });
  app.get('/api/editions', async (context) => context.json(((await store.read()).editions ?? []).map(editionSummary)));
  app.get('/api/editions/:id/export', async (context) => {
    const query = z.strictObject({ format: z.enum(['markdown', 'docx', 'manifest']).default('markdown') }).parse(context.req.query());
    const edition = getEdition(await store.read(), context.req.param('id'));
    return exportResponse(context, edition.document, { format: query.format, manifest: edition.manifest, edition: editionSummary(edition) });
  });
  app.get('/api/editions/:id', async (context) => {
    const edition = getEdition(await store.read(), context.req.param('id'));
    return context.json({ ...editionSummary(edition), manifest: edition.manifest });
  });
  app.post('/api/editions', async (context) => {
    let body;
    try { body = await context.req.json(); }
    catch (error) {
      if (error instanceof SyntaxError) throw new DomainError('SCHEMA_INVALID', '유효한 JSON 본문이 필요합니다.', 400);
      throw error;
    }
    const input = publishSchema.parse(body);
    return command(context, input, (state) => publishEdition(state, input));
  });
}
