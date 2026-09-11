import { createHash } from 'node:crypto'

const IDENTITY_FIELDS = Object.freeze([
  'sessionId',
  'projectId',
  'runId',
  'pageId',
  'sourceStateHash',
  'requestId',
])

function fail(code, message = code) {
  throw Object.assign(new Error(`${code}: ${message}`), { code })
}

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) fail('invalid_visual_request_identity', `${field} is required`)
  return value
}

function identityFrom(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_visual_request_identity')
  return Object.freeze(Object.fromEntries(
    IDENTITY_FIELDS.map(field => [field, requiredText(value[field], field)]),
  ))
}

function sameIdentity(left, right) {
  return visualRequestIdentityKey(left) === visualRequestIdentityKey(right)
}

function stableReceiptPayload(value) {
  return {
    kind: 'report-studio.visual-link-receipt.v1',
    ...identityFrom(value),
    proposalId: requiredText(value.proposalId, 'proposalId'),
    assetId: requiredText(value.assetId, 'assetId'),
    pageAssetId: requiredText(value.pageAssetId, 'pageAssetId'),
    revision: value.revision,
    linkedAt: requiredText(value.linkedAt, 'linkedAt'),
  }
}

export function visualRequestIdentityKey(value) {
  const identity = identityFrom(value)
  return IDENTITY_FIELDS.map(field => `${field.length}:${field}=${identity[field].length}:${identity[field]}`).join('|')
}

export function findVisualProposalByRequest(proposals, requestIdentity) {
  if (!Array.isArray(proposals)) fail('invalid_visual_proposal_collection')
  const key = visualRequestIdentityKey(requestIdentity)
  const matches = proposals.filter(row => row?.kind === 'design.visual.v1' && visualRequestIdentityKey(row) === key)
  if (matches.length > 1) fail('ambiguous_visual_request')
  return matches[0] ?? null
}

export function createVisualLinkReceipt(input) {
  if (!Number.isSafeInteger(input?.revision) || input.revision < 0) fail('invalid_visual_link_revision')
  const payload = stableReceiptPayload(input)
  const receiptHash = `sha256:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`
  return Object.freeze({ ...payload, receiptHash })
}

export function needsVisualLinkAcknowledgement(proposal) {
  return Boolean(proposal?.linkReceipt?.receiptHash) && proposal?.linkAcknowledgement?.status !== 'linked'
}

export function acknowledgeVisualLinkReceipt(proposal, acknowledgement) {
  if (!proposal || proposal.kind !== 'design.visual.v1') fail('invalid_visual_proposal')
  if (!proposal.linkReceipt?.receiptHash) fail('visual_link_receipt_missing')

  const acknowledgementIdentity = identityFrom(acknowledgement?.identity)
  if (!sameIdentity(proposal, acknowledgementIdentity) || !sameIdentity(proposal.linkReceipt, acknowledgementIdentity)) {
    fail('visual_request_identity_mismatch')
  }
  if (acknowledgement.receiptHash !== proposal.linkReceipt.receiptHash) fail('visual_link_receipt_mismatch')
  const acknowledgedAt = requiredText(acknowledgement.acknowledgedAt, 'acknowledgedAt')

  const existing = proposal.linkAcknowledgement
  if (existing) {
    if (
      existing.status === 'linked'
      && existing.receiptHash === acknowledgement.receiptHash
      && sameIdentity(existing.identity, acknowledgementIdentity)
    ) return proposal
    fail('visual_link_acknowledgement_conflict')
  }

  return {
    ...proposal,
    linkAcknowledgement: Object.freeze({
      kind: 'pre-design.visual-link-acknowledgement.v1',
      status: 'linked',
      identity: acknowledgementIdentity,
      receiptHash: acknowledgement.receiptHash,
      acknowledgedAt,
    }),
  }
}
