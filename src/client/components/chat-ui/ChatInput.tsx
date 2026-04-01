import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ArrowUp, Paperclip, Sparkles } from "lucide-react"
import {
  type AgentProvider,
  type ChatAttachment,
  type ClaudeContextWindow,
  type ClaudeReasoningEffort,
  type CodexReasoningEffort,
  type ModelOptions,
  type ProjectSkillSummary,
  type ProviderCatalogEntry,
  normalizeClaudeContextWindow,
} from "../../../shared/types"
import { applySkillSuggestion, getSkillCompletionMatch, getSkillSuggestions, splitTextWithSkillMentions } from "../../lib/skills"
import { Button } from "../ui/button"
import { Textarea } from "../ui/textarea"
import { ScrollArea } from "../ui/scroll-area"
import { cn } from "../../lib/utils"
import { useIsStandalone } from "../../hooks/useIsStandalone"
import { useChatInputStore } from "../../stores/chatInputStore"
import { NEW_CHAT_COMPOSER_ID, type ComposerState, useChatPreferencesStore } from "../../stores/chatPreferencesStore"
import { CHAT_INPUT_ATTRIBUTE, focusNextChatInput } from "../../app/chatFocusPolicy"
import { ChatPreferenceControls } from "./ChatPreferenceControls"
import { AttachmentFileCard, AttachmentImageCard } from "../messages/AttachmentCard"
import { AttachmentPreviewModal } from "../messages/AttachmentPreviewModal"
import { classifyAttachmentPreview } from "../messages/attachmentPreview"

const MAX_FILES_PER_DROP = 10
const MAX_CONCURRENT_UPLOADS = 3

const CLIPBOARD_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}

export function willExceedAttachmentLimit(args: {
  currentAttachmentCount: number
  queuedAttachmentCount: number
  incomingAttachmentCount: number
  maxAttachments?: number
}) {
  const maxAttachments = args.maxAttachments ?? MAX_FILES_PER_DROP
  return args.currentAttachmentCount + args.queuedAttachmentCount + args.incomingAttachmentCount > maxAttachments
}

type ClipboardFileItem = Pick<DataTransferItem, "kind" | "type" | "getAsFile">

function hasClipboardTextPayload(clipboardData: DataTransfer | null | undefined) {
  if (!clipboardData) return false
  return clipboardData.types.includes("text/plain") || clipboardData.types.includes("text/html")
}

function getClipboardImageExtension(file: File) {
  return CLIPBOARD_EXTENSION_BY_MIME_TYPE[file.type] ?? "bin"
}

function isGenericClipboardImageName(file: File) {
  const normalized = file.name.trim().toLowerCase()
  if (!normalized) return true

  const expectedExtension = getClipboardImageExtension(file)
  return normalized === `image.${expectedExtension}` || normalized === "image.png"
}

function normalizeClipboardImageFile(file: File, index: number, timestamp: number) {
  if (file.name && !isGenericClipboardImageName(file)) return file

  const extension = getClipboardImageExtension(file)
  const suffix = index === 0 ? "" : `-${index}`
  const fileName = `clipboard-${timestamp}${suffix}.${extension}`
  Object.defineProperty(file, "name", {
    configurable: true,
    value: fileName,
  })
  return file
}

export function getClipboardImageFiles(items: Iterable<ClipboardFileItem>, timestamp: number) {
  const files: File[] = []

  for (const item of items) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue
    const file = item.getAsFile()
    if (!file) continue
    files.push(normalizeClipboardImageFile(file, files.length, timestamp))
  }

  return files
}

interface ComposerAttachment extends ChatAttachment {
  status: "uploading" | "uploaded" | "failed"
  previewUrl?: string
}

interface Props {
  onSubmit: (
    value: string,
    options?: { provider?: AgentProvider; model?: string; modelOptions?: ModelOptions; planMode?: boolean; attachments?: ChatAttachment[] }
  ) => Promise<void>
  onCancel?: () => void
  disabled: boolean
  canCancel?: boolean
  chatId?: string | null
  projectId?: string | null
  inputElementRef?: React.Ref<HTMLTextAreaElement>
  activeProvider: AgentProvider | null
  availableProviders: ProviderCatalogEntry[]
  skills?: ProjectSkillSummary[]
}

export interface ChatInputHandle {
  enqueueFiles: (files: File[]) => void
}

function logChatInput(message: string, details?: unknown) {
  if (details === undefined) {
    console.info(`[ChatInput] ${message}`)
    return
  }

  console.info(`[ChatInput] ${message}`, details)
}

