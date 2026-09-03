import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepository } from './repository.mjs';
import { createAgentBridge } from './agent-bridge.mjs';
import { executeAction, submitReviewRound, acceptProposal, createProposalFromAgent } from '../../packages/studio-core/index.mjs';
import { errorPayload } from '../../packages/studio-contracts/index.mjs';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(rootDir, 'public');
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

async function readJson(req, limit = 20 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('请求体过大'), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('JSON 格式错误'), { statusCode: 400 }); }
}

export async function createStudioServer({ dataDir = process.env.REPORT_STUDIO_DATA_DIR || join(process.cwd(), '.report-studio-data'), port = Number(process.env.PORT || 4173), host = process.env.HOST || '127.0.0.1', agentBridge = undefined } = {}) {
  const repository = await createRepository(dataDir);
  const bridge = agentBridge === undefined ? createAgentBridge() : agentBridge;
  let actualPort = port;
  let server;

  async function handleApi(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/health') return sendJson(res, 200, { ok: true, version: 'v0.1.0', dataPath: repository.statePath, migrationStatus: repository.migrationStatus().status, agentConfigured: Boolean(bridge?.configured) });
    if (req.method === 'GET' && url.pathname === '/api/migration/status') return sendJson(res, 200, repository.migrationStatus());
    if (req.method === 'POST' && url.pathname === '/api/migration/apply') return sendJson(res, 200, await repository.applyMigration());
    if (req.method === 'GET' && url.pathname === '/api/state') return sendJson(res, 200, repository.getState());
    if (req.method === 'POST' && url.pathname === '/api/action') {
      const action = await readJson(req);
      const result = executeAction(repository.getState(), action);
      await repository.replace(result.state);
      return sendJson(res, 200, repository.getState());
    }
    if (req.method === 'POST' && url.pathname === '/api/review/submit') {
      const input = await readJson(req);
      const submitted = submitReviewRound(repository.getState(), input);
      await repository.replace(submitted.state);
      let bridgeResult = null;
      if (bridge?.configured) {
        try {
          const agentResult = await bridge.submit({ submission: submitted.submission, context: { projectId: submitted.state.project.id, projectTitle: submitted.state.project.title, scopeKey: submitted.round.scopeKey } });
          let proposalId = null;
          if (agentResult.commands.length) {
            const proposed = createProposalFromAgent(repository.getState(), submitted.submission.id, agentResult);
            await repository.replace(proposed.state);
            proposalId = proposed.proposal.id;
          }
          bridgeResult = { message: agentResult.message, proposalId, sessionRef: agentResult.sessionRef ?? null };
        } catch (error) { bridgeResult = { error: error.message || 'DSH Bridge 调用失败' }; }
      }
      return sendJson(res, 200, { state: repository.getState(), round: submitted.round, submission: submitted.submission, bridgeResult });
    }
    if (req.method === 'POST' && url.pathname === '/api/agent/chat') {
      const input = await readJson(req);
      if (!bridge?.configured) return sendJson(res, 503, { error: 'DSH Bridge 未配置' });
      const current = repository.getState();
      const result = await bridge.chat({ text: input.text, context: { projectId: current.project.id, projectTitle: current.project.title, currentRevision: current.project.currentRevision, stage: input.stage || current.ui.stage, pageId: input.pageId || current.ui.activePageId } });
      return sendJson(res, 200, { message: result.message, sessionRef: result.sessionRef ?? null });
    }
    const proposalMatch = url.pathname.match(/^\/api\/proposal\/([^/]+)\/accept$/);
    if (req.method === 'POST' && proposalMatch) {
      const result = acceptProposal(repository.getState(), proposalMatch[1]);
      await repository.replace(result.state);
      return sendJson(res, 200, { state: repository.getState(), revision: result.revision });
    }
    return false;
  }

  async function serveStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    const safe = normalize(pathname).replace(/^([.][.][/\\])+/, '').replace(/^[/\\]+/, '');
    const filePath = join(publicDir, safe);
    if (!filePath.startsWith(publicDir)) return false;
    try {
      const body = await readFile(filePath);
      res.writeHead(200, { 'content-type': contentTypes[extname(filePath)] || 'application/octet-stream', 'content-length': body.length });
      if (req.method === 'HEAD') res.end(); else res.end(body);
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  }

  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      const apiHandled = url.pathname.startsWith('/api/') ? await handleApi(req, res, url) : false;
      if (apiHandled !== false) return;
      if (await serveStatic(req, res, url)) return;
      sendJson(res, 404, { error: 'not_found' });
    } catch (error) { sendJson(res, error.statusCode || 400, error?.code ? errorPayload(error) : { error: error.message || 'request_failed' }); }
  });

  return {
    repository,
    get port() { return actualPort; },
    async start() {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => { server.off('error', reject); actualPort = server.address().port; resolve(); });
      });
      return this;
    },
    async stop() {
      if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await repository.close();
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await createStudioServer(); await app.start();
  console.log(`Report Studio v0.1.0 running at http://${process.env.HOST || '127.0.0.1'}:${app.port}`);
  console.log(`Data: ${app.repository.statePath}`);
}
