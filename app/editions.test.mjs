import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { createApp } from './api.mjs';
import { FileStore } from './store.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'novail-editions-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new FileStore(join(directory, 'state.json'));
  await store.initialize();
  const app = createApp({ store, distRoot: directory });
  const post = (path, body, key = crypto.randomUUID()) => app.request(path, {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body),
  });
  const state = await store.read();
  return { app, store, post, state };
}

async function approval(app, state, title = '초판') {
  const response = await app.request(`/api/export-preview?snapshotId=${state.head}`);
  assert.equal(response.status, 200);
  const preview = await response.json();
  return { title, snapshotId: state.head, expectedHead: state.head, approvedManifestHash: preview.manifestHash,
    revisionOf: preview.latestEdition?.id ?? null, approvedPreviousManifestHash: preview.latestEdition?.manifestHash ?? null,
    decision: 'publish', policyVersion: 1 };
}

test('preview identifies the selected snapshot without publishing or changing head', async (t) => {
  const { app, store, state } = await fixture(t);
  const response = await app.request(`/api/export-preview?snapshotId=${state.head}`);
  assert.equal(response.status, 200);
  const preview = await response.json();
  assert.equal(preview.sceneCount, 7);
  assert.match(preview.manifestHash, /^[a-f0-9]{64}$/);
  assert.equal((await store.read()).head, state.head);
  assert.equal((await app.request('/api/state').then((r) => r.json())).editions.length, 0);
});

test('publishing requires an explicit content-bound decision and records audit/outbox atomically', async (t) => {
  const { app, store, post, state } = await fixture(t);
  const body = await approval(app, state);
  const response = await post('/api/editions', body);
  assert.equal(response.status, 201);
  const edition = await response.json();
  assert.equal(edition.manifestHash, body.approvedManifestHash);
  const saved = await store.read();
  assert.equal(saved.head, state.head);
  assert.equal(saved.audit.at(-1).type, 'edition.published');
  assert.equal(saved.outbox.at(-1).id, saved.audit.at(-1).id);
});

test('a changed approval hash cannot publish', async (t) => {
  const { app, post, state } = await fixture(t);
  const response = await post('/api/editions', { ...await approval(app, state), approvedManifestHash: '0'.repeat(64) });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'APPROVAL_MISMATCH');
});

test('stale head prevents publication after human review', async (t) => {
  const { app, post, state } = await fixture(t);
  const body = await approval(app, state);
  await post('/api/scenes', { title: '새 장면', text: '새 원고' });
  const response = await post('/api/editions', body);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'STALE_HEAD');
});

test('unknown or missing approval fields do not become publishing authority', async (t) => {
  const { app, post, state } = await fixture(t);
  const body = await approval(app, state);
  delete body.decision;
  const response = await post('/api/editions', { ...body, modelSaysApproved: true });
  assert.equal(response.status, 400);
});

test('edition export remains immutable after current manuscript changes', async (t) => {
  const { app, post, state } = await fixture(t);
  const edition = await (await post('/api/editions', await approval(app, state))).json();
  const frozen = await (await app.request(`/api/editions/${edition.id}/export`)).text();
  await post('/api/scenes', { title: '추가된 장면', text: '출판 후 추가한 문장' });
  assert.equal(await (await app.request(`/api/editions/${edition.id}/export`)).text(), frozen);
  assert.ok(!(await (await app.request(`/api/export?snapshotId=${state.head}`)).text()).includes('출판 후 추가한 문장'));
  assert.ok((await (await app.request('/api/export')).text()).includes('출판 후 추가한 문장'));
});

test('new edition requires explicit approval of the preceding immutable edition', async (t) => {
  const { app, post, state } = await fixture(t);
  const first = await (await post('/api/editions', await approval(app, state))).json();
  const next = await approval(app, state, '개정판');
  const denied = await post('/api/editions', { ...next, approvedPreviousManifestHash: null });
  assert.equal(denied.status, 409);
  const response = await post('/api/editions', next);
  assert.equal(response.status, 201);
  assert.equal((await response.json()).revisionOf, first.id);
});

test('idempotent publication returns the same edition without duplicates', async (t) => {
  const { app, post, state } = await fixture(t);
  const body = await approval(app, state);
  const key = crypto.randomUUID();
  const first = await (await post('/api/editions', body, key)).json();
  const second = await (await post('/api/editions', body, key)).json();
  assert.equal(first.id, second.id);
  assert.equal((await app.request('/api/state').then((r) => r.json())).editions.length, 1);
});

