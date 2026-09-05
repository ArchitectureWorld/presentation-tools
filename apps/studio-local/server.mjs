import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepository } from './repository.mjs';
import { createAgentBridge } from './agent-bridge.mjs';
import { beginReviewDispatch, executeAction, submitReviewRound, acceptProposal, createProposalFromAgent, markProposalStale, markSubmissionDispatch, recoverExpiredReviewDispatches, rejectProposal, retryReviewSubmission, returnProposalToAgent, transitionReviewSubmission } from '../../packages/studio-core/index.mjs';
import { ERROR_CODES, StudioError, errorPayload } from '../../packages/studio-contracts/index.mjs';
import { createStandardProjectService } from './standard-project.mjs';
import { projectAgentContext } from './agent-context.mjs';
import { ingestAsset, serveReferencedAsset } from './asset-service.mjs';
import { createLayoutService } from './layout-service.mjs';
import { executeLayoutApi, layoutApiErrorPayload, matchLayoutApiPath } from './layout-api.mjs';
import { createReviewTaskRunner } from './review-task-runner.mjs';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(rootDir, 'public');
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const isContentAction = type => ['project.', 'outline.', 'draft.'].some(prefix => String(type).startsWith(prefix));
const SECURITY_MODE = 'local-single-user-only';

function requireLoopback(host) {
  if (host !== '127.0.0.1') throw new Error(`${SECURITY_MODE} requires listen host 127.0.0.1`);
}

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
  requireLoopback(host);
  const repository = await createRepository(dataDir);
  const standardProject = createStandardProjectService(repository);
  const layoutService = createLayoutService({ repository, layoutRoot: join(dataDir, 'layouts') });
  const bridge = agentBridge === undefined ? createAgentBridge() : agentBridge;
  const taskRunner = createReviewTaskRunner({ getRepository: async () => repository, agentBridge: bridge });
  let actualPort = port;
  let server;

  const bridgeSessionId = String(bridge?.sessionId || bridge?.endpoint || 'standalone-bridge')

  async function recoverExpiredDispatches() {
    const current = repository.getState()
    const preview = recoverExpiredReviewDispatches(current)
    if (!preview.recoveredReviewRunIds.length) return current
    return repository.transactOperational(state => {
      const result = recoverExpiredReviewDispatches(state)
      return result.state
    })
  }

  async function dispatchSubmission(submissionId) {
    const before = repository.getState();
    const submission = before.reviewSubmissions.find(item => item.id === submissionId);
    if (!submission) throw new Error('未找到 ReviewSubmission');
    let begun = before.reviewRuns?.find(item => item.reviewRunId === submission.activeReviewRunId)
    if (!begun) {
      let created
      await repository.transactOperational(state => {
        created = beginReviewDispatch(state, submissionId, { sessionId: bridgeSessionId })
        return created.state
      })
      begun = created.reviewRun
    }
    try {
      if (!bridge?.configured) throw new StudioError(ERROR_CODES.DISPATCH_FAILED, 'DSH Bridge 未配置。', { submissionId }, 503);
      const task = await taskRunner.start({ sessionId: bridgeSessionId, submissionId, reviewRunId: begun.reviewRunId });
      const outcome = await taskRunner.wait(task.taskId);
      if (outcome?.error) throw new StudioError(ERROR_CODES.DISPATCH_FAILED, outcome.error.message || '独立任务执行失败。', { submissionId, taskId: task.taskId }, 502);
      const current = repository.getState();
      const currentRun = current.reviewRuns.find(item => item.reviewRunId === begun.reviewRunId);
      const proposal = currentRun?.resultProposalId ? current.proposals.find(item => item.id === currentRun.resultProposalId) : null;
      const agentResult = outcome?.result || { message: currentRun?.summary || '', sessionRef: currentRun?.workerSessionRef ?? null };
      return {
        state: current,
        submission: current.reviewSubmissions.find(item => item.id === submissionId),
        reviewRun: currentRun,
        bridgeResult: { message: agentResult.message, proposalId: proposal?.id ?? null, sessionRef: agentResult.sessionRef ?? null },
      };
    } catch (error) {
      let failed;
      await repository.transactOperational(state => {
        const current = state.reviewSubmissions.find(item => item.id === submissionId)
        if (current?.status !== 'pending_dispatch') return state
        const marked = markSubmissionDispatch(state, submissionId, { status: 'dispatch_failed', error: error.message, reviewRunId: begun.reviewRunId, sessionId: bridgeSessionId });
        failed = marked.submission;
        return marked.state;
      });
      if (!failed) throw error
      throw new StudioError(ERROR_CODES.DISPATCH_FAILED, error.message || 'DSH Bridge 调用失败。', { submissionId, submission: failed }, 502);
    }
  }

  async function handleApi(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/health') return sendJson(res, 200, {
      ok: true,
      version: 'v0.1.1',
      productVersion: '0.2.0-beta.1',
      layoutStage: true,
      dataPath: repository.statePath,
      layoutPath: layoutService.root,
      migrationStatus: repository.migrationStatus().status,
      agentConfigured: Boolean(bridge?.configured),
      securityMode: SECURITY_MODE,
      listenHost: host,
      networkSharedSecurity: false,
    });
    if (req.method === 'GET' && url.pathname === '/api/migration/status') return sendJson(res, 200, repository.migrationStatus());
    if (req.method === 'POST' && url.pathname === '/api/migration/apply') return sendJson(res, 200, await repository.applyMigration());
    if (req.method === 'GET' && url.pathname === '/api/standard/status') return sendJson(res, 200, standardProject.status());
    if (req.method === 'POST' && url.pathname === '/api/standard/import') {
      const input = await readJson(req);
      return sendJson(res, 200, await standardProject.importProject(input.projectRoot));
    }
    if (req.method === 'POST' && url.pathname === '/api/standard/export') return sendJson(res, 200, await standardProject.exportProject());
    const layoutMatch = matchLayoutApiPath(url.pathname);
    if (layoutMatch) {
      try {
        const body = req.method === 'POST' ? await readJson(req) : {};
        return sendJson(res, 200, await executeLayoutApi({ service: layoutService, method: req.method, match: layoutMatch, body }));
      } catch (error) {
        const response = layoutApiErrorPayload(error);
        return sendJson(res, response.status, response.payload);
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/state') return sendJson(res, 200, await recoverExpiredDispatches());
    if (req.method === 'POST' && url.pathname === '/api/assets/ingest') {
      const pageId = url.searchParams.get('pageId');
      const mimeType = String(req.headers['content-type'] ?? '').split(';', 1)[0].toLowerCase();
      const originalFileName = String(req.headers['x-file-name'] ?? 'upload').replace(/[\\/\0]/g, '_');
      return sendJson(res, 200, await ingestAsset({ repository, request: req, pageId, mimeType, originalFileName }));
    }
    const contentMatch = url.pathname.match(/^\/api\/assets\/([^/]+)\/content$/);
    if (req.method === 'GET' && contentMatch) {
      return serveReferencedAsset({ repository, assetId: decodeURIComponent(contentMatch[1]), response: res });
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
        const submission = state.reviewSubmissions.find(item => item.id === submissionId)
        if (!submission) throw new StudioError(ERROR_CODES.INVALID_REFERENCE, '未找到 ReviewSubmission', { submissionId }, 404)
        let recoverable = state
        if (submission.status === 'pending_dispatch' && submission.activeReviewRunId) {
          recoverable = transitionReviewSubmission(state, submissionId, 'dispatch_failed', {
            reviewRunId: submission.activeReviewRunId,
            error: '用户请求继续投递。',
          }).state
        }
        retried = recoverable.reviewSubmissions.find(item => item.id === submissionId).status === 'dispatch_failed'
          ? retryReviewSubmission(recoverable, submissionId, { sessionId: bridgeSessionId })
          : { state: recoverable, submission: recoverable.reviewSubmissions.find(item => item.id === submissionId) }
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
      try {
        const state = await repository.transactContent(
          { baseRevision: proposal.baseRevision, source: 'agent', detail: { proposalId, submissionId: proposal.submissionId } },
          current => acceptProposal(current, proposalId).state,
        );
        await taskRunner.closeSubmission({ sessionId: bridgeSessionId, submissionId: proposal.submissionId });
        const closedState = repository.getState();
        return sendJson(res, 200, { state: closedState, revision: closedState.revisions.at(-1) });
      } catch (error) {
        if (error?.code !== ERROR_CODES.STALE_REVISION && error?.message !== 'stale_revision') throw error
        let stale
        const state = await repository.transactOperational(current => {
          stale = markProposalStale(current, proposalId)
          return stale.state
        })
        await taskRunner.closeSubmission({ sessionId: bridgeSessionId, submissionId: proposal.submissionId })
        throw new StudioError(ERROR_CODES.STALE_REVISION, 'Proposal 基线已过期。', { proposalId, state }, 409)
      }
    }
    const proposalActionMatch = url.pathname.match(/^\/api\/proposal\/([^/]+)\/(reject|return)$/);
    if (req.method === 'POST' && proposalActionMatch) {
      const proposalId = decodeURIComponent(proposalActionMatch[1]);
      let result;
      const state = await repository.transactOperational(current => {
        result = proposalActionMatch[2] === 'reject' ? rejectProposal(current, proposalId) : returnProposalToAgent(current, proposalId);
        return result.state;
      });
      if (proposalActionMatch[2] === 'reject') await taskRunner.closeSubmission({ sessionId: bridgeSessionId, submissionId: result.proposal.submissionId });
      return sendJson(res, 200, { state: repository.getState(), proposal: result.proposal });
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
    layoutService,
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
      await taskRunner.close();
      await repository.close();
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await createStudioServer(); await app.start();
  console.log(`Report Studio v0.2.0-beta.1 running at http://${process.env.HOST || '127.0.0.1'}:${app.port}`);
  console.log(`Data: ${app.repository.statePath}`);
}
