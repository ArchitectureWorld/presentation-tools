# Report Studio v0.1.1 DSH Entry Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep users inside the complete DSH Web shell for normal Report Studio work while preserving the current Session prompt bridge, Proposal confirmation, migrated data, and version `0.1.1`.

**Architecture:** `conversation.view` remains the only normal product entry and loads the current Session in an iframe. DSH `0.1.1-rc.2` keeps the active view in its private conversation `ChatStore`; the public `conversation.session.header.actions` contract does not expose that store or a navigation service, so the header contribution follows the required fallback: it is explicitly labeled as an independent-window action and warns before opening. The standalone route owns only a slim return-to-DSH notice; it never recreates DSH model, reasoning, Session, or composer controls.

**Tech Stack:** DSH `0.1.1-rc.2` client slots, React bundle, Node.js test runner, vanilla HTML/CSS/JS, Chrome DevTools Protocol.

**Spec:** `docs/superpowers/specs/2026-09-03-report-studio-v0.1.1-production-hardening-design.md` plus the approved DSH-entry requirements from 2026-09-03.

## Global Constraints

- Keep Report Studio and plugin versions at `0.1.1`.
- Do not add a Report Studio model or reasoning selector.
- Preserve Session-bound storage, tools, ReviewSubmission, Proposal confirmation, CAS, migration, Standard Project import/export, and legacy `state.json` read-only retention.
- Do not modify or remove other DSH plugins, Sessions, or Report Studio user data.
- Port `3080` is the formal DSH entry; port `4173` remains development-only.
- Do not merge `main`; do not push until the user requests it or the final delivery explicitly records the requested push state.

---

### Task 1: Lock the DSH entry contract with failing tests

**Files:**
- Modify: `packages/studio-dsh-plugin/client.test.mjs`
- Modify: `scripts/verify-dsh-plugin.mjs`
- Create: `packages/studio-dsh-plugin/dsh-entry.test.mjs`

**Interfaces:**
- Consumes: `conversation.view`, `conversation.session.header.actions`, current `sessionId`, same-origin prompt bridge.
- Produces: regression assertions for the normal tab flow, explicit independent fallback, standalone notice, no local model selector, and no browser console errors.

- [x] **Step 1: Write failing client registration tests**

  Assert that the view iframe is Session-scoped; rendering/clicking the normal view never calls `window.open`; the header label contains `独立打开`; declining its warning does not open a window; accepting opens exactly `/report-studio/?sessionId=<current>`.

- [x] **Step 2: Run the focused client test and verify RED**

  Run: `node --test packages/studio-dsh-plugin/client.test.mjs`

  Expected: failure because the current header action opens immediately and is still labeled only `Report Studio`.

- [x] **Step 3: Write a failing entry-runtime test**

  The test executes the production entry runtime in a browser-like VM for top-level and embedded modes, and asserts the exact standalone notice, `/` return link, embedded marker, and absence of model/reasoning selectors. Real browser console errors are checked during Task 4 host acceptance.

- [x] **Step 4: Run the entry-runtime test and verify RED**

  Run: `node --test packages/studio-dsh-plugin/dsh-entry.test.mjs`

  Expected: failure because the standalone notice and return control do not exist.

### Task 2: Implement the minimal DSH-shell-first interaction

**Files:**
- Modify: `packages/studio-dsh-plugin/lib/client.js`
- Modify: `apps/studio-local/public/index.html`
- Modify: `apps/studio-local/public/styles.css`
- Modify: `apps/studio-local/public/dsh-native-runtime.js`
- Modify: `scripts/build-dsh-plugin-vendor.mjs`

**Interfaces:**
- Consumes: `window.parent`, `window.opener`, same-origin `postMessage`, DSH Session prompt bridge.
- Produces: normal iframe-only view path, explicit independent fallback, `#report-studio-standalone-notice`, `#report-studio-return-dsh`, and embedded-mode Agent guidance.

- [x] **Step 1: Implement the header fallback**

  Keep `conversation.view` unchanged. Rename the header button to `Report Studio · 独立打开`, show a warning that the independent window has no DSH model/Session controls, and call `window.open` only after confirmation.

- [x] **Step 2: Implement the standalone notice**

  Add a hidden, compact banner as the first child of the Studio shell. Reveal it only when `/report-studio` is top-level; link back to `/`; keep the workspace usable.

