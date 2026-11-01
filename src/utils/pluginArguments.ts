export type ToolSchema = {
  type?: string
  properties?: Record<string, Record<string, unknown>>
  required?: string[]
}

export function validateToolArguments(schema: ToolSchema | undefined, values: Record<string, unknown>): string[] {
  const errors: string[] = []
  const properties = schema?.properties ?? {}
  for (const name of schema?.required ?? []) {
    if (values[name] === undefined || values[name] === null || values[name] === '') errors.push(`缺少必填参数: ${name}`)
  }
  for (const [name, field] of Object.entries(properties)) {
    const value = values[name]
    if (value === undefined || value === null || value === '') continue
    const expected = field.type
    const valid = expected === 'string' ? typeof value === 'string'
      : expected === 'number' ? typeof value === 'number' && Number.isFinite(value)
      : expected === 'integer' ? typeof value === 'number' && Number.isInteger(value)
      : expected === 'boolean' ? typeof value === 'boolean'
      : expected === 'array' ? Array.isArray(value)
      : expected === 'object' ? typeof value === 'object' && !Array.isArray(value)
      : true
    if (!valid) errors.push(`参数 ${name} 类型应为 ${expected}`)
    if (Array.isArray(field.enum) && !field.enum.includes(value)) errors.push(`参数 ${name} 不在可选值中`)
    if (typeof value === 'number' && typeof field.minimum === 'number' && value < field.minimum) errors.push(`参数 ${name} 不能小于 ${field.minimum}`)
    if (typeof value === 'number' && typeof field.maximum === 'number' && value > field.maximum) errors.push(`参数 ${name} 不能大于 ${field.maximum}`)
  }
  return errors
}
