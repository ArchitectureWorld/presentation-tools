import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepository } from './repository.mjs';
import { createAgentBridge } from './agent-bridge.mjs';
import { executeAction, submitReviewRound, acceptProposal, createProposalFromAgent, markSubmissionDispatch, retryReviewSubmission } from '../../packages/studio-core/index.mjs';
import { ERROR_CODES, StudioError, createStudioId, errorPayload } from '../../packages/studio-contracts/index.mjs';
import { createStandardProjectService } from './standard-project.mjs';
import { projectAgentContext } from './agent-context.mjs';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(rootDir, 'public');
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const isContentAction = type => ['project.', 'outline.', 'draft.'].some(prefix => String(type).startsWith(prefix));
const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const imageSignature = (mimeType, bytes) => (mimeType === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) || (mimeType === 'image/jpeg' && bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])));

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
  const standardProject = createStandardProjectService(repository);
  const bridge = agentBridge === undefined ? createAgentBridge() : agentBridge;
  let actualPort = port;
  let server;

  async function dispatchSubmission(submissionId) {
    if (!bridge?.configured) throw new StudioError(ERROR_CODES.DISPATCH_FAILED, 'DSH Bridge 未配置。', { submissionId }, 503);
    const before = repository.getState();
    const submission = before.reviewSubmissions.find(item => item.id === submissionId);
    if (!submission) throw new Error('未找到 ReviewSubmission');
    const round = before.reviewRounds.find(item => item.id === submission.reviewRoundId);
    try {
      const agentResult = await bridge.submit({
        submission,
        context: { ...projectAgentContext(before, { stage: before.ui?.stage, pageId: before.ui?.activePageId }), scopeKey: round?.scopeKey ?? null },
      });
      let proposal = null;
      await repository.transactOperational(state => {
        let next = markSubmissionDispatch(state, submissionId, { status: 'dispatched' }).state;
        if (agentResult.commands.length) {
          const proposed = createProposalFromAgent(next, submissionId, { ...agentResult, idempotencyKey: submission.idempotencyKey });
          next = proposed.state;
          proposal = proposed.proposal;
        } else {
          const stored = next.reviewSubmissions.find(item => item.id === submissionId);
          stored.agentMessage = agentResult.message;
        }
        return next;
      });
      return {
        state: repository.getState(),
        submission: repository.getState().reviewSubmissions.find(item => item.id === submissionId),
        bridgeResult: { message: agentResult.message, proposalId: proposal?.id ?? null, sessionRef: agentResult.sessionRef ?? null },
      };
    } catch (error) {
      let failed;
      await repository.transactOperational(state => {
        const marked = markSubmissionDispatch(state, submissionId, { status: 'dispatch_failed', error: error.message });
        failed = marked.submission;
        return marked.state;
      });
      throw new StudioError(ERROR_CODES.DISPATCH_FAILED, error.message || 'DSH Bridge 调用失败。', { submissionId, submission: failed }, 502);
    }
  }

  async function handleApi(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/health') return sendJson(res, 200, { ok: true, version: 'v0.1.1', dataPath: repository.statePath, migrationStatus: repository.migrationStatus().status, agentConfigured: Boolean(bridge?.configured) });
    if (req.method === 'GET' && url.pathname === '/api/migration/status') return sendJson(res, 200, repository.migrationStatus());
    if (req.method === 'POST' && url.pathname === '/api/migration/apply') return sendJson(res, 200, await repository.applyMigration());
    if (req.method === 'GET' && url.pathname === '/api/standard/status') return sendJson(res, 200, standardProject.status());
    if (req.method === 'POST' && url.pathname === '/api/standard/import') {
      const input = await readJson(req);
      return sendJson(res, 200, await standardProject.importProject(input.projectRoot));
    }
    if (req.method === 'POST' && url.pathname === '/api/standard/export') return sendJson(res, 200, await standardProject.exportProject());
    if (req.method === 'GET' && url.pathname === '/api/state') return sendJson(res, 200, repository.getState());
    if (req.method === 'POST' && url.pathname === '/api/assets/ingest') {
      const pageId = url.searchParams.get('pageId');
      const mimeType = String(req.headers['content-type'] ?? '').split(';', 1)[0].toLowerCase();
      const originalFileName = String(req.headers['x-file-name'] ?? 'upload').replace(/[\\/\0]/g, '_');
      if (!pageId || !['image/png', 'image/jpeg'].includes(mimeType) || !originalFileName) throw new StudioError(ERROR_CODES.INVALID_COMMAND, '上传素材必须指定页面、受支持的图片 MIME 和文件名。', undefined, 400);
      let total = 0; let prefix = Buffer.alloc(0);
      async function* checked() {
        for await (const chunk of req) {
          const bytes = Buffer.from(chunk); total += bytes.length;
          if (total > MAX_ASSET_BYTES) throw new StudioError(ERROR_CODES.INVALID_COMMAND, '上传素材超过 20 MiB 限制。', undefined, 413);
          if (prefix.length < 8) prefix = Buffer.concat([prefix, bytes]).subarray(0, 8);
          yield bytes;
        }
        if (!imageSignature(mimeType, prefix)) throw new StudioError(ERROR_CODES.INVALID_COMMAND, '上传素材的文件签名与声明 MIME 不一致。', undefined, 400);
      }
      const objectRef = await repository.putBlob(checked(), { mimeType, originalFileName });
      const asset = { id: createStudioId('asset'), name: originalFileName, mimeType, objectRef, sizeBytes: objectRef.sizeBytes, sha256: objectRef.sha256 };
      const before = repository.getState();
      await repository.transactContent({ baseRevision: before.project.currentRevision, source: 'human', detail: { actionType: 'asset.ingest', pageId } }, state => {
        const page = state.pages.find(item => item.id === pageId);
        if (!page) throw new StudioError(ERROR_CODES.INVALID_REFERENCE, '上传目标页面不存在。', { pageId }, 404);
        page.assets = [...(page.assets ?? []), asset]; return state;
      });
      return sendJson(res, 200, { assetId: asset.id, objectRef, metadata: { name: asset.name, mimeType, sizeBytes: asset.sizeBytes, sha256: asset.sha256 } });
    }
    const contentMatch = url.pathname.match(/^\/api\/assets\/([^/]+)\/content$/);
    if (req.method === 'GET' && contentMatch) {
      const asset = repository.getState().pages.flatMap(page => page.assets ?? []).find(item => item.id === decodeURIComponent(contentMatch[1]));
      if (!asset?.objectRef) throw new StudioError(ERROR_CODES.INVALID_REFERENCE, '未找到当前项目引用的素材。', undefined, 404);
      const stream = await repository.openBlob(asset.objectRef);
      res.writeHead(200, { 'content-type': asset.mimeType, 'content-length': asset.sizeBytes, 'x-content-type-options': 'nosniff' });
      stream.pipe(res); return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/action') {
      const action = await readJson(req);
      if (isContentAction(action.type)) {
        if (repository.migrationStatus().status === 'ready' && !Number.isInteger(action.baseRevision)) throw new StudioError(ERROR_CODES.INVALID_COMMAND, '内容操作必须携带 baseRevision。', undefined, 400);
        const cleanAction = { ...action }; delete cleanAction.baseRevision;
        const state = await repository.transactContent(
          { baseRevision: action.baseRevision, source: 'human', detail: { actionType: action.type } },
          current => executeAction(current, cleanAction).state,
        );
        return sendJson(res, 200, state);
      }
      const state = await repository.transactOperational(current => executeAction(current, action).state);
      return sendJson(res, 200, state);
    }
    if (req.method === 'POST' && url.pathname === '/api/review/submit') {
      const input = await readJson(req);
      let submitted;
      await repository.transactOperational(state => {
        submitted = submitReviewRound(state, input);
        return submitted.state;
      });
      if (bridge?.configured) {
        try {
          const dispatched = await dispatchSubmission(submitted.submission.id);
          return sendJson(res, 200, { ...dispatched, round: submitted.round });
        } catch (error) {
          return sendJson(res, error.statusCode || 502, {
            ...errorPayload(error),
            state: repository.getState(),
            round: submitted.round,
            submission: repository.getState().reviewSubmissions.find(item => item.id === submitted.submission.id),
          });
        }
      }
      return sendJson(res, 200, { state: repository.getState(), round: submitted.round, submission: submitted.submission, bridgeResult: null });
    }
    const retryMatch = url.pathname.match(/^\/api\/review\/([^/]+)\/retry$/);
    if (req.method === 'POST' && retryMatch) {
      const submissionId = decodeURIComponent(retryMatch[1]);
      let retried;
      await repository.transactOperational(state => {
        retried = retryReviewSubmission(state, submissionId);
        return retried.state;
      });
      try { return sendJson(res, 200, await dispatchSubmission(submissionId)); }
      catch (error) { return sendJson(res, error.statusCode || 502, { ...errorPayload(error), state: repository.getState(), submission: repository.getState().reviewSubmissions.find(item => item.id === submissionId) }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/agent/chat') {
      const input = await readJson(req);
      if (!bridge?.configured) return sendJson(res, 503, { error: 'DSH Bridge 未配置' });
      const current = repository.getState();
      const result = await bridge.chat({ text: input.text, context: projectAgentContext(current, { stage: input.stage || current.ui.stage, pageId: input.pageId || current.ui.activePageId }) });
      return sendJson(res, 200, { message: result.message, sessionRef: result.sessionRef ?? null });
    }
    const proposalMatch = url.pathname.match(/^\/api\/proposal\/([^/]+)\/accept$/);
    if (req.method === 'POST' && proposalMatch) {
      const proposalId = proposalMatch[1];
      const proposal = repository.getState().proposals.find(item => item.id === proposalId);
      if (!proposal) throw new Error('未找到 Proposal');
      const state = await repository.transactContent(
        { baseRevision: proposal.baseRevision, source: 'agent', detail: { proposalId, submissionId: proposal.submissionId } },
        current => acceptProposal(current, proposalId).state,
      );
      return sendJson(res, 200, { state, revision: state.revisions.at(-1) });
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
  console.log(`Report Studio v0.1.1 running at http://${process.env.HOST || '127.0.0.1'}:${app.port}`);
  console.log(`Data: ${app.repository.statePath}`);
}
