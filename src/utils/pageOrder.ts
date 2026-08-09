/** Pure reorder helper used by UI and unit tests. */
export const reorderByIndex = <T,>(items: T[], fromIndex: number, toIndex: number): T[] => {
  if (fromIndex === toIndex) return items
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) return items
  const next = [...items]
  const [item] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, item)
  return next
}

export const moveByOffset = <T extends { id: string }>(
  items: T[],
  pageId: string,
  direction: -1 | 1
): T[] => {
  const index = items.findIndex((item) => item.id === pageId)
  if (index < 0) return items
  return reorderByIndex(items, index, index + direction)
}
