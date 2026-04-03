import { describe, expect, test } from "bun:test"
import { getNotificationTitleCount, shouldRedirectToChangelog } from "./App"

describe("shouldRedirectToChangelog", () => {
  test("redirects only from the root route when the version is unseen", () => {
    expect(shouldRedirectToChangelog("/", "0.12.0", null)).toBe(true)
    expect(shouldRedirectToChangelog("/", "0.12.0", "0.11.0")).toBe(true)
    expect(shouldRedirectToChangelog("/settings/general", "0.12.0", "0.11.0")).toBe(false)
    expect(shouldRedirectToChangelog("/chat/1", "0.12.0", "0.11.0")).toBe(false)
    expect(shouldRedirectToChangelog("/", "0.12.0", "0.12.0")).toBe(false)
  })
})

describe("getNotificationTitleCount", () => {
  test("counts unread chats and waiting-for-user chats", () => {
    expect(getNotificationTitleCount({
      projectGroups: [{
        groupKey: "project-1",
        localPath: "/tmp/project",
        chats: [
          {
            _id: "chat-1",
            _creationTime: 1,
            chatId: "chat-1",
            title: "Unread",
            status: "idle",
            unread: true,
            localPath: "/tmp/project",
            provider: null,
            hasAutomation: false,
          },
          {
            _id: "chat-2",
            _creationTime: 2,
            chatId: "chat-2",
            title: "Waiting",
            status: "waiting_for_user",
            unread: false,
            localPath: "/tmp/project",
            provider: null,
            hasAutomation: false,
          },
          {
            _id: "chat-3",
            _creationTime: 3,
            chatId: "chat-3",
            title: "Both",
            status: "waiting_for_user",
            unread: true,
            localPath: "/tmp/project",
            provider: null,
            hasAutomation: false,
          },
        ],
      }],
    })).toBe(4)
  })
})
