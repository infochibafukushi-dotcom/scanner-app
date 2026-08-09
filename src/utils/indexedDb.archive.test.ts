import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ScanPage } from '../types'
import {
  archiveDocument,
  countImagesForPageIds,
  countPagesForDocument,
  getDocumentMeta,
  listDocumentMetas,
  loadActiveDocument,
  resetIndexedDbForTests,
  saveDocument
} from './indexedDb'

const tinyJpeg =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//Z'

const corners = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 }
] as ScanPage['corners']

const makePage = (id: string, name: string): ScanPage => ({
  id,
  name,
  dataUrl: tinyJpeg,
  corners,
  cornerDetection: 'auto',
  cornerConfidence: 0.8,
  rotation: 0,
  filter: 'color',
  clean: false,
  bookFlatten: 'off',
  paperSize: 'auto',
  ocrStatus: 'idle',
  translationStatus: 'idle'
})

describe('indexedDb archiveDocument', () => {
  beforeEach(async () => {
    await resetIndexedDbForTests()
  })

  afterEach(async () => {
    await resetIndexedDbForTests()
  })

  it('keeps pages/images/pageOrder when archiving and only restores the active document', async () => {
    const oldId = 'doc-old'
    const pages = [makePage('p1', 'a'), makePage('p2', 'b'), makePage('p3', 'c')]
    await saveDocument({
      documentId: oldId,
      fileName: 'old-scan.pdf',
      selectedId: 'p2',
      pages
    })

    await archiveDocument(oldId)

    const archived = await getDocumentMeta(oldId)
    expect(archived?.status).toBe('archived')
    expect(archived?.pageOrder).toEqual(['p1', 'p2', 'p3'])
    expect(archived?.fileName).toBe('old-scan.pdf')
    expect(archived?.selectedId).toBe('p2')
    expect(await countPagesForDocument(oldId)).toBe(3)
    expect(await countImagesForPageIds(['p1', 'p2', 'p3'])).toBe(3)

    const newId = 'doc-new'
    await saveDocument({
      documentId: newId,
      fileName: 'new-scan.pdf',
      selectedId: null,
      pages: []
    })

    const metas = await listDocumentMetas()
    expect(metas.find((doc) => doc.id === oldId)?.status).toBe('archived')
    expect(metas.find((doc) => doc.id === newId)?.status).toBe('active')

    // Empty active document is not restored as pages.
    expect(await loadActiveDocument()).toBeNull()

    await saveDocument({
      documentId: newId,
      fileName: 'new-scan.pdf',
      selectedId: 'n1',
      pages: [makePage('n1', 'only')]
    })

    const restored = await loadActiveDocument()
    expect(restored?.meta.id).toBe(newId)
    expect(restored?.meta.status).toBe('active')
    expect(restored?.pages).toHaveLength(1)
    expect(restored?.pages[0].id).toBe('n1')

    // Archived document data still present after active restore path.
    expect(await getDocumentMeta(oldId)).toMatchObject({
      status: 'archived',
      pageOrder: ['p1', 'p2', 'p3']
    })
    expect(await countPagesForDocument(oldId)).toBe(3)
  })

  it('persists optional bookSpineSide through save/load', async () => {
    const page = {
      ...makePage('s1', 'left-half'),
      bookFlatten: 'precise' as const,
      bookSpineSide: 'right' as const,
      paperSize: 'free' as const
    }
    await saveDocument({
      documentId: 'spine-doc',
      fileName: 'spine.pdf',
      selectedId: 's1',
      pages: [page]
    })
    const restored = await loadActiveDocument()
    expect(restored?.pages[0].bookSpineSide).toBe('right')
    expect(restored?.pages[0].bookFlatten).toBe('precise')
  })
})
