import { create } from "zustand"
import { persist } from "zustand/middleware"

interface DiffCommitState {
  checkedPathsByChatId: Record<string, Record<string, boolean>>
  reconcileChat: (chatId: string, paths: string[]) => void
  setChecked: (chatId: string, path: string, checked: boolean) => void
}

export const useDiffCommitStore = create<DiffCommitState>()(
  persist(
    (set) => ({
      checkedPathsByChatId: {},
      reconcileChat: (chatId, paths) => set((state) => {
        const current = state.checkedPathsByChatId[chatId] ?? {}
        const next = Object.fromEntries(paths.map((path) => [path, current[path] ?? true]))
        if (
          Object.keys(current).length === Object.keys(next).length
          && Object.entries(next).every(([path, checked]) => current[path] === checked)
        ) {
          return state
        }
        return {
          checkedPathsByChatId: {
            ...state.checkedPathsByChatId,
            [chatId]: next,
          },
        }
      }),
      setChecked: (chatId, path, checked) => set((state) => ({
        checkedPathsByChatId: {
          ...state.checkedPathsByChatId,
          [chatId]: {
            ...(state.checkedPathsByChatId[chatId] ?? {}),
            [path]: checked,
          },
        },
      })),
    }),
    {
      name: "diff-commit-selections",
      version: 1,
    }
  )
)