test('concurrent publication cannot reuse a stale predecessor approval', async (t) => {
  const { app, post, state } = await fixture(t);
  const body = await approval(app, state);
  const responses = await Promise.all([post('/api/editions', body), post('/api/editions', body)]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
});

test('editions are isolated and preserved across project switching', async (t) => {
  const { app, post, state } = await fixture(t);
  const edition = await (await post('/api/editions', await approval(app, state))).json();
  await post('/api/projects', { title: '다른 작품', direction: '별개의 원고' });
  assert.equal((await app.request(`/api/editions/${edition.id}/export`)).status, 404);
  assert.equal((await app.request('/api/state').then((r) => r.json())).editions.length, 0);
  await post(`/api/projects/${state.project.id}/switch`, {});
  assert.equal((await app.request(`/api/editions/${edition.id}/export`)).status, 200);
});

test('unadopted saved drafts never leak into published or snapshot exports', async (t) => {
  const { app, post, state } = await fixture(t);
  await post('/api/scenes/scene-7/draft', { text: '미채택 비공개 초안', baseSnapshotId: state.head });
  const edition = await (await post('/api/editions', await approval(app, state))).json();
  assert.ok(!(await (await app.request(`/api/editions/${edition.id}/export`)).text()).includes('미채택 비공개 초안'));
});

test('DOCX is a valid OOXML archive containing snapshot text and headings', async (t) => {
  const { app, state } = await fixture(t);
  const response = await app.request(`/api/export?format=docx&snapshotId=${state.head}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /wordprocessingml/);
  assert.match(response.headers.get('content-disposition'), /^attachment; filename="novail-snapshot-[a-z0-9-]+\.docx"$/);
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  const document = zip.file('word/document.xml');
  assert.ok(document);
  const xml = await document.async('string');
  assert.ok(xml.includes('The Blockaded Harbor'));
  assert.ok(xml.includes('The box seals a promise, not a ship'));
  assert.ok(xml.includes('Heading1'));
  assert.ok(zip.file('[Content_Types].xml'));
});

test('manifest export includes stable hashes without copying manuscript text', async (t) => {
  const { app, state } = await fixture(t);
  const manifest = await (await app.request(`/api/export?format=manifest&snapshotId=${state.head}`)).json();
  assert.equal(manifest.snapshotId, state.head);
  assert.match(manifest.scenes[0].textHash, /^[a-f0-9]{64}$/);
  assert.equal(manifest.scenes[0].text, undefined);
});

test('edition integrity checks detect a modified stored manifest', async (t) => {
  const { app, store, post, state } = await fixture(t);
  const edition = await (await post('/api/editions', await approval(app, state))).json();
  await store.transaction((saved) => { saved.editions[0].manifest.title = '변조된 제목'; });
  const response = await app.request(`/api/editions/${edition.id}/export?format=manifest`);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'EDITION_INTEGRITY_ERROR');
});

test('DOCX preserves Unicode, special characters, and line breaks', async (t) => {
  const { app, post } = await fixture(t);
  await post('/api/scenes', { title: '달빛 & 바다', text: '<비밀> & 약속 🌙\n두 번째 줄\n\n다음 문단' });
  const response = await app.request('/api/export?format=docx');
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  const xml = await zip.file('word/document.xml').async('string');
  assert.ok(xml.includes('&lt;비밀&gt; &amp; 약속 🌙'));
  assert.ok(xml.includes('<w:br'));
  assert.ok(xml.indexOf('The Blockaded Harbor') < xml.indexOf('달빛 &amp; 바다'));
});

test('DOCX refuses XML-incompatible characters instead of silently deleting manuscript text', async (t) => {
  const { app, post } = await fixture(t);
  await post('/api/scenes', { title: '제어 문자', text: '원문\u0000보존' });
  const response = await app.request('/api/export?format=docx');
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, 'DOCX_UNSUPPORTED_CHARACTER');
});

test('unpaired surrogates cannot silently become replacement characters in hashed exports', async (t) => {
  const { app, post } = await fixture(t);
  await post('/api/scenes', { title: '잘못된 Unicode', text: '\ud800' });
  const response = await app.request('/api/export?format=markdown');
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, 'INVALID_UNICODE');
});

test('an empty manuscript cannot become a published edition', async (t) => {
  const { app, post, store } = await fixture(t);
  await post('/api/projects', { title: '아직 빈 작품', direction: '첫 장면을 쓰기 전' });
  const response = await post('/api/editions', await approval(app, await store.read()));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'EMPTY_MANUSCRIPT');
});