- [x] **Step 3: Demote the duplicate Agent UI in embedded mode**

  Mark the page as DSH-embedded when `window.parent !== window`, hide the internal Agent FAB/modal there, and show a small top-bar status telling users to use the DSH native composer. Review submission continues through `report-studio.prompt`; Proposal confirmation remains unchanged.

- [x] **Step 4: Sync the self-contained plugin vendor tree**

  Run: `npm --prefix packages/studio-dsh-plugin run sync:vendor`

- [x] **Step 5: Verify GREEN**

  Run: `node --test packages/studio-dsh-plugin/client.test.mjs`

  Run: `node --test packages/studio-dsh-plugin/dsh-entry.test.mjs`

### Task 3: Normalize product entry documentation and deployment checks

**Files:**
- Modify: `README.md`
- Modify: `DSH_INSTALL.md`
- Modify: `packages/studio-dsh-plugin/README.md`
- Modify: `docs/deployment/report-studio-v0.1.1-local-deployment.md`
- Modify: `docs/architecture/report-studio-architecture.md`
- Modify: `docs/acceptance/report-studio-v0.1.1-verification.md`
- Modify: `scripts/smoke-dsh-native.mjs`

**Interfaces:**
- Consumes: formal entry `http://127.0.0.1:3080/` and DSH native Session controls.
- Produces: one consistent install/start/use/acceptance path and smoke assertions that distinguish the shell from the internal route.

- [x] **Step 1: Replace user-facing entry instructions**

  State: open `http://127.0.0.1:3080/`; select/create a Session; click the `Report Studio` tab; choose model and reasoning level in DSH native controls. Label `/report-studio` as internal/independent and `4173` as development-only.

- [x] **Step 2: Strengthen static and isolated smoke checks**

  Assert the DSH shell root is reachable, the standalone route carries its warning, the health payload remains `version=v0.1.1`, `agentMode=dsh-native`, `agentConfigured=true`, and `migrationStatus=ready`.

- [x] **Step 3: Run focused verification**

  Run: `npm run verify:dsh`

  Run: `npm run smoke:dsh`

### Task 4: Full verification, real-profile acceptance, package, and evidence

**Files:**
- Modify: `docs/acceptance/report-studio-v0.1.1-verification.md`
- Replace: `dist/architectureworld-report-studio-dsh-0.1.1.tgz`
- Create: `docs/acceptance/evidence/report-studio-v0.1.1-dsh-shell.png`

**Interfaces:**
- Consumes: the real DSH Web Profile on `127.0.0.1:3080`, existing migrated Revision 9 data, packaged tgz.
- Produces: deployable artifact plus host evidence without changing `main`.

- [x] **Step 1: Run the full automated gate**

  Run: `npm run verify:all`

- [x] **Step 2: Build the package and record artifact identity**

  Run: `npm pack ./packages/studio-dsh-plugin --pack-destination ./dist`

  Record absolute path, byte size, and SHA-256.

- [x] **Step 3: Back up the real profile and Report Studio data**

  Create timestamped copies of `C:\Users\2899\.dsh\profiles\web` and `C:\Users\2899\.dsh\report-studio-v0.1.0` before installing the tgz. Do not alter other plugin entries.

- [x] **Step 4: Install and restart the real DSH Web Profile**

  Remove only `@architectureworld/report-studio-dsh`, install the new tgz, retain `@architectureworld/dsh-preplanning-agent` and `dsh-openai-codex-login`, then start DSH on `127.0.0.1:3080`.

- [x] **Step 5: Validate the host and migrated data**

  Prompt bridge delivery、DSH shell controls、migration counts and persistence passed. The current DSH Provider returned `TRANSPORT / fetch failed`, so the real-model Proposal step remains an environment-level recheck; the Proposal-before-Revision rule passed automated E2E.

  Verify the shell sidebar, native model/reasoning/composer controls, Report Studio tab and iframe, prompt dispatch, Proposal-before-Revision rule, persistence after restart, health payload, and the migrated counts: Revision 9, 1 page, 3 annotations, 1 ReviewRound, 2 ReviewSubmissions.

- [x] **Step 6: Capture browser evidence and console results**

  Save a full DSH-shell screenshot and record zero new console errors.

- [x] **Step 7: Commit and push the branch without merging `main`**

  Commit message: `fix: keep report studio inside the dsh shell`
