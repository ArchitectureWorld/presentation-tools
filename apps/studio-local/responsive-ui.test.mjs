import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('./public/', import.meta.url);

async function read(name) {
  return readFile(new URL(name, root), 'utf8');
}

test('production shell preserves the approved prototype hierarchy', async () => {
  const html = await read('index.html');
  for (const token of [
    'project-brand',
    'stage-nav',
    'page-strip',
    'workspace-shell',
    'stage-workspace',
    'comment-panel',
    'comment-filter',
    'comment-scroll-region',
    'comment-composer',
    'agent-chat-card',
    'agent-context-stage',
    'workspace-sync-toggle',
    'workspace-conflict-banner',
  ]) {
    assert.ok(html.includes(token), `missing prototype shell token: ${token}`);
  }
  assert.match(html, /data-filter="all"/);
  assert.match(html, /data-filter="unfinished"/);
  assert.match(html, /data-filter="completed"/);
});

test('visual system is dark, fluid and does not lock the app to a design canvas', async () => {
  const css = await read('styles.css');
  assert.match(css, /color-scheme:\s*dark/);
  assert.match(css, /--accent:/);
  assert.match(css, /height:\s*100dvh/);
  assert.match(css, /clamp\(/);
  assert.match(css, /@media\s*\(max-width:/);
  assert.doesNotMatch(css, /min-width:\s*1080px/);
  assert.doesNotMatch(css, /width:\s*1600px/);
  assert.doesNotMatch(css, /height:\s*900px/);
});

test('embedded low-height layouts keep the annotation history and task dialog inside the viewport', async () => {
  const css = await read('styles.css');
  assert.match(css, /\.agent-chat-card\s*\{[\s\S]*?height:\s*min\(82dvh,\s*calc\(100dvh\s*-\s*48px\)\);[\s\S]*?min-height:\s*0;/);
  assert.match(css, /\.modal\s*\{[\s\S]*?overflow:\s*auto;/);
  assert.match(css, /@media\s*\(max-height:\s*720px\)[\s\S]*?\.comment-panel\s*\{[\s\S]*?minmax\(96px,\s*1fr\)/);
  assert.match(css, /\.selected-target\s*\{[\s\S]*?overflow-wrap:\s*anywhere;[\s\S]*?line-height:\s*1\.45;/);
});

test('browser rendering includes responsive page strip and comment filtering', async () => {
  const app = await read('app.js');
  for (const token of ['commentFilter', 'renderPageStrip', 'data-filter', 'agent-context-stage']) {
    assert.ok(app.includes(token), `missing responsive browser behavior: ${token}`);
  }
});
