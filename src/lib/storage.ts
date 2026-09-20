import type { EditorDocument } from '../types'

const DB_NAME = 'typstability'
const STORE_NAME = 'sessions'
const ACTIVE_KEY = 'active-document'

export function normalizeDocument(document: EditorDocument): EditorDocument {
  return {
    ...document,
    prelude: document.prelude ?? '',
  }
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function saveSession(document: EditorDocument) {
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put(document, ACTIVE_KEY)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  database.close()
}

export async function loadSession() {
  const database = await openDatabase()
  const value = await new Promise<EditorDocument | undefined>((resolve, reject) => {
    const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).get(ACTIVE_KEY)
    request.onsuccess = () => resolve(request.result as EditorDocument | undefined)
    request.onerror = () => reject(request.error)
  })
  database.close()
  return value ? normalizeDocument(value) : undefined
}

export async function clearSession() {
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).delete(ACTIVE_KEY)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  database.close()
}