function createLockedComposerState(
  provider: AgentProvider,
  providerDefaults: ReturnType<typeof useChatPreferencesStore.getState>["providerDefaults"]
): ComposerState {
  if (provider === "claude") {
    return {
      provider: "claude",
      model: providerDefaults.claude.model,
      modelOptions: { ...providerDefaults.claude.modelOptions },
      planMode: providerDefaults.claude.planMode,
    }
  }

  return {
    provider: "codex",
    model: providerDefaults.codex.model,
    modelOptions: { ...providerDefaults.codex.modelOptions },
    planMode: providerDefaults.codex.planMode,
  }
}

function withNormalizedContextWindow(state: ComposerState, model: string): ComposerState {
  if (state.provider !== "claude") {
    return { ...state, model }
  }

  const normalizedContextWindow = normalizeClaudeContextWindow(model, state.modelOptions.contextWindow)
  const { contextWindow: _unusedContextWindow, ...restModelOptions } = state.modelOptions

  return {
    ...state,
    model,
    modelOptions: {
      ...restModelOptions,
      ...(normalizedContextWindow ? { contextWindow: normalizedContextWindow } : {}),
    },
  }
}

export function resolvePlanModeState(args: {
  providerLocked: boolean
  planMode: boolean
  selectedProvider: AgentProvider
  composerState: ComposerState
  providerDefaults: ReturnType<typeof useChatPreferencesStore.getState>["providerDefaults"]
  lockedComposerState: ComposerState | null
}) {
  if (!args.providerLocked) {
    return {
      composerPlanMode: args.planMode,
      lockedComposerState: args.lockedComposerState,
    }
  }

  const nextLockedState = args.lockedComposerState
    ?? createLockedComposerState(args.selectedProvider, args.providerDefaults)

  return {
    composerPlanMode: args.composerState.planMode,
    lockedComposerState: {
      ...nextLockedState,
      planMode: args.planMode,
    } satisfies ComposerState,
  }
}

export function getStoredLockedComposerState(
  lockedComposerStatesByChatId: Record<string, ComposerState>,
  chatId: string | null | undefined,
  activeProvider: AgentProvider | null
): ComposerState | null {
  if (!chatId || !activeProvider) return null
  const candidate = lockedComposerStatesByChatId[chatId]
  return candidate?.provider === activeProvider ? candidate : null
}

