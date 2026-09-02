import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('./public/', import.meta.url);

test('UI exposes v0.1.0 outline draft workflow and defers layout', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  assert.match(html, /Report Studio/);
  assert.match(html, /v0\.1\.0/);
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
});

test('browser app contains production actions for outline, draft, review and proposal', async () => {
  const app = await readFile(new URL('app.js', root), 'utf8');
  for (const token of ['outline.add', 'outline.rename', 'draft.ensurePage', 'draft.update', 'annotation.add', '/api/review/submit', '/accept']) {
    assert.ok(app.includes(token), `missing ${token}`);
  }
  assert.doesNotMatch(app, /generateAgentReply|setTimeout\([^)]*Agent/);
});
