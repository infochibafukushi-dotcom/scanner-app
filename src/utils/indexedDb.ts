import type { FilterMode, PaperSize, Point, ProcessStatus, ScanPage } from '../types'
import { migratePaperSize } from './paper'

export const DB_NAME = 'scanner-app'
export const DB_VERSION = 2

export type DocumentMeta = {
  id: string
  fileName: string
  selectedId: string | null
  pageOrder: string[]
  updatedAt: number
  status: 'active' | 'archived'
}

type PageRecord = {
  id: string
  documentId: string
  name: string
  corners: [Point, Point, Point, Point]
  cornerDetection: ScanPage['cornerDetection']
  cornerConfidence?: number
  rotation: number
  filter: FilterMode
  clean: boolean
  paperSize: PaperSize
  ocrText?: string
  ocrStatus?: ProcessStatus
  ocrError?: string
  translationText?: string
  translationTarget?: string
  translationStatus?: ProcessStatus
  translationError?: string
  updatedAt: number
}

type ImageRecord = {
  pageId: string
  blob: Blob
  mimeType: string
}

export type PersistedDocument = {
  meta: DocumentMeta
  pages: ScanPage[]
}

const STORE_DOCUMENTS = 'documents'
const STORE_PAGES = 'pages'
const STORE_IMAGES = 'images'

let dbPromise: Promise<IDBDatabase> | null = null

const supportsIndexedDb = () => typeof indexedDB !== 'undefined'

export const isStorageAvailable = () => supportsIndexedDb()

const openDatabase = (): Promise<IDBDatabase> => {
  if (!supportsIndexedDb()) return Promise.reject(new Error('IndexedDB is not available'))
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => {
      dbPromise = null
      reject(request.error ?? new Error('Failed to open IndexedDB'))
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_DOCUMENTS)) {
        db.createObjectStore(STORE_DOCUMENTS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_PAGES)) {
        const pages = db.createObjectStore(STORE_PAGES, { keyPath: 'id' })
        pages.createIndex('documentId', 'documentId', { unique: false })
      }
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        db.createObjectStore(STORE_IMAGES, { keyPath: 'pageId' })
      }
    }
    request.onsuccess = () => resolve(request.result)
  })

  return dbPromise
}

export const migrateDatabase = async () => {
  if (!supportsIndexedDb()) return
  await openDatabase()
}

const txDone = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })

const requestToPromise = <T,>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })

const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
  if (dataUrl.startsWith('blob:')) {
    const response = await fetch(dataUrl)
    return response.blob()
  }
  const response = await fetch(dataUrl)
  return response.blob()
}

const blobToObjectUrl = (blob: Blob) => URL.createObjectURL(blob)

export const revokePageUrls = (pages: ScanPage[]) => {
  for (const page of pages) {
    if (page.dataUrl.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(page.dataUrl)
      } catch {
        /* ignore */
      }
    }
  }
}

const toPageRecord = (page: ScanPage, documentId: string): PageRecord => ({
  id: page.id,
  documentId,
  name: page.name,
  corners: page.corners,
  cornerDetection: page.cornerDetection,
  cornerConfidence: page.cornerConfidence,
  rotation: page.rotation,
  filter: page.filter,
  clean: page.clean,
  paperSize: migratePaperSize(page),
  ocrText: page.ocrText,
  ocrStatus: page.ocrStatus,
  ocrError: page.ocrError,
  translationText: page.translationText,
  translationTarget: page.translationTarget,
  translationStatus: page.translationStatus,
  translationError: page.translationError,
  updatedAt: Date.now()
})

const fromPageRecord = (record: PageRecord, dataUrl: string): ScanPage => ({
  id: record.id,
  name: record.name,
  dataUrl,
  corners: record.corners,
  cornerDetection: record.cornerDetection,
  cornerConfidence: record.cornerConfidence,
  rotation: record.rotation,
  filter: record.filter,
  clean: record.clean,
  paperSize: migratePaperSize(record),
  ocrText: record.ocrText,
  ocrStatus: record.ocrStatus,
  ocrError: record.ocrError,
  translationText: record.translationText,
  translationTarget: record.translationTarget,
  translationStatus: record.translationStatus,
  translationError: record.translationError
})

