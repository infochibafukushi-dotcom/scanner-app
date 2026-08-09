import { describe, expect, it } from 'vitest'
import { moveByOffset, reorderByIndex } from './pageOrder'

describe('page reorder', () => {
  it('reorders by index', () => {
    expect(reorderByIndex(['a', 'b', 'c', 'd', 'e'], 0, 4)).toEqual(['b', 'c', 'd', 'e', 'a'])
    expect(reorderByIndex(['a', 'b', 'c', 'd', 'e'], 4, 1)).toEqual(['a', 'e', 'b', 'c', 'd'])
    expect(reorderByIndex(['a', 'b', 'c', 'd', 'e'], 2, 0)).toEqual(['c', 'a', 'b', 'd', 'e'])
  })

  it('moves by offset using id', () => {
    const pages = [{ id: '1' }, { id: '2' }, { id: '3' }]
    expect(moveByOffset(pages, '2', -1).map((page) => page.id)).toEqual(['2', '1', '3'])
    expect(moveByOffset(pages, '1', 1).map((page) => page.id)).toEqual(['2', '1', '3'])
  })
})
