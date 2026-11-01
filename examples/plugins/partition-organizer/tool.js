async function run(input, context, api) {
  if (context.tool.name === 'list_partitions') return (await api.partitions.list()).partitions
  if (context.tool.name === 'create_project_partition') {
    return api.partitions.create({
      name: input.name,
      description: input.description,
      color: input.color,
      kind: 'project',
    })
  }
  throw new Error('Unknown tool')
}
