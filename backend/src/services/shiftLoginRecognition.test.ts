import assert from 'node:assert/strict'
import test from 'node:test'
import { isWallTimeInShiftWindow } from './shiftLoginRecognition.js'

test('day shift 08:00–16:00', () => {
  assert.equal(isWallTimeInShiftWindow(8 * 60, 8 * 60, 16 * 60), true)
  assert.equal(isWallTimeInShiftWindow(12 * 60, 8 * 60, 16 * 60), true)
  assert.equal(isWallTimeInShiftWindow(16 * 60, 8 * 60, 16 * 60), false)
  assert.equal(isWallTimeInShiftWindow(7 * 60 + 59, 8 * 60, 16 * 60), false)
})

test('overnight 22:00–06:00', () => {
  assert.equal(isWallTimeInShiftWindow(22 * 60, 22 * 60, 6 * 60), true)
  assert.equal(isWallTimeInShiftWindow(23 * 60, 22 * 60, 6 * 60), true)
  assert.equal(isWallTimeInShiftWindow(3 * 60, 22 * 60, 6 * 60), true)
  assert.equal(isWallTimeInShiftWindow(12 * 60, 22 * 60, 6 * 60), false)
  assert.equal(isWallTimeInShiftWindow(6 * 60, 22 * 60, 6 * 60), false)
})
