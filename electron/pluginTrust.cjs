const { createHash } = require('node:crypto')

function stableSerialize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`
}

function pluginDigest(manifest, entry) {
  const unsigned = { ...manifest }
  delete unsigned.signature
  const hash = createHash('sha256')
  hash.update(stableSerialize(unsigned))
  hash.update('\0')
  hash.update(entry)
  return `sha256:${hash.digest('hex')}`
}

function verifyPluginSignature(manifest, entry) {
  const signature = manifest.signature
  if (!signature) return 'unsigned'
  if (!/^sha256:[a-f0-9]{64}$/.test(signature)) return 'invalid'
  return signature === pluginDigest(manifest, entry) ? 'valid' : 'invalid'
}

function compareVersions(left, right) {
  const parse = (value) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value)
    if (!match) throw new Error('插件版本必须符合 SemVer，例如 1.2.0')
    return { numbers: match.slice(1, 4).map(Number), pre: match[4]?.split('.') ?? [] }
  }
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < 3; index += 1) if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] > b.numbers[index] ? 1 : -1
  if (a.pre.length === b.pre.length) {
    for (let index = 0; index < a.pre.length; index += 1) {
      if (a.pre[index] === b.pre[index]) continue
      const an = /^\d+$/.test(a.pre[index])
      const bn = /^\d+$/.test(b.pre[index])
      if (an && bn) return Number(a.pre[index]) > Number(b.pre[index]) ? 1 : -1
      if (an !== bn) return an ? -1 : 1
      return a.pre[index] > b.pre[index] ? 1 : -1
    }
  }
  if (a.pre.length !== b.pre.length) return a.pre.length === 0 ? 1 : -1
  return 0
}

module.exports = { stableSerialize, pluginDigest, verifyPluginSignature, compareVersions }
