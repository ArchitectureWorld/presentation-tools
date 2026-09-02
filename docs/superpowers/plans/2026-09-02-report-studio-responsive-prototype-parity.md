# Report Studio Responsive Prototype-Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace the divergent white production UI with a responsive, production-backed implementation that preserves the approved dark Report Studio prototype language while retaining the existing Outline, Draft, ReviewRound, Proposal, Revision, persistence, and DSH Bridge behavior.

**Architecture:** Keep `server.mjs`, `repository.mjs`, and `packages/studio-core` unchanged. Replace only the browser shell, visual system, and DOM rendering inside `apps/studio-local/public/`; add contract and Chromium verification that exercise multiple viewport sizes and the Agent modal. The UI remains zero-dependency and continues to call the existing HTTP API.

**Tech Stack:** Node.js 22, native HTTP server, HTML, CSS Grid/Flexbox, vanilla JavaScript, Node test runner, Chromium DevTools Protocol.

**Spec:** `docs/architecture/report-studio-mvp-baseline-v0.1.0.md` and the approved historical prototype under `tools/report-studio/prototype/`.

## Global Constraints

- Product version remains `v0.1.0`.
- `v0.1.0` implements Outline + Draft; Layout remains visibly deferred to `v0.2.0`.
- No changes to Outline, Draft, Annotation, ReviewRound, ReviewSubmission, Proposal, Revision, persistence, or DSH Bridge domain semantics.
- The historical prototype is the visual and interaction baseline, not the white local UI.
- `1600×900` is one verification viewport only; the production UI must adapt to the browser window.
- No runtime dependencies and no `npm install` requirement.

---

### Task 1: Lock responsive prototype-parity contracts

**Files:**
- Modify: `apps/studio-local/ui.contract.test.mjs`
- Create: `apps/studio-local/responsive-ui.test.mjs`
- Create: `scripts/verify-responsive-ui.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: existing static files and `createStudioServer()`.
- Produces: contract tests for the dark shell and a real Chromium verification command, `npm run verify:ui`.

- [x] Write tests requiring the prototype shell elements, dark design tokens, no fixed `min-width:1080px`, responsive media queries, and a global page strip.
- [x] Run the tests and confirm they fail against the white UI.
- [x] Add a Chromium verifier that checks 720×900, 820×900, 1024×768, 1366×768, 1600×900, and 1920×1080 without horizontal overflow, opens/closes the Agent modal, verifies the DSH-unconfigured text, and reports console errors.

### Task 2: Replace the production shell and visual system

**Files:**
- Modify: `apps/studio-local/public/index.html`
- Modify: `apps/studio-local/public/styles.css`

**Interfaces:**
- Consumes: existing element IDs used by `app.js` and new shell IDs defined in Task 1.
- Produces: responsive dark prototype-parity shell, page strip, fixed comment composer, and responsive Agent modal.

- [x] Replace the top bar with project branding, centered stage navigation, save/revision area, and a separate global page strip.
- [x] Replace the white CSS with the prototype dark/purple visual language.
- [x] Use `clamp()`, flexible grids, `100dvh`, wrapping actions, and breakpoints rather than a fixed design canvas.
- [x] Keep all controls keyboard accessible and preserve Agent FAB nested-click handling.

### Task 3: Rework browser rendering without changing domain logic

**Files:**
- Modify: `apps/studio-local/public/app.js`
- Modify: `apps/studio-local/agent-fab.test.mjs`

**Interfaces:**
- Consumes: unchanged `/api/health`, `/api/state`, `/api/action`, `/api/review/submit`, `/api/proposal/:id/accept`, and `/api/agent/chat` endpoints.
- Produces: prototype-parity Outline/Draft rendering, comment filters, global page navigation, Agent context, and responsive shell state.

- [x] Move page tabs to `#page-strip` and hide them in Outline.
- [x] Add `all / unfinished / completed` comment filtering as UI-only state.
- [x] Render Outline and Draft with the approved hierarchy, cards, typography, and action language.
- [x] Render ReviewRound, ReviewSubmission, and Proposal cards in the fixed right panel.
- [x] Render the Agent modal using the approved header/context/feed/composer structure.
- [x] Preserve every existing API action and backend field unchanged.

### Task 4: Complete verification and delivery

**Files:**
- Modify: `docs/deployment/report-studio-v0.1.0-local-deployment.md`
- Modify: PR #3 description if required.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: verified responsive UI and deployment instructions.

- [x] Run `npm test`.
- [x] Run `npm run verify`.
- [x] Run `npm run verify:ui` and inspect screenshots for all six sample viewport sizes.
- [x] Restart the server with an independent temporary data directory and repeat the Chromium verification.
- [x] Review the diff to ensure backend and domain files are untouched.
- [x] Prepare one focused commit for `integration/report-studio-mvp-v0.1.0`; remote CI evidence is recorded after push.
