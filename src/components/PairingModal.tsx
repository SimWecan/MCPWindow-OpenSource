import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import Modal from './Modal'
import { useTranslation } from '../i18n'
import { bridge, type TunnelStatus } from '../utils/bridge'
import type { PairingStatus } from '../utils/pairing'

interface Props {
  open: boolean
  onClose: () => void
}

export default function PairingModal({ open, onClose }: Props) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<PairingStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [notice, setNotice] = useState('')
  const [revealToken, setRevealToken] = useState(false)
  const [tunnel, setTunnel] = useState<TunnelStatus | null>(null)
  const [tunnelQr, setTunnelQr] = useState('')
  const [tunnelBusy, setTunnelBusy] = useState(false)
  const api = bridge()

  const refresh = useCallback(async () => {
    if (!api?.pairingStatus) return
    setStatus(await api.pairingStatus())
  }, [api])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  const lanUrl = (address: string, port: number | null) => `http://${address}:${port ?? 42101}`

  const qrKey = status?.running && status.addresses.length && status.port
    ? `${status.addresses[0]}|${status.port}|${status.token}`
    : ''

  useEffect(() => {
    if (!qrKey) { setQrDataUrl(''); return }
    const [address, port, token] = qrKey.split('|')
    const payload = `mcpwindow://pair/v1?host=${encodeURIComponent(address)}&port=${port}&token=${encodeURIComponent(token)}`
    let cancelled = false
    void QRCode.toDataURL(payload, { width: 232, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => { if (!cancelled) setQrDataUrl(url) })
      .catch(() => { if (!cancelled) setQrDataUrl('') })
    return () => { cancelled = true }
  }, [qrKey])

  useEffect(() => {
    if (!open) return
    const timer = setInterval(() => { void refresh() }, 3000)
    return () => clearInterval(timer)
  }, [open, refresh])

  // 远程访问隧道：打开弹窗时同步一次状态，弹窗关闭时停止轮询（隧道本身保持运行）
  const refreshTunnel = useCallback(async () => {
    if (!api?.tunnelStatus) return
    setTunnel(await api.tunnelStatus())
  }, [api])

  useEffect(() => {
    if (open) void refreshTunnel()
  }, [open, refreshTunnel])

  // 远程二维码：tls=1 表示 https 隧道地址，手机可在任意网络下扫码连接
  useEffect(() => {
    if (!tunnel?.running || !tunnel.url || !status?.token) { setTunnelQr(''); return }
    let hostname = tunnel.url
    try { hostname = new URL(tunnel.url).hostname } catch { /* 用原始串 */ }
    const payload = `mcpwindow://pair/v1?host=${encodeURIComponent(hostname)}&port=443&token=${encodeURIComponent(status.token)}&tls=1`
    let cancelled = false
    void QRCode.toDataURL(payload, { width: 232, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => { if (!cancelled) setTunnelQr(url) })
      .catch(() => { if (!cancelled) setTunnelQr('') })
    return () => { cancelled = true }
  }, [tunnel?.running, tunnel?.url, status?.token])

  const toggleTunnel = async () => {
    if (!api) return
    setTunnelBusy(true)
    setNotice('')
    try {
      const next = tunnel?.running
        ? await api.tunnelStop?.()
        : await api.tunnelStart?.(status?.port ?? 42101)
      if (next) {
        setTunnel(next)
        setNotice(t(next.error ? '远程链接创建失败，请确认已安装 cloudflared 后重试。' : next.running ? '远程链接已生成，手机可在任意网络下扫码连接。' : '远程链接已关闭。'))
      }
    } finally {
      setTunnelBusy(false)
    }
  }

  const copyTunnelUrl = async () => {
    if (!tunnel?.url) return
    try {
      await navigator.clipboard.writeText(tunnel.url)
      setNotice(t('远程链接已复制到剪贴板。'))
    } catch {
      setNotice(tunnel.url)
    }
  }

  const run = async (action: () => Promise<PairingStatus | undefined> | undefined, message: string) => {
    setBusy(true)
    setNotice('')
    try {
      const next = await action()
      if (next) setStatus(next)
      if (message) setNotice(t(message))
    } finally {
      setBusy(false)
    }
  }

  const copyPairingInfo = async () => {
    if (!status?.running || !status.port) return
    const lines = status.addresses.map((address) => lanUrl(address, status.port))
    const text = `${lines.join('\n')}\ntoken=${status.token}`
    try {
      await navigator.clipboard.writeText(text)
      setNotice(t('配对信息已复制到剪贴板。'))
    } catch {
      setNotice(text)
    }
  }

  return (
    <Modal title={t('移动端配对')} open={open} onClose={onClose}>
      {!api?.pairingStatus ? (
        <p className="empty">{t('配对服务仅在 MCPWindow 桌面版中可用。')}</p>
      ) : (
        <div className="pairing-body">
          <label className="pairing-toggle">
            <input
              type="checkbox"
              checked={status?.running ?? false}
              disabled={busy}
              onChange={(event) => {
                const enabled = event.target.checked
                void run(() => api.pairingSetEnabled?.(enabled), enabled ? '配对服务已开启。' : '配对服务已关闭。')
              }}
            />
            <span>{t('启用配对服务（同一局域网可用）')}</span>
          </label>

          {status?.running ? (
            <div className="pairing-active">
              <p className="pairing-hint">{t('使用 MCPWindow 移动端扫描二维码，或在移动端设置中手动输入地址与令牌。')}</p>
              {qrDataUrl && <img className="pairing-qr" src={qrDataUrl} alt="配对二维码" />}
              <div className="pairing-urls">
                {status.addresses.map((address) => (
                  <code key={address}>{lanUrl(address, status.port)}</code>
                ))}
              </div>
              <div className="pairing-token">
                <span>{t('配对令牌')}：</span>
                <code>{revealToken ? status.token : '••••••••••••'}</code>
                <button className="btn ghost" onClick={() => setRevealToken((value) => !value)}>
                  {revealToken ? t('隐藏') : t('显示')}
                </button>
              </div>
              <p className="pairing-meta">
                {t(`配对服务运行中 · 端口 ${status.port} · 已连接 ${status.deviceCount} 台设备`)}
              </p>
              <div className="pairing-actions">
                <button className="btn ghost" onClick={() => void copyPairingInfo()}>{t('复制配对信息')}</button>
                <button
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => void run(() => api.pairingRegenerateToken?.(), '令牌已重新生成，旧令牌立即失效。')}
                >
                  {t('重新生成令牌')}
                </button>
              </div>
            </div>
          ) : (
            <p className="pairing-hint">{t('开启后，同一局域网内的手机即可查看服务器状态、接收告警并远程启停。')}</p>
          )}

          {api?.tunnelStatus && (
            <div className="pairing-remote">
              <div className="pairing-remote-head">
                <span>{t('远程访问（任意网络可用）')}</span>
                <button className="btn ghost" disabled={tunnelBusy || !status?.running} onClick={() => void toggleTunnel()}>
                  {tunnel?.running ? t('关闭远程链接') : t('生成远程链接')}
                </button>
              </div>
              {!status?.running ? (
                <p className="pairing-hint">{t('请先开启配对服务，再生成远程链接。')}</p>
              ) : tunnel?.running && tunnel.url ? (
                <div className="pairing-active">
                  {tunnelQr && <img className="pairing-qr" src={tunnelQr} alt={t('远程配对二维码')} />}
                  <div className="pairing-urls"><code>{tunnel.url}</code></div>
                  <div className="pairing-actions">
                    <button className="btn ghost" onClick={() => void copyTunnelUrl()}>{t('复制远程链接')}</button>
                  </div>
                  <p className="pairing-meta">{t('手机可在任意网络环境下扫描上方二维码。远程链接每次生成都不同，关闭后即刻失效。')}</p>
                </div>
              ) : (
                <p className="pairing-hint">{t('通过 cloudflared 快速隧道生成公网 HTTPS 链接，手机无需与电脑处于同一网络。')}</p>
              )}
            </div>
          )}
          {notice && <p className="pairing-notice">{notice}</p>}
        </div>
      )}
    </Modal>
  )
}
