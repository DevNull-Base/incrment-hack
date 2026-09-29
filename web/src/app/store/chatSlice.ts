import type { StateCreator } from "zustand"
import type { ChatDialog, ChatMessage } from "@/types"
import { chatDialogs as mockDialogs, chatMessages as mockMessages } from "@/mock/data"

// ========================================
// Чат-домен: диалоги и сообщения для виджета чата.
// Сид — mock; при бекенде actions уходят на api.chat.
// ========================================
export interface ChatSlice {
  chatDialogs: ChatDialog[]
  chatMessages: Record<string, ChatMessage[]>
  /** Отправка сообщения в активный диалог (мок; при интеграции → api.chat). */
  sendChatMessage: (dialogId: string, text: string, sender: { id: string; name: string }) => void
}

export const createChatSlice: StateCreator<ChatSlice, [], [], ChatSlice> = (set) => ({
  chatDialogs: structuredClone(mockDialogs),
  chatMessages: structuredClone(mockMessages),
  sendChatMessage: (dialogId, text, sender) =>
    set((state) => ({
      chatMessages: {
        ...state.chatMessages,
        [dialogId]: [
          ...(state.chatMessages[dialogId] ?? []),
          {
            id: `msg-${Date.now()}`,
            dialogId,
            senderId: sender.id,
            senderName: sender.name,
            text,
            createdAt: new Date().toISOString(),
            isOwn: true,
          },
        ],
      },
    })),
})
