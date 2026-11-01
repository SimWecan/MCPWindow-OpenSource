import test from 'node:test'
import assert from 'node:assert/strict'
import { edgeScrollSpeed } from './interactions.js'

test('扩展拖动在窗口边缘滚动并在中部停止', () => {
  assert.equal(edgeScrollSpeed(360, 0, 720), 0)
  assert.equal(edgeScrollSpeed(0, 0, 720), -18)
  assert.equal(edgeScrollSpeed(720, 0, 720), 18)
  assert.ok(edgeScrollSpeed(700, 0, 720) > 0)
  assert.ok(edgeScrollSpeed(700, 0, 720) < 18)
})

test('扩展自动避让限制最大速度并处理无效区域', () => {
  assert.equal(edgeScrollSpeed(-100, 0, 720), -18)
  assert.equal(edgeScrollSpeed(900, 0, 720), 18)
  assert.equal(edgeScrollSpeed(20, 100, 100), 0)
})
