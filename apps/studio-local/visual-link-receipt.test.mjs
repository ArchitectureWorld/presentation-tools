import assert from 'node:assert/strict'
import test from 'node:test'

import {
  acknowledgeVisualLinkReceipt,
  createVisualLinkReceipt,
  findVisualProposalByRequest,
  needsVisualLinkAcknowledgement,
  visualRequestIdentityKey,
} from './visual-link-receipt.mjs'

const identity = Object.freeze({
  sessionId: 'session-01',
  projectId: 'project-01',
  runId: 'run-01',
  pageId: 'page-01',
  sourceStateHash: 'sha256:source-01',
  requestId: 'request-01',
})

const proposal = Object.freeze({
  id: 'proposal-01',
  kind: 'design.visual.v1',
  ...identity,
  status: 'accepted',
})

test('stable visual request identity does not depend on proposalId', () => {
  assert.equal(
    visualRequestIdentityKey(identity),
    visualRequestIdentityKey({ ...identity, proposalId: 'another-internal-handle' }),
  )
})

test('finds one visual proposal by run, page, source hash and request id', () => {
  assert.equal(findVisualProposalByRequest([proposal], identity), proposal)
  assert.equal(findVisualProposalByRequest([proposal], { ...identity, runId: 'other-run' }), null)
})

test('refuses ambiguous stable request identities', () => {
  assert.throws(
    () => findVisualProposalByRequest([proposal, { ...proposal, id: 'proposal-02' }], identity),
    /ambiguous_visual_request/,
  )
})

test('creates an immutable internal receipt and closes acknowledgement idempotently', () => {
  const receipt = createVisualLinkReceipt({
    ...identity,
    proposalId: proposal.id,
    assetId: 'asset-01',
    pageAssetId: 'page-asset-01',
    revision: 8,
    linkedAt: '2026-09-07T06:00:00.000Z',
  })

  assert.equal(receipt.kind, 'report-studio.visual-link-receipt.v1')
  assert.equal(needsVisualLinkAcknowledgement({ ...proposal, linkReceipt: receipt }), true)

  const linked = acknowledgeVisualLinkReceipt(
    { ...proposal, linkReceipt: receipt },
    {
      identity,
      receiptHash: receipt.receiptHash,
      acknowledgedAt: '2026-09-07T06:01:00.000Z',
    },
  )
  assert.equal(linked.linkAcknowledgement.status, 'linked')
  assert.equal(needsVisualLinkAcknowledgement(linked), false)
  assert.deepEqual(
    acknowledgeVisualLinkReceipt(linked, {
      identity,
      receiptHash: receipt.receiptHash,
      acknowledgedAt: '2026-09-07T06:01:00.000Z',
    }),
    linked,
  )
})

test('rejects acknowledgements from another run or another stored receipt', () => {
  const receipt = createVisualLinkReceipt({
    ...identity,
    proposalId: proposal.id,
    assetId: 'asset-01',
    pageAssetId: 'page-asset-01',
    revision: 8,
    linkedAt: '2026-09-07T06:00:00.000Z',
  })

  assert.throws(
    () => acknowledgeVisualLinkReceipt(
      { ...proposal, linkReceipt: receipt },
      {
        identity: { ...identity, runId: 'other-run' },
        receiptHash: receipt.receiptHash,
        acknowledgedAt: '2026-09-07T06:01:00.000Z',
      },
    ),
    /visual_request_identity_mismatch/,
  )

  assert.throws(
    () => acknowledgeVisualLinkReceipt(
      { ...proposal, linkReceipt: receipt },
      {
        identity,
        receiptHash: 'sha256:other-receipt',
        acknowledgedAt: '2026-09-07T06:01:00.000Z',
      },
    ),
    /visual_link_receipt_mismatch/,
  )
})
