import { useEffect, useMemo, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { ECharts, EChartsCoreOption } from 'echarts/core'
import { useTranslation } from '../i18n'

echarts.use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

interface Props {
  option: EChartsCoreOption
  height?: number
  onEvents?: Record<string, (params: unknown) => void>
}

function localize(value: unknown, t: (text: string) => string): unknown {
  if (typeof value === 'string') return t(value)
  if (Array.isArray(value)) return value.map((item) => localize(item, t))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, localize(item, t)]))
  return value
}

export default function EChart({ option, height = 300, onEvents }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ECharts | null>(null)
  const eventsRef = useRef<Record<string, (params: unknown) => void>>({})
  const { language, t } = useTranslation()
  const localizedOption = useMemo(() => localize(option, t) as EChartsCoreOption, [option, language]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current)
    chartRef.current = chart
    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(ref.current)
    return () => {
      ro.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.setOption(localizedOption, true)
    for (const evt of Object.keys(eventsRef.current)) chart.off(evt)
    for (const [evt, fn] of Object.entries(onEvents ?? {})) chart.on(evt, fn)
    eventsRef.current = onEvents ?? {}
  }, [localizedOption, onEvents])

  return <div ref={ref} className="chart" style={{ height }} />
}
