// Runtime offline helpers: connectivity detection + re-exports of the IndexedDB queue.

export {
  getDB,
  enqueueMutation,
  listPendingQueue,
  countPendingQueue,
  updateQueueItem,
  deleteQueueItem,
  cacheProject,
  cacheProjects,
  getCachedProjects,
  cachePlans,
  getCachedPlansByProject,
  cacheMarkups,
  getCachedMarkupsByPlan,
  cacheTasks,
  getCachedTasksByProject,
  getCachedTask,
  cacheTask,
  cacheComments,
  getCachedCommentsByTask,
  cacheNotifications,
  getCachedNotifications,
  dropCachedTask,
  getSyncCursor,
  setSyncCursor,
  newer,
  genLocalId,
  type QueueItem,
} from './idb'

let _online: boolean = typeof navigator !== 'undefined' ? navigator.onLine : true
let _idbAvailable: boolean | null = null

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    _online = true
    window.dispatchEvent(new CustomEvent('planforge:online'))
  })
  window.addEventListener('offline', () => {
    _online = false
    window.dispatchEvent(new CustomEvent('planforge:offline'))
  })
}

export function isOnline(): boolean {
  if (typeof navigator !== 'undefined') return navigator.onLine && _online
  return true
}

export function isIdbAvailable(): boolean {
  if (_idbAvailable !== null) return _idbAvailable
  if (typeof indexedDB === 'undefined') {
    _idbAvailable = false
    return false
  }
  // Quick feature test
  try {
    const test = indexedDB.open('__planforge_test__')
    test.onerror = () => { _idbAvailable = false }
    test.onsuccess = () => { _idbAvailable = true; test.result.close(); indexedDB.deleteDatabase('__planforge_test__') }
    _idbAvailable = true
    return true
  } catch {
    _idbAvailable = false
    return false
  }
}

export function onConnectivityChange(cb: (online: boolean) => void): () => void {
  const handler = (e: Event) => cb(e.type === 'planforge:online')
  window.addEventListener('planforge:online', handler as EventListener)
  window.addEventListener('planforge:offline', handler as EventListener)
  return () => {
    window.removeEventListener('planforge:online', handler as EventListener)
    window.removeEventListener('planforge:offline', handler as EventListener)
  }
}
