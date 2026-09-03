import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('./public/', import.meta.url);

test('UI exposes v0.1.1 outline draft workflow, migration Gate and standard project controls', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  assert.match(html, /Report Studio/);
  assert.match(html, /v0\.1\.1/);
  assert.match(html, /<link rel="icon" href="data:,">/);
  assert.match(html, /data-stage="outline"/);
  assert.match(html, /data-stage="draft"/);
  assert.match(html, /data-stage="layout"/);
  assert.match(html, /v0\.2\.0/);
  assert.match(html, /annotation-panel/);
  assert.match(html, /agent-fab/);
  assert.match(html, /project-brand/);
  assert.match(html, /workspace-shell/);
  assert.match(html, /comment-scroll-region/);
  assert.match(html, /id="migration-gate"/);
  assert.match(html, /id="migration-apply"/);
  assert.match(html, /id="standard-project-modal"/);
  assert.match(html, /id="standard-import-path"/);
  assert.match(html, /id="standard-export"/);
});

test('browser app contains production actions for outline, draft, review and proposal', async () => {
  const app = await readFile(new URL('app.js', root), 'utf8');
  for (const token of ['outline.add', 'outline.rename', 'draft.ensurePage', 'draft.update', 'annotation.add', '/api/review/submit', '/accept']) {
    assert.ok(app.includes(token), `missing ${token}`);
  }
  assert.match(app, /baseRevision:\s*state\.project\.currentRevision/);
  assert.match(app, /\/api\/migration\/apply/);
  assert.match(app, /\/api\/standard\/import/);
  assert.match(app, /\/api\/standard\/export/);
  assert.match(app, /data-retry-submission/);
  assert.match(app, /stale_revision/);
  assert.doesNotMatch(app, /generateAgentReply|setTimeout\([^)]*Agent/);
});