export const estimateStorage = async () => {
  try {
    const estimate = await navigator.storage?.estimate?.()
    if (!estimate) return null
    return {
      usage: estimate.usage ?? 0,
      quota: estimate.quota ?? 0
    }
  } catch {
    return null
  }
}

export const loadActiveDocument = async (): Promise<PersistedDocument | null> => {
  const db = await openDatabase()
  const tx = db.transaction([STORE_DOCUMENTS, STORE_PAGES, STORE_IMAGES], 'readonly')
  const docs = tx.objectStore(STORE_DOCUMENTS)
  const allDocs = await requestToPromise(docs.getAll() as IDBRequest<DocumentMeta[]>)
  const active =
    allDocs
      .filter((doc) => doc.status === 'active')
      .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
  if (!active || !active.pageOrder.length) {
    await txDone(tx)
    return null
  }

  const pageStore = tx.objectStore(STORE_PAGES)
  const imageStore = tx.objectStore(STORE_IMAGES)
  const pages: ScanPage[] = []
  for (const pageId of active.pageOrder) {
    const record = await requestToPromise(pageStore.get(pageId) as IDBRequest<PageRecord | undefined>)
    const image = await requestToPromise(imageStore.get(pageId) as IDBRequest<ImageRecord | undefined>)
    if (!record || !image) continue
    pages.push(fromPageRecord(record, blobToObjectUrl(image.blob)))
  }
  await txDone(tx)
  if (!pages.length) return null
  return { meta: active, pages }
}

export const saveDocument = async (params: {
  documentId: string
  fileName: string
  selectedId: string | null
  pages: ScanPage[]
}): Promise<void> => {
  const db = await openDatabase()
  const tx = db.transaction([STORE_DOCUMENTS, STORE_PAGES, STORE_IMAGES], 'readwrite')
  const docStore = tx.objectStore(STORE_DOCUMENTS)
  const pageStore = tx.objectStore(STORE_PAGES)
  const imageStore = tx.objectStore(STORE_IMAGES)

  const existingPages = await requestToPromise(
    pageStore.index('documentId').getAll(params.documentId) as IDBRequest<PageRecord[]>
  )
  const keep = new Set(params.pages.map((page) => page.id))
  for (const old of existingPages) {
    if (!keep.has(old.id)) {
      pageStore.delete(old.id)
      imageStore.delete(old.id)
    }
  }

  for (const page of params.pages) {
    pageStore.put(toPageRecord(page, params.documentId))
    const blob = await dataUrlToBlob(page.dataUrl)
    const image: ImageRecord = {
      pageId: page.id,
      blob,
      mimeType: blob.type || 'image/jpeg'
    }
    imageStore.put(image)
  }

  const meta: DocumentMeta = {
    id: params.documentId,
    fileName: params.fileName,
    selectedId: params.selectedId,
    pageOrder: params.pages.map((page) => page.id),
    updatedAt: Date.now(),
    status: 'active'
  }
  docStore.put(meta)
  await txDone(tx)
}

export const clearActiveDocument = async (documentId: string) => {
  const db = await openDatabase()
  const tx = db.transaction([STORE_DOCUMENTS, STORE_PAGES, STORE_IMAGES], 'readwrite')
  const pageStore = tx.objectStore(STORE_PAGES)
  const imageStore = tx.objectStore(STORE_IMAGES)
  const existingPages = await requestToPromise(
    pageStore.index('documentId').getAll(documentId) as IDBRequest<PageRecord[]>
  )
  for (const page of existingPages) {
    pageStore.delete(page.id)
    imageStore.delete(page.id)
  }
  // Keep meta as archived for future history extension.
  const docStore = tx.objectStore(STORE_DOCUMENTS)
  const existing = await requestToPromise(docStore.get(documentId) as IDBRequest<DocumentMeta | undefined>)
  if (existing) {
    docStore.put({ ...existing, status: 'archived', pageOrder: [], selectedId: null, updatedAt: Date.now() })
  }
  await txDone(tx)
}

export const deletePage = async (pageId: string) => {
  const db = await openDatabase()
  const tx = db.transaction([STORE_PAGES, STORE_IMAGES], 'readwrite')
  tx.objectStore(STORE_PAGES).delete(pageId)
  tx.objectStore(STORE_IMAGES).delete(pageId)
  await txDone(tx)
}

export const isQuotaExceededError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false
  const name = (error as { name?: string }).name
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED'
}
