import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { labelForRef, rankRefMatches } from './suggestCandidates.js'
import type { AiRefItem } from './suggestTypes.js'

describe('suggestCandidates', () => {
  it('labelForRef combines key and name', () => {
    assert.equal(
      labelForRef({ id: 'x', key: 'A1', name: 'Pump' }),
      'A1 — Pump',
    )
  })

  it('rankRefMatches scores word overlap', () => {
    const items: AiRefItem[] = [
      { id: '11111111-1111-4111-8111-111111111111', key: 'P1', name: 'Main pump' },
      { id: '22222222-2222-4222-8222-222222222222', key: 'V2', name: 'Valve room' },
    ]
    const r = rankRefMatches('work on main pump today', items, 5)
    assert.ok(r.length >= 1)
    assert.equal(r[0]?.id, '11111111-1111-4111-8111-111111111111')
  })
})