const ChatInputInner = forwardRef<ChatInputHandle, Props>(function ChatInput({
  onSubmit,
  onCancel,
  disabled,
  canCancel,
  chatId,
  projectId,
  inputElementRef,
  activeProvider,
  availableProviders,
  skills = [],
}, forwardedRef) {
  const {
    getDraft,
    setDraft,
    clearDraft,
    getAttachmentDrafts,
    setAttachmentDrafts,
    clearAttachmentDrafts,
  } = useChatInputStore()
  const {
    providerDefaults,
    getComposerState,
    initializeComposerForChat,
    setChatComposerModel,
    setChatComposerModelOptions,
    setChatComposerPlanMode,
    resetChatComposerFromProvider,
  } = useChatPreferencesStore()

  const composerChatId = chatId ?? NEW_CHAT_COMPOSER_ID
  const storedComposerState = useChatPreferencesStore((state) => state.chatStates[composerChatId])
  const composerState = storedComposerState ?? getComposerState(composerChatId)

  const [value, setValue] = useState(() => (chatId ? getDraft(chatId) : ""))
  const [lockedComposerStatesByChatId, setLockedComposerStatesByChatId] = useState<Record<string, ComposerState>>({})
  const [selectionStart, setSelectionStart] = useState(0)
  const [selectionEnd, setSelectionEnd] = useState(0)
  const [activeSkillSuggestionIndex, setActiveSkillSuggestionIndex] = useState(0)
  const [dismissedSkillCompletionKey, setDismissedSkillCompletionKey] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<ComposerAttachment[]>(() => hydrateComposerAttachments(chatId ? getAttachmentDrafts(chatId) : []))
  const [selectedAttachmentId, setSelectedAttachmentId] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputHighlightRef = useRef<HTMLDivElement>(null)
  const inputHoverOverlayRef = useRef<HTMLDivElement>(null)
  const uploadQueueRef = useRef<File[]>([])
  const activeUploadsRef = useRef(0)
  const attachmentsRef = useRef<ComposerAttachment[]>([])
  const uploadGenerationRef = useRef(0)
  const removedAttachmentIdsRef = useRef<Set<string>>(new Set())
  const previousProjectIdRef = useRef<string | null>(projectId ?? null)
  const latestChatIdRef = useRef<string | null>(chatId ?? null)
  const isStandalone = useIsStandalone()

  const providerLocked = activeProvider !== null
  const lockedComposerState = getStoredLockedComposerState(lockedComposerStatesByChatId, chatId, activeProvider)
  const providerPrefs = providerLocked
    ? lockedComposerState ?? createLockedComposerState(activeProvider, providerDefaults)
    : composerState
  const selectedProvider = providerLocked ? activeProvider : composerState.provider
  const providerConfig = availableProviders.find((provider) => provider.id === selectedProvider) ?? availableProviders[0]
  const showPlanMode = providerConfig?.supportsPlanMode ?? false

  const skillNames = useMemo(() => skills.map((skill) => skill.name), [skills])
  const skillDescriptions = useMemo(
    () => new Map(skills.map((skill) => [skill.name, skill.description] as const)),
    [skills]
  )
  const highlightedInputParts = useMemo(
    () => splitTextWithSkillMentions(value, skillNames),
    [skillNames, value]
  )
  const hasHighlightedInput = highlightedInputParts.some((part) => part.type === "skill")
  const skillCompletionMatch = useMemo(
    () => getSkillCompletionMatch(value, selectionStart, selectionEnd),
    [selectionEnd, selectionStart, value]
  )
  const skillSuggestions = useMemo(
    () => skillCompletionMatch ? getSkillSuggestions(skills, skillCompletionMatch.query).slice(0, 8) : [],
    [skillCompletionMatch, skills]
  )
  const activeSkillSuggestion = skillSuggestions[activeSkillSuggestionIndex] ?? null
  const activeSkillCompletionKey = skillCompletionMatch
    ? `${skillCompletionMatch.start}:${skillCompletionMatch.end}:${skillCompletionMatch.query}`
    : null
  const showSkillSuggestions = Boolean(
    !disabled
    && skillCompletionMatch
    && skillSuggestions.length > 0
    && dismissedSkillCompletionKey !== activeSkillCompletionKey
  )

  const uploadedAttachments = attachments.filter((attachment) => attachment.status === "uploaded")
  const hasPendingUploads = attachments.some((attachment) => attachment.status === "uploading")
  const canSubmit = value.trim().length > 0 || uploadedAttachments.length > 0
  const orderedAttachments = useMemo(
    () => [...attachments].sort((left, right) => {
      if (left.kind === right.kind) return 0
      return left.kind === "image" ? -1 : 1
    }),
    [attachments]
  )
  const selectedAttachment = attachments.find((attachment) => attachment.id === selectedAttachmentId) ?? null

  const cleanupAttachmentPreview = useCallback((attachment: ComposerAttachment) => {
    if (attachment.previewUrl) {
      URL.revokeObjectURL(attachment.previewUrl)
    }
  }, [])

  const clearAttachments = useCallback(() => {
    uploadGenerationRef.current += 1
    removedAttachmentIdsRef.current.clear()
    setAttachments((current) => {
      current.forEach(cleanupAttachmentPreview)
      return []
    })
    uploadQueueRef.current = []
    activeUploadsRef.current = 0
    setSelectedAttachmentId(null)
    setUploadError(null)
  }, [cleanupAttachmentPreview])

  const autoResize = useCallback(() => {
    const element = textareaRef.current
    if (!element) return
    if (element.value.length === 0) {
      element.style.height = ""
      return
    }
    element.style.height = "auto"
    element.style.height = `${element.scrollHeight}px`
  }, [])

  const setTextareaRefs = useCallback((node: HTMLTextAreaElement | null) => {
    textareaRef.current = node

    if (inputElementRef) {
      if (typeof inputElementRef === "function") {
        inputElementRef(node)
      } else {
        inputElementRef.current = node
      }
    }
  }, [inputElementRef])

  useLayoutEffect(() => {
    autoResize()
  }, [value, autoResize])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    for (const overlay of [inputHighlightRef.current, inputHoverOverlayRef.current]) {
      if (!overlay) continue
      overlay.scrollTop = textarea.scrollTop
      overlay.scrollLeft = textarea.scrollLeft
    }
  }, [value, hasHighlightedInput])

  useEffect(() => {
    if (!showSkillSuggestions) {
      setActiveSkillSuggestionIndex(0)
      return
    }

    setActiveSkillSuggestionIndex((current) => Math.min(current, skillSuggestions.length - 1))
  }, [showSkillSuggestions, skillSuggestions.length])

  useEffect(() => {
    window.addEventListener("resize", autoResize)
    return () => window.removeEventListener("resize", autoResize)
  }, [autoResize])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [chatId])

  useEffect(() => {
    latestChatIdRef.current = chatId ?? null
    setSelectionStart(value.length)
    setSelectionEnd(value.length)
  }, [chatId, value.length])

  useEffect(() => {
    initializeComposerForChat(composerChatId)
  }, [composerChatId, initializeComposerForChat])

  useEffect(() => {
    if (activeProvider === null || !chatId) {
      return
    }

    setLockedComposerStatesByChatId((current) => {
      const existing = current[chatId]
      if (existing?.provider === activeProvider) return current
      return {
        ...current,
        [chatId]: createLockedComposerState(activeProvider, providerDefaults),
      }
    })
  }, [activeProvider, chatId, providerDefaults])

  useEffect(() => {
    uploadGenerationRef.current += 1
    uploadQueueRef.current = []
    activeUploadsRef.current = 0
    removedAttachmentIdsRef.current.clear()
    setSelectedAttachmentId(null)
    setUploadError(null)
    setAttachments((current) => {
      current.forEach(cleanupAttachmentPreview)
      return hydrateComposerAttachments(chatId ? getAttachmentDrafts(chatId) : [])
    })
  }, [chatId, cleanupAttachmentPreview, getAttachmentDrafts])

  useEffect(() => {
    const previousProjectId = previousProjectIdRef.current
    previousProjectIdRef.current = projectId ?? null

    if (previousProjectId === null || projectId === previousProjectId) {
      return
    }

    clearAttachments()
    if (chatId) {
      clearAttachmentDrafts(chatId)
    }
  }, [projectId, chatId, clearAttachments, clearAttachmentDrafts])

  useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  useEffect(() => {
    if (!chatId) return

    const persistedAttachments = attachments
      .filter((attachment) => attachment.status === "uploaded")
      .map(({ previewUrl: _previewUrl, status: _status, ...attachment }) => attachment)

    if (persistedAttachments.length === 0) {
      clearAttachmentDrafts(chatId)
      return
    }

    setAttachmentDrafts(chatId, persistedAttachments)
  }, [attachments, chatId, clearAttachmentDrafts, setAttachmentDrafts])

  useEffect(() => () => {
    attachmentsRef.current.forEach(cleanupAttachmentPreview)
  }, [cleanupAttachmentPreview])

  useEffect(() => {
    logChatInput("resolved provider state", {
      chatId: chatId ?? null,
      activeProvider,
      composerProvider: composerState.provider,
      composerModel: composerState.model,
      effectiveProvider: providerPrefs.provider,
      effectiveModel: providerPrefs.model,
      selectedProvider,
      providerLocked,
    })
  }, [activeProvider, chatId, composerState.model, composerState.provider, providerLocked, providerPrefs.model, providerPrefs.provider, selectedProvider])

  function updateLockedComposerState(update: (current: ComposerState | null) => ComposerState | null) {
    if (!providerLocked || !chatId) return
    setLockedComposerStatesByChatId((current) => {
      const next = update(getStoredLockedComposerState(current, chatId, activeProvider))
      if (!next) {
        if (!(chatId in current)) return current
        const { [chatId]: _removed, ...rest } = current
        return rest
      }

      const existing = current[chatId]
      if (
        existing
        && existing.provider === next.provider
        && existing.model === next.model
        && existing.planMode === next.planMode
        && JSON.stringify(existing.modelOptions) === JSON.stringify(next.modelOptions)
      ) {
        return current
      }

      return {
        ...current,
        [chatId]: next,
      }
    })
  }

  function setReasoningEffort(reasoningEffort: string) {
    if (providerLocked) {
      updateLockedComposerState((current) => {
        const next = current ?? createLockedComposerState(selectedProvider, providerDefaults)
        if (next.provider === "claude") {
          return {
            ...next,
            modelOptions: { ...next.modelOptions, reasoningEffort: reasoningEffort as ClaudeReasoningEffort },
          }
        }

        return {
          ...next,
          modelOptions: { ...next.modelOptions, reasoningEffort: reasoningEffort as CodexReasoningEffort },
        }
      })
      return
    }

    if (selectedProvider === "claude") {
      setChatComposerModelOptions(composerChatId, { reasoningEffort: reasoningEffort as ClaudeReasoningEffort })
      return
    }

    setChatComposerModelOptions(composerChatId, { reasoningEffort: reasoningEffort as CodexReasoningEffort })
  }

  function setClaudeContextWindow(contextWindow: ClaudeContextWindow) {
    if (providerLocked) {
      updateLockedComposerState((current) => {
        const next = current ?? createLockedComposerState(selectedProvider, providerDefaults)
        if (next.provider !== "claude") return next
        return withNormalizedContextWindow(
          {
            ...next,
            modelOptions: {
              ...next.modelOptions,
              contextWindow,
            },
          },
          next.model
        )
      })
      return
    }

    setChatComposerModelOptions(composerChatId, { contextWindow })
  }

  function setEffectivePlanMode(planMode: boolean) {
    const nextState = resolvePlanModeState({
      providerLocked,
      planMode,
      selectedProvider,
      composerState,
      providerDefaults,
      lockedComposerState,
    })

    if (nextState.lockedComposerState !== lockedComposerState) {
      updateLockedComposerState(() => nextState.lockedComposerState)
    }
    if (nextState.composerPlanMode !== composerState.planMode) {
      setChatComposerPlanMode(composerChatId, nextState.composerPlanMode)
    }
  }

  function toggleEffectivePlanMode() {
    setEffectivePlanMode(!providerPrefs.planMode)
  }

  function updateSelectionFromTextarea() {
    const element = textareaRef.current
    setSelectionStart(element?.selectionStart ?? value.length)
    setSelectionEnd(element?.selectionEnd ?? value.length)
    if (element) {
      for (const overlay of [inputHighlightRef.current, inputHoverOverlayRef.current]) {
        if (!overlay) continue
        overlay.scrollTop = element.scrollTop
        overlay.scrollLeft = element.scrollLeft
      }
    }
  }

  function applySelectedSkill(skillName: string) {
    if (!skillCompletionMatch) return
    const next = applySkillSuggestion(value, skillCompletionMatch, skillName)
    setValue(next.text)
    setDismissedSkillCompletionKey(null)
    if (chatId) setDraft(chatId, next.text)

    requestAnimationFrame(() => {
      const element = textareaRef.current
      if (!element) return
      element.focus()
      element.setSelectionRange(next.selectionStart, next.selectionStart)
      setSelectionStart(next.selectionStart)
      setSelectionEnd(next.selectionStart)
      autoResize()
    })
  }

  const processUploadQueue = useCallback(() => {
    if (!projectId) return

    while (activeUploadsRef.current < MAX_CONCURRENT_UPLOADS && uploadQueueRef.current.length > 0) {
      const file = uploadQueueRef.current.shift()
      if (!file) break

      activeUploadsRef.current += 1
      const tempId = crypto.randomUUID()
      const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined
      const generation = uploadGenerationRef.current

      setAttachments((current) => [...current, {
        id: tempId,
        kind: file.type.startsWith("image/") ? "image" : "file",
        displayName: file.name,
        absolutePath: "",
        relativePath: "",
        contentUrl: "",
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        status: "uploading",
        previewUrl,
      }])

      void (async () => {
        try {
          const formData = new FormData()
          formData.append("files", file)

          const response = await fetch(`/api/projects/${projectId}/uploads`, {
            method: "POST",
            body: formData,
          })

          if (!response.ok) {
            const payload = await response.json().catch(() => ({}))
            throw new Error(typeof payload.error === "string" ? payload.error : "Upload failed")
          }

          const payload = await response.json() as { attachments: ChatAttachment[] }
          const uploaded = payload.attachments[0]
          if (!uploaded) {
            throw new Error("Upload failed")
          }

          if (generation !== uploadGenerationRef.current) {
            void deleteUploadedAttachment(uploaded)
            if (previewUrl) URL.revokeObjectURL(previewUrl)
            return
          }

          if (removedAttachmentIdsRef.current.has(tempId)) {
            removedAttachmentIdsRef.current.delete(tempId)
            if (previewUrl) URL.revokeObjectURL(previewUrl)
            void deleteUploadedAttachment(uploaded)
            return
          }

          setAttachments((current) => current.map((attachment) => (
            attachment.id !== tempId
              ? attachment
              : {
                  ...attachment,
                  ...uploaded,
                  previewUrl: attachment.previewUrl,
                  status: "uploaded",
                }
          )))
          setUploadError(null)
        } catch (error) {
          if (generation !== uploadGenerationRef.current) {
            if (previewUrl) URL.revokeObjectURL(previewUrl)
            return
          }
          setAttachments((current) => current.map((attachment) => (
            attachment.id === tempId ? { ...attachment, status: "failed" } : attachment
          )))
          setUploadError(error instanceof Error ? error.message : String(error))
        } finally {
          activeUploadsRef.current = Math.max(0, activeUploadsRef.current - 1)
          processUploadQueue()
        }
      })()
    }
  }, [projectId])

  const enqueueFiles = useCallback((files: File[]) => {
    if (!projectId) {
      setUploadError("Open a project before uploading files.")
      return
    }

    if (willExceedAttachmentLimit({
      currentAttachmentCount: attachmentsRef.current.length,
      queuedAttachmentCount: uploadQueueRef.current.length,
      incomingAttachmentCount: files.length,
    })) {
      setUploadError(`You can upload up to ${MAX_FILES_PER_DROP} files at a time.`)
      return
    }

    uploadQueueRef.current.push(...files)
    setUploadError(null)
    processUploadQueue()
  }, [processUploadQueue, projectId])

  useImperativeHandle(forwardedRef, () => ({
    enqueueFiles,
  }), [enqueueFiles])

  async function handleSubmit() {
    if (!canSubmit || hasPendingUploads) return

    const nextValue = value
    const attachmentsForSubmit = uploadedAttachments.map(({ previewUrl: _previewUrl, status: _status, ...attachment }) => attachment)
    let modelOptions: ModelOptions
    if (providerPrefs.provider === "claude") {
      modelOptions = { claude: { ...providerPrefs.modelOptions } }
    } else {
      modelOptions = { codex: { ...providerPrefs.modelOptions } }
    }
    const submitOptions = {
      provider: selectedProvider,
      model: providerPrefs.model,
      modelOptions,
      planMode: showPlanMode ? providerPrefs.planMode : false,
      attachments: attachmentsForSubmit,
    }
    logChatInput("submit settings", {
      chatId: chatId ?? null,
      activeProvider,
      composerProvider: providerPrefs.provider,
      submitOptions,
    })

    setValue("")
    if (chatId) clearDraft(chatId)
    if (textareaRef.current) textareaRef.current.style.height = "auto"

    try {
      await onSubmit(nextValue, submitOptions)
      clearAttachments()
      if (latestChatIdRef.current) {
        clearAttachmentDrafts(latestChatIdRef.current)
      }
    } catch (error) {
      console.error("[ChatInput] Submit failed:", error)
      setValue(nextValue)
      if (chatId) setDraft(chatId, nextValue)
    }
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (showSkillSuggestions && event.key === "ArrowDown") {
      event.preventDefault()
      setActiveSkillSuggestionIndex((current) => (current + 1) % skillSuggestions.length)
      return
    }

    if (showSkillSuggestions && event.key === "ArrowUp") {
      event.preventDefault()
      setActiveSkillSuggestionIndex((current) => (current - 1 + skillSuggestions.length) % skillSuggestions.length)
      return
    }

    if (showSkillSuggestions && ((event.key === "Enter" && !event.shiftKey) || (event.key === "Tab" && !event.shiftKey))) {
      event.preventDefault()
      if (activeSkillSuggestion) {
        applySelectedSkill(activeSkillSuggestion.name)
      }
      return
    }

    if (showSkillSuggestions && event.key === "Escape") {
      event.preventDefault()
      setDismissedSkillCompletionKey(activeSkillCompletionKey)
      return
    }

    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault()
      focusNextChatInput(textareaRef.current, document)
      return
    }

    if (event.key === "Tab" && event.shiftKey && showPlanMode) {
      event.preventDefault()
      toggleEffectivePlanMode()
      return
    }

    if (event.key === "Escape" && canCancel) {
      event.preventDefault()
      onCancel?.()
      return
    }

    const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0
    if (event.key === "Enter" && !event.shiftKey && !canCancel && !isTouchDevice) {
      event.preventDefault()
      void handleSubmit()
    }
  }

  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = getClipboardImageFiles(event.clipboardData.items, Date.now())
    if (files.length === 0) return

    enqueueFiles(files)

    if (!hasClipboardTextPayload(event.clipboardData)) {
      event.preventDefault()
    }
  }

  function handleAttachmentPreview(attachment: ComposerAttachment) {
    const target = classifyAttachmentPreview(attachment)
    if (target.openInNewTab) {
      if (typeof window !== "undefined") {
        window.open(new URL(attachment.contentUrl, window.location.origin).toString(), "_blank", "noopener,noreferrer")
      }
      return
    }

    setSelectedAttachmentId(attachment.id)
  }

  function removeAttachment(attachment: ComposerAttachment) {
    removedAttachmentIdsRef.current.add(attachment.id)
    setAttachments((current) => {
      const removed = current.find((item) => item.id === attachment.id)
      if (removed) cleanupAttachmentPreview(removed)
      return current.filter((item) => item.id !== attachment.id)
    })
    if (selectedAttachmentId === attachment.id) {
      setSelectedAttachmentId(null)
    }

    if (attachment.status === "uploaded") {
      removedAttachmentIdsRef.current.delete(attachment.id)
      void deleteUploadedAttachment(attachment)
    }
  }

  function handleMobileFilePicker() {
    fileInputRef.current?.click()
  }

  return (
    <div>
      <div className={cn("px-3 pt-0", isStandalone && "px-5")}>
        <div className="max-w-[840px] mx-auto rounded-[32px]">
          {attachments.length > 0 ? (
            <ScrollArea className="overflow-x-auto overflow-y-hidden whitespace-nowrap px-2 pb-2">
              <div className="flex items-end gap-2 pt-2">
                {orderedAttachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    className={cn("flex shrink-0 flex-col justify-end", attachment.status === "failed" && "text-destructive")}
                  >
                    {attachment.kind === "image" ? (
                      <AttachmentImageCard
                        attachment={attachment}
                        previewUrl={attachment.previewUrl}
                        size="composer"
                        onClick={attachment.status === "uploaded" ? () => handleAttachmentPreview(attachment) : undefined}
                        onRemove={() => removeAttachment(attachment)}
                      />
                    ) : (
                      <AttachmentFileCard
                        attachment={attachment}
                        onClick={attachment.status === "uploaded" ? () => handleAttachmentPreview(attachment) : undefined}
                        onRemove={() => removeAttachment(attachment)}
                      />
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          ) : null}

          <div className="relative flex items-end gap-2 max-w-[840px] mx-auto border dark:bg-card/40 backdrop-blur-lg border-border rounded-[29px] pr-1.5">
            {value && hasHighlightedInput ? (
              <div
                ref={inputHighlightRef}
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-[29px]"
              >
                <div className="max-h-[200px] min-h-full whitespace-pre-wrap break-words px-4.5 py-3 text-base text-foreground md:px-6 md:py-4 [overflow-wrap:anywhere]">
                  {highlightedInputParts.map((part, index) => part.type === "skill" ? (
                    <span
                      key={`${part.name}-${index}`}
                      className="rounded-md border border-border/70 bg-muted/80 px-1 py-0.5 text-foreground"
                      title={skillDescriptions.get(part.name) || `Skill: ${part.name}`}
                    >
                      {part.value}
                    </span>
                  ) : (
                    <span key={`text-${index}`}>{part.value}</span>
                  ))}
                </div>
              </div>
            ) : null}
            {value && hasHighlightedInput ? (
              <div
                ref={inputHoverOverlayRef}
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-[29px]"
              >
                <div className="max-h-[200px] min-h-full whitespace-pre-wrap break-words px-4.5 py-3 text-base text-transparent md:px-6 md:py-4 [overflow-wrap:anywhere]">
                  {highlightedInputParts.map((part, index) => part.type === "skill" ? (
                    <span
                      key={`hover-${part.name}-${index}`}
                      className="pointer-events-auto rounded-md border border-border/70 bg-muted/80 px-1 py-0.5 text-foreground"
                      title={skillDescriptions.get(part.name) || `Skill: ${part.name}`}
                      data-skill-name={part.name}
                      data-skill-description={skillDescriptions.get(part.name) || ""}
                      onMouseDown={(event) => {
                        event.preventDefault()
                        textareaRef.current?.focus()
                      }}
                    >
                      {part.value}
                    </span>
                  ) : (
                    <span key={`hover-text-${index}`}>{part.value}</span>
                  ))}
                </div>
              </div>
            ) : null}

            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                const files = [...(event.target.files ?? [])]
                if (files.length > 0) {
                  enqueueFiles(files)
                }
                event.target.value = ""
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onPointerDown={(event) => {
                event.preventDefault()
                handleMobileFilePicker()
              }}
              disabled={disabled || !projectId}
              className="md:hidden flex-shrink-0 ml-1 mb-1 h-10 w-10 rounded-full text-muted-foreground hover:text-foreground"
            >
              <Paperclip className="h-5 w-5" />
            </Button>
            <Textarea
              ref={setTextareaRefs}
              placeholder="Build something..."
              value={value}
              autoFocus
              {...{ [CHAT_INPUT_ATTRIBUTE]: "" }}
              rows={1}
              onChange={(event) => {
                setValue(event.target.value)
                setDismissedSkillCompletionKey(null)
                setSelectionStart(event.target.selectionStart ?? event.target.value.length)
                setSelectionEnd(event.target.selectionEnd ?? event.target.value.length)
                if (chatId) setDraft(chatId, event.target.value)
                autoResize()
              }}
              onPaste={handlePaste}
              onSelect={updateSelectionFromTextarea}
              onClick={updateSelectionFromTextarea}
              onKeyUp={updateSelectionFromTextarea}
              onScroll={updateSelectionFromTextarea}
              onKeyDown={handleKeyDown}
              disabled={disabled}
              className={cn(
                "relative z-10 flex-1 text-base p-3 md:p-4 pl-4.5 md:pl-6 resize-none max-h-[200px] outline-none bg-transparent border-0 shadow-none",
                value && hasHighlightedInput && "text-transparent caret-foreground"
              )}
            />
            {showSkillSuggestions ? (
              <div className="absolute left-3 right-14 bottom-[calc(100%+10px)] z-30 overflow-hidden rounded-2xl border border-border bg-background/95 shadow-xl backdrop-blur">
                <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5" />
                  Skills
                </div>
                <div className="max-h-64 overflow-y-auto py-1.5">
                  {skillSuggestions.map((skill, index) => (
                    <button
                      key={`${skill.scope ?? "unknown"}:${skill.name}:${skill.pathDisplay ?? skill.relativePath ?? skill.filePath ?? ""}`}
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault()
                        applySelectedSkill(skill.name)
                      }}
                      className={cn(
                        "flex w-full items-start gap-3 px-3 py-2 text-left transition-colors hover:bg-accent/40",
                        index === activeSkillSuggestionIndex && "bg-accent/50"
                      )}
                    >
                      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">{skill.name}</div>
                        {skill.description ? (
                          <div className="mt-0.5 text-xs text-muted-foreground">{skill.description}</div>
                        ) : null}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <Button
              type="button"
              onPointerDown={(event) => {
                event.preventDefault()
                if (canCancel) {
                  onCancel?.()
                } else if (!disabled && canSubmit && !hasPendingUploads) {
                  void handleSubmit()
                }
              }}
              disabled={!canCancel && (disabled || !canSubmit || hasPendingUploads)}
              size="icon"
              className="flex-shrink-0 bg-slate-600 text-white dark:bg-white dark:text-slate-900 rounded-full cursor-pointer h-10 w-10 md:h-11 md:w-11 mb-1 -mr-0.5 md:mr-0 md:mb-1.5 touch-manipulation disabled:bg-white/60 disabled:text-slate-700"
            >
              {canCancel ? (
                <div className="w-3 h-3 md:w-4 md:h-4 rounded-xs bg-current" />
              ) : (
                <ArrowUp className="h-5 w-5 md:h-6 md:w-6" />
              )}
            </Button>
          </div>
        </div>

        {uploadError ? (
          <div className="max-w-[840px] mx-auto mt-2 px-1 text-sm text-destructive">
            {uploadError}
          </div>
        ) : null}
      </div>

      <div className={cn("overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden py-3 flex flex-row", isStandalone && "p-5 pt-3")}>
        <div className="min-w-3" />
        <ChatPreferenceControls
          availableProviders={availableProviders}
          selectedProvider={selectedProvider}
          providerLocked={providerLocked}
          model={providerPrefs.model}
          modelOptions={providerPrefs.modelOptions}
          onProviderChange={(provider) => {
            if (providerLocked) return
            resetChatComposerFromProvider(composerChatId, provider)
          }}
          onModelChange={(_, model) => {
            if (providerLocked) {
              updateLockedComposerState((current) => {
                const next = current ?? createLockedComposerState(selectedProvider, providerDefaults)
                return withNormalizedContextWindow(next, model)
              })
              return
            }

            setChatComposerModel(composerChatId, model)
          }}
          onClaudeReasoningEffortChange={(effort) => setReasoningEffort(effort)}
          onClaudeContextWindowChange={(contextWindow) => setClaudeContextWindow(contextWindow)}
          onCodexReasoningEffortChange={(effort) => setReasoningEffort(effort)}
          onCodexFastModeChange={(fastMode) => {
            if (providerLocked) {
              updateLockedComposerState((current) => {
                const next = current ?? createLockedComposerState(selectedProvider, providerDefaults)
                if (next.provider === "claude") return next
                return {
                  ...next,
                  modelOptions: { ...next.modelOptions, fastMode },
                }
              })
              return
            }

            setChatComposerModelOptions(composerChatId, { fastMode })
          }}
          planMode={providerPrefs.planMode}
          onPlanModeChange={setEffectivePlanMode}
          includePlanMode={showPlanMode}
          className="max-w-[840px] mx-auto"
        />
        <div className="min-w-3" />
      </div>

      <AttachmentPreviewModal attachment={selectedAttachment} onOpenChange={(open) => !open && setSelectedAttachmentId(null)} />
    </div>
  )
})

export const ChatInput = memo(ChatInputInner)

async function deleteUploadedAttachment(attachment: ChatAttachment) {
  if (!attachment.contentUrl) return
  const deleteUrl = attachment.contentUrl.replace(/\/content$/, "")
  await fetch(deleteUrl, { method: "DELETE" }).catch(() => undefined)
}

function hydrateComposerAttachments(attachments: ChatAttachment[]): ComposerAttachment[] {
  return attachments.map((attachment) => ({
    ...attachment,
    status: "uploaded" as const,
  }))
}
