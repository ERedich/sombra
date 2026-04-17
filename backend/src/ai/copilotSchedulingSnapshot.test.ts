import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveCopilotSchedulingDateParam } from './copilotSchedulingSnapshot.js'

describe('resolveCopilotSchedulingDateParam', () => {
  it('passes through YYYY-MM-DD', () => {
    const r = resolveCopilotSchedulingDateParam('2026-04-17', 'de')
    assert.deepEqual(r, { ok: true, iso: '2026-04-17' })
  })

  it('strips time suffix from ISO datetime', () => {
    const r = resolveCopilotSchedulingDateParam(
      '2026-04-17T12:00:00.000Z',
      'en',
    )
    assert.deepEqual(r, { ok: true, iso: '2026-04-17' })
  })

  it('parses German DD.MM.YYYY as DMY', () => {
    const r = resolveCopilotSchedulingDateParam('17.04.2026', 'de')
    assert.deepEqual(r, { ok: true, iso: '2026-04-17' })
  })

  it('parses 17. Apr. 2026 (German month)', () => {
    const r = resolveCopilotSchedulingDateParam('17. Apr. 2026', 'de')
    assert.deepEqual(r, { ok: true, iso: '2026-04-17' })
  })

  it('parses April 17 2026 (English month)', () => {
    const r = resolveCopilotSchedulingDateParam('17 April 2026', 'en')
    assert.deepEqual(r, { ok: true, iso: '2026-04-17' })
  })

  it('rejects ambiguous M/D when both parts <=12 for en', () => {
    const r = resolveCopilotSchedulingDateParam('03/04/2026', 'en')
    assert.equal(r.ok, false)
  })

  it('accepts DD/MM/YYYY for en-GB as DMY', () => {
    const r = resolveCopilotSchedulingDateParam('17/04/2026', 'en-GB')
    assert.deepEqual(r, { ok: true, iso: '2026-04-17' })
  })
})
