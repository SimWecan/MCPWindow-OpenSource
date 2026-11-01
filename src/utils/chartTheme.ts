/** ECharts 绘制在 Canvas 中，需要读取当前主题的实际颜色而不是 CSS 变量名。 */
export function chartColors() {
  const styles = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback
  const accent = read('--accent', '#a855f7')
  return {
    accent,
    accentSoft: read('--accent-soft', 'rgba(168,85,247,.14)'),
    text: read('--text', '#f4f0fa'),
    text2: read('--text-2', '#b8accb'),
    text3: read('--text-3', '#847791'),
    surface: read('--bg-2', '#191426'),
    border: read('--border', '#382a4e'),
    grid: read('--chart-grid', 'rgba(112,86,143,.28)'),
    green: read('--green', '#34d399'),
    red: read('--red', '#fb7185'),
    orange: read('--orange', '#fbbf24'),
    purple: read('--purple', '#c084fc'),
    palette: [accent, read('--green', '#34d399'), read('--orange', '#fbbf24'), read('--purple', '#c084fc'), read('--red', '#fb7185'), '#38bdf8'],
  }
}
