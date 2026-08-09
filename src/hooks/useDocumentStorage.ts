import { useEffect, useRef, useState } from 'react'
import type { SaveStatus, ScanPage } from '../types'
import {
  clearActiveDocument,
  estimateStorage,
  isQuotaExceededError,
  isStorageAvailable,
  loadActiveDocument,
  migrateDatabase,
  revokePageUrls,
  saveDocument
} from '../utils/indexedDb'

type Options = {
  pages: ScanPage[]
  selectedId: string | null
  fileName: string
  onRestore: (payload: { pages: ScanPage[]; selectedId: string | null; fileName: string }) => void
  enabled?: boolean
}

export const useDocumentStorage = ({
  pages,
  selectedId,
  fileName,
  onRestore,
  enabled = true
}: Options) => {
  const [documentId, setDocumentId] = useState<string>(() => crypto.randomUUID())
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [storageWarning, setStorageWarning] = useState<string | null>(null)
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null)
  const readyRef = useRef(false)
  const hydratedRef = useRef(false)
  const pagesRef = useRef(pages)
  pagesRef.current = pages
  const onRestoreRef = useRef(onRestore)
  onRestoreRef.current = onRestore

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    ;(async () => {
      if (!isStorageAvailable()) {
        setSaveStatus('unavailable')
        setStorageWarning('自動保存を利用できません')
        readyRef.current = true
        hydratedRef.current = true
        return
      }
      try {
        await migrateDatabase()
        const restored = await loadActiveDocument()
        if (cancelled) return
        if (restored?.pages.length) {
          setDocumentId(restored.meta.id)
          onRestoreRef.current({
            pages: restored.pages,
            selectedId: restored.meta.selectedId,
            fileName: restored.meta.fileName
          })
          setRestoreMessage(`前回の作業を復元しました（${restored.pages.length}ページ）`)
          window.setTimeout(() => setRestoreMessage(null), 4000)
          setSaveStatus('saved')
        }
      } catch (error) {
        console.warn('IndexedDB restore failed', error)
        setSaveStatus('unavailable')
        setStorageWarning('自動保存を利用できません')
      } finally {
        if (!cancelled) {
          readyRef.current = true
          hydratedRef.current = true
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled || !hydratedRef.current || !readyRef.current) return
    if (!isStorageAvailable()) return

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          setSaveStatus('saving')
          const estimate = await estimateStorage()
          if (estimate && estimate.quota > 0 && estimate.usage / estimate.quota > 0.95) {
            setStorageWarning('端末の保存容量が不足しています')
          }
          await saveDocument({
            documentId,
            fileName,
            selectedId,
            pages: pagesRef.current
          })
          setSaveStatus('saved')
          setStorageWarning((current) =>
            current === '端末の保存容量が不足しています' ? current : null
          )
        } catch (error) {
          console.warn('IndexedDB save failed', error)
          if (isQuotaExceededError(error)) {
            setStorageWarning('端末の保存容量が不足しています')
            setSaveStatus('error')
          } else {
            setSaveStatus('unavailable')
            setStorageWarning('自動保存を利用できません')
          }
        }
      })()
    }, 700)

    return () => window.clearTimeout(timer)
  }, [documentId, enabled, fileName, pages, selectedId])

  useEffect(() => {
    return () => {
      revokePageUrls(pagesRef.current)
    }
  }, [])

  const startNewDocument = async () => {
    const previous = pagesRef.current
    try {
      if (isStorageAvailable()) {
        await clearActiveDocument(documentId)
      }
    } catch (error) {
      console.warn('Failed to archive document', error)
    }
    revokePageUrls(previous)
    const nextId = crypto.randomUUID()
    setDocumentId(nextId)
    setSaveStatus('idle')
    setRestoreMessage(null)
    return nextId
  }

  return {
    documentId,
    saveStatus,
    storageWarning,
    restoreMessage,
    dismissRestoreMessage: () => setRestoreMessage(null),
    startNewDocument
  }
}
