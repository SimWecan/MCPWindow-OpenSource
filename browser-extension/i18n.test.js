import test from 'node:test'
import assert from 'node:assert/strict'
import { translate } from './i18n.js'

test('浏览器插件核心功能提供中英文文案', () => {
  assert.equal(translate('尚未添加远程 MCP 服务器', 'en'), 'No remote MCP servers yet')
  assert.equal(translate('智能识别并填写', 'en'), 'Parse and fill')
  assert.equal(translate('清空记录', 'en'), 'Clear history')
  assert.equal(translate('在线', 'zh'), '在线')
  assert.equal(translate('用户自定义名称', 'en'), '用户自定义名称')
})
