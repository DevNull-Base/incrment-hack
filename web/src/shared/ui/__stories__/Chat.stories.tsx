import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  ChatWindow,
  ChatSidebar,
  ChatWidget,
  ChatPage,
  MessageBubble,
} from "@/shared/ui/chat"
import { chatDialogs, chatMessages } from "@/mock/data"
import { useState } from "react"
import type { ChatMessage } from "@/types"

const meta: Meta<typeof ChatPage> = {
  title: "UI/Chat",
  component: ChatPage,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
}
export default meta
type Story = StoryObj<typeof ChatPage>

function ChatWindowStory() {
  const dialog = chatDialogs[0]
  const messages = chatMessages[dialog.id] || []
  const [, setMessages] = useState<ChatMessage[]>(messages)

  return (
    <div className="flex h-[600px]">
      <ChatWindow
        dialog={dialog}
        messages={messages}
        onSendMessage={(text) => {
          setMessages((prev) => [
            ...prev,
            {
              id: `msg-${Date.now()}`,
              dialogId: dialog.id,
              senderId: "e1",
              senderName: "Иванов А.П.",
              text,
              createdAt: new Date().toISOString(),
              isOwn: true,
            },
          ])
        }}
      />
    </div>
  )
}

function ChatSidebarStory() {
  const [activeId, setActiveId] = useState<string | null>("cd1")
  return (
    <div className="flex h-[600px]">
      <ChatSidebar
        dialogs={chatDialogs}
        activeDialogId={activeId}
        onSelectDialog={setActiveId}
      />
    </div>
  )
}

export const FullPage: Story = {
  args: {
    dialogs: chatDialogs,
    messages: chatMessages,
  },
}

export const ChatWindowOnly: Story = {
  render: () => <ChatWindowStory />,
}

export const SidebarOnly: Story = {
  render: () => <ChatSidebarStory />,
}

export const WidgetDemo: Story = {
  render: () => (
    <div className="relative h-[500px] bg-muted/30 rounded-xl">
      <p className="p-4 text-sm text-muted-foreground">
        Плавающая кнопка чата в правом нижнем углу
      </p>
      <ChatWidget
        dialogs={chatDialogs}
        messages={chatMessages}
        onSelectDialog={() => {}}
      />
    </div>
  ),
}

export const MessageBubbleDemo: Story = {
  render: () => (
    <div className="mx-auto max-w-md space-y-4 p-4">
      <MessageBubble
        message={{
          id: "1",
          dialogId: "cd1",
          senderId: "c1",
          senderName: "Кузнецов А.И.",
          text: "Добрый день! Хотел уточнить по расписанию",
          createdAt: "2025-09-02T10:00:00",
          isOwn: false,
        }}
      />
      <MessageBubble
        message={{
          id: "2",
          dialogId: "cd1",
          senderId: "e1",
          senderName: "Иванов А.П.",
          text: "Добрый день! Мы планируем начать с 15 сентября. Нужна аудитория на 10 человек",
          createdAt: "2025-09-02T10:05:00",
          isOwn: true,
        }}
      />
    </div>
  ),
}

export const EmptyState: Story = {
  render: () => (
    <div className="flex h-[400px]">
      <ChatWindow dialog={null} messages={[]} onSendMessage={() => {}} />
    </div>
  ),
}
