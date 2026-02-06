/**
 * Composer Store - one-shot insert requests for the chat input
 *
 * This store provides a small queue of insert requests that can be
 * consumed by the InputArea to append text into the composer.
 */

import { create } from 'zustand'

export interface InsertRequest {
  id: string
  text: string
  source?: 'skill' | 'agent'
}

interface ComposerState {
  insertQueue: InsertRequest[]
  requestInsert: (text: string, source?: InsertRequest['source']) => void
  dequeueInsert: (id: string) => void
  clearInserts: () => void
}

const createInsertId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

export const useComposerStore = create<ComposerState>((set) => ({
  insertQueue: [],

  requestInsert: (text, source) =>
    set((state) => ({
      insertQueue: [...state.insertQueue, { id: createInsertId(), text, source }]
    })),

  dequeueInsert: (id) =>
    set((state) => ({
      insertQueue: state.insertQueue.filter((item) => item.id !== id)
    })),

  clearInserts: () => set({ insertQueue: [] })
}))
