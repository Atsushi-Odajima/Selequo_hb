// Offline notes (PWA): notes written without a connection are queued in IndexedDB and synced later
// with client-generated ids (idempotent). Only notes are available offline — never project data.
import { api } from './api';

export interface PendingNote {
  id: string;
  ws: string;
  projectId: string;
  candidateId: string | null;
  body: string;
  createdAt: string;
}

const DB = 'selequo-offline';
const STORE = 'notes';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export const queueNote = (n: PendingNote) => tx('readwrite', (s) => s.put(n));
export const pendingNotes = () => tx<PendingNote[]>('readonly', (s) => s.getAll() as IDBRequest<PendingNote[]>);
const removeNote = (id: string) => tx('readwrite', (s) => s.delete(id));

export async function syncNotes(): Promise<number> {
  if (!navigator.onLine) return 0;
  let n = 0;
  for (const note of await pendingNotes()) {
    try {
      await api('POST', `/api/w/${note.ws}/projects/${note.projectId}/notes`, { id: note.id, candidateId: note.candidateId, body: note.body });
      await removeNote(note.id);
      n++;
    } catch {
      /* keep for next attempt */
    }
  }
  return n;
}

export function startNoteSync(onSynced: (n: number) => void) {
  const run = () => void syncNotes().then((n) => n && onSynced(n));
  window.addEventListener('online', run);
  run();
  return () => window.removeEventListener('online', run);
}
