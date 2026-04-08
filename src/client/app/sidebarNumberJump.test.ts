import { describe, expect, test } from "bun:test"
import type { KeybindingsSnapshot, SidebarProjectGroup } from "../../shared/types"
import {
  getSidebarJumpTargetIndex,
  getSidebarNumberJumpHint,
  getVisibleSidebarChats,
  shouldShowSidebarNumberJumpHints,
} from "./sidebarNumberJump"

const KEYBINDINGS: KeybindingsSnapshot = {
  bindings: {
    toggleEmbeddedTerminal: ["cmd+j"],
    toggleRightSidebar: ["cmd+b"],
    openInFinder: ["cmd+alt+f"],
    openInEditor: ["cmd+shift+o"],
    addSplitTerminal: ["cmd+/"],
    jumpToSidebarChat: ["cmd+alt"],
    createChatInCurrentProject: ["cmd+alt+n"],
    openAddProject: ["cmd+alt+o"],
  },
  warning: null,
  filePathDisplay: "~/.kanna/keybindings.json",
}

const PROJECT_GROUPS: SidebarProjectGroup[] = [
  {
    groupKey: "project-a",
    localPath: "/tmp/project-a",
    chats: [
      {
        _id: "a-1",
        _creationTime: 1,
        chatId: "chat-a-1",
        title: "A1",
        status: "idle",
        unread: false,
        localPath: "/tmp/project-a",
        provider: "codex",
        hasAutomation: false,
      },
      {
        _id: "a-2",
        _creationTime: 2,
        chatId: "chat-a-2",
        title: "A2",
        status: "idle",
        unread: false,
        localPath: "/tmp/project-a",
        provider: "codex",
        hasAutomation: false,
      },
      {
        _id: "a-3",
        _creationTime: 3,
        chatId: "chat-a-3",
        title: "A3",
        status: "idle",
        unread: false,
        localPath: "/tmp/project-a",
        provider: "codex",
        hasAutomation: false,
      },
    ],
  },
  {
    groupKey: "project-b",
    localPath: "/tmp/project-b",
    chats: [
      {
        _id: "b-1",
        _creationTime: 4,
        chatId: "chat-b-1",
        title: "B1",
        status: "idle",
        unread: false,
        localPath: "/tmp/project-b",
        provider: "claude",
        hasAutomation: false,
      },
      {
        _id: "b-2",
        _creationTime: 5,
        chatId: "chat-b-2",
        title: "B2",
        status: "idle",
        unread: false,
        localPath: "/tmp/project-b",
        provider: "claude",
        hasAutomation: false,
      },
    ],
  },
]

describe("getVisibleSidebarChats", () => {
  test("returns chats in visible sidebar order", () => {
    const visibleChats = getVisibleSidebarChats(PROJECT_GROUPS, new Set(), new Set(), 2)

    expect(visibleChats.map((entry) => [entry.visibleIndex, entry.chat.chatId])).toEqual([
      [1, "chat-a-1"],
      [2, "chat-a-2"],
      [3, "chat-b-1"],
      [4, "chat-b-2"],
    ])
  })

  test("skips collapsed sections and respects expanded groups", () => {
    const visibleChats = getVisibleSidebarChats(
      PROJECT_GROUPS,
      new Set(["project-b"]),
      new Set(["project-a"]),
      2
    )

    expect(visibleChats.map((entry) => [entry.visibleIndex, entry.chat.chatId])).toEqual([
      [1, "chat-a-1"],
      [2, "chat-a-2"],
      [3, "chat-a-3"],
    ])
  })
})

describe("shouldShowSidebarNumberJumpHints", () => {
  test("shows hints when the jump binding modifiers are held", () => {
    expect(shouldShowSidebarNumberJumpHints(KEYBINDINGS, {
      metaKey: true,
      altKey: true,
      ctrlKey: false,
      shiftKey: false,
    })).toBe(true)
  })

  test("hides hints when extra modifiers are present", () => {
    expect(shouldShowSidebarNumberJumpHints(KEYBINDINGS, {
      metaKey: true,
      altKey: true,
      ctrlKey: true,
      shiftKey: false,
    })).toBe(false)
  })
})

describe("getSidebarJumpTargetIndex", () => {
  test("returns the pressed digit when the jump modifiers are held", () => {
    expect(getSidebarJumpTargetIndex(KEYBINDINGS, {
      key: "@",
      code: "Digit2",
      metaKey: true,
      altKey: true,
      ctrlKey: false,
      shiftKey: false,
    } as KeyboardEvent)).toBe(2)
  })

  test("ignores non-digit keys and digit zero", () => {
    expect(getSidebarJumpTargetIndex(KEYBINDINGS, {
      key: "a",
      code: "KeyA",
      metaKey: true,
      altKey: true,
      ctrlKey: false,
      shiftKey: false,
    } as KeyboardEvent)).toBeNull()

    expect(getSidebarJumpTargetIndex(KEYBINDINGS, {
      key: "0",
      code: "Digit0",
      metaKey: true,
      altKey: true,
      ctrlKey: false,
      shiftKey: false,
    } as KeyboardEvent)).toBeNull()
  })
})

describe("getSidebarNumberJumpHint", () => {
  test("formats hints for rows one through nine", () => {
    expect(getSidebarNumberJumpHint(KEYBINDINGS, 1)).toBe("1")
    expect(getSidebarNumberJumpHint(KEYBINDINGS, 3)).toBe("3")
    expect(getSidebarNumberJumpHint(KEYBINDINGS, 10)).toBeNull()
  })
})
