import * as React from "react"
import { cn } from "cn"
import {
  Send,
  Search,
  X,
} from "lucide-react"
import { ChatDots } from "@mynaui/icons-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import type { ChatDialog, ChatMessage } from "@/types"

// ========================================
// Утилиты
// ========================================
function formatMessageTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()

  if (isToday) {
    return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
  }
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })
}

function formatDialogTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
  }
  if (diffDays === 1) return "Вчера"
  if (diffDays < 7) {
    const days = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"]
    return days[d.getDay()]
  }
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })
}

// ========================================
// DialogItem — элемент в списке диалогов
// ========================================
interface DialogItemProps {
  dialog: ChatDialog
  isActive: boolean
  onClick: () => void
}

function DialogItem({ dialog, isActive, onClick }: DialogItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-3 rounded-2xl p-2.5 text-left transition-all duration-150",
        isActive
          ? "bg-primary/8 ring-1 ring-primary/15 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.08)]"
          : "hover:bg-muted/70",
      )}
    >
      <div className="relative shrink-0">
        <Avatar className="size-10">
          <AvatarFallback className="bg-gradient-to-br from-primary/20 via-primary/10 to-secondary/20 text-primary text-xs font-semibold">
            {dialog.avatarInitials}
          </AvatarFallback>
        </Avatar>
        <span className="absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-card bg-emerald-500" aria-label="В сети" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{dialog.title}</span>
          <span className="shrink-0 text-[10px] font-medium text-muted-foreground tabular-nums">
            {formatDialogTime(dialog.lastMessageAt)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-[11px] text-muted-foreground line-clamp-1">
            {dialog.participantRole}
          </p>
          {dialog.unreadCount > 0 && (
            <Badge className="h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] font-medium">
              {dialog.unreadCount}
            </Badge>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground/90 line-clamp-2">
          {dialog.lastMessage}
        </p>
      </div>
    </button>
  )
}

// ========================================
// ChatSidebar — список диалогов справа
// ========================================
interface ChatSidebarProps {
  dialogs: ChatDialog[]
  activeDialogId: string | null
  onSelectDialog: (id: string) => void
  className?: string
}

function ChatSidebar({
  dialogs,
  activeDialogId,
  onSelectDialog,
  className,
}: ChatSidebarProps) {
  const [search, setSearch] = React.useState("")

  const filtered = dialogs.filter(
    (d) =>
      d.title.toLowerCase().includes(search.toLowerCase()) ||
      d.participantName.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div
      className={cn(
        "flex w-full shrink-0 flex-col border-t border-border bg-slate-50/60 xl:w-[330px] xl:border-l xl:border-t-0 dark:bg-slate-950/40",
        className,
      )}
    >
      {/* Header */}
      <div className="px-3.5 pt-3.5 pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
              Команда
            </p>
            <h3 className="text-sm font-semibold text-foreground">Сотрудники</h3>
          </div>
          <Badge variant="secondary" className="h-5 rounded-full px-2 text-[10px]">{dialogs.length}</Badge>
        </div>
        <div className="relative mt-3">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по сотрудникам"
            className="h-8 pl-8 text-sm bg-background/70"
          />
        </div>
      </div>
      <Separator />
      {/* List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {filtered.map((dialog) => (
          <DialogItem
            key={dialog.id}
            dialog={dialog}
            isActive={dialog.id === activeDialogId}
            onClick={() => onSelectDialog(dialog.id)}
          />
        ))}
        {filtered.length === 0 && (
          <p className="py-8 text-center text-xs text-muted-foreground">
            Нет диалогов
          </p>
        )}
      </div>
    </div>
  )
}

// ========================================
// MessageBubble — пузырь сообщения
// ========================================
interface MessageBubbleProps {
  message: ChatMessage
}

function MessageBubble({ message }: MessageBubbleProps) {
  return (
    <div
      className={cn(
        "flex max-w-[75%] gap-2",
        message.isOwn ? "ml-auto flex-row-reverse" : "",
      )}
    >
      <Avatar className="size-7 shrink-0 mt-0.5">
        <AvatarFallback
          className={cn(
            "text-[10px] font-semibold",
            message.isOwn
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground",
          )}
        >
          {message.senderName
            .split(" ")
            .map((n) => n[0])
            .join("")
            .slice(0, 2)}
        </AvatarFallback>
      </Avatar>
      <div>
        <div className="flex items-baseline gap-2">
          {!message.isOwn && (
            <span className="text-[11px] font-medium text-muted-foreground">
              {message.senderName.split(" ")[0]}
            </span>
          )}
          <span className="text-[10px] text-muted-foreground/60 tabular-nums">
            {formatMessageTime(message.createdAt)}
          </span>
        </div>
        <div
          className={cn(
            "mt-1 rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
            message.isOwn
              ? "bg-primary text-primary-foreground rounded-br-md"
              : "bg-muted text-foreground rounded-bl-md",
          )}
        >
          {message.text}
        </div>
      </div>
    </div>
  )
}

// ========================================
// ChatWindow — окно чата (центр)
// ========================================
interface ChatWindowProps {
  dialog: ChatDialog | null
  messages: ChatMessage[]
  onSendMessage: (text: string) => void
}

function ChatWindow({ dialog, messages, onSendMessage }: ChatWindowProps) {
  const [input, setInput] = React.useState("")
  const messagesEndRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  if (!dialog) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <div className="flex flex-col items-center gap-3">
          <ChatDots className="size-10 text-muted-foreground/30" />
          <p className="text-sm">Выберите диалог</p>
        </div>
      </div>
    )
  }

  const handleSend = () => {
    const text = input.trim()
    if (!text) return
    onSendMessage(text)
    setInput("")
  }

  return (
    <div className="flex flex-1 flex-col min-w-0 bg-background">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-border bg-background/80 px-4 py-3.5 shrink-0 backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative">
            <Avatar className="size-10">
              <AvatarFallback className="bg-primary/12 text-primary text-xs font-semibold">
                {dialog.avatarInitials}
              </AvatarFallback>
            </Avatar>
            <span className="absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-background bg-emerald-500" aria-label="В сети" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-semibold">{dialog.title}</p>
              <Badge variant="outline" className="h-5 rounded-full px-1.5 text-[10px] text-emerald-600 border-emerald-200 bg-emerald-50 dark:text-emerald-400 dark:border-emerald-900/60 dark:bg-emerald-950/30">
                Online
              </Badge>
            </div>
            <p className="truncate text-[11px] text-muted-foreground">
              {dialog.participantName} • {dialog.participantRole}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <Badge variant="secondary" className="h-6 rounded-full px-2 text-[10px]">Команда</Badge>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.05),_transparent_40%)] px-4 py-4 space-y-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border bg-background/90 px-4 py-3 shrink-0 backdrop-blur-sm">
        <div className="flex items-end gap-2 rounded-2xl border border-border bg-muted/30 p-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder="Напишите сообщение сотруднику..."
            rows={1}
            className="flex-1 resize-none rounded-xl border-0 bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground min-h-[40px] max-h-[120px]"
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!input.trim()}
            className="shrink-0 rounded-xl size-10 shadow-sm"
          >
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

// ========================================
// ChatWidget — плавающая кнопка + мини-модалка
// ========================================
interface ChatWidgetProps {
  dialogs: ChatDialog[]
  messages: Record<string, ChatMessage[]>
  onSelectDialog: (id: string) => void
  /** Отправка текста; без него сообщение не теряется молча (см. AppLayout). */
  onSendMessage?: (dialogId: string, text: string) => void
}

function ChatWidget({ dialogs, messages, onSelectDialog, onSendMessage }: ChatWidgetProps) {
  const [open, setOpen] = React.useState(false)
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [input, setInput] = React.useState("")
  const messagesEndRef = React.useRef<HTMLDivElement>(null)

  const recentDialogs = dialogs.slice(0, 5)
  const activeDialog = activeId ? dialogs.find((d) => d.id === activeId) : null
  const activeMessages = activeId ? messages[activeId] || [] : []

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [activeMessages])

  const handleSend = () => {
    const text = input.trim()
    if (!text || !activeId) return
    if (onSendMessage) onSendMessage(activeId, text)
    else onSelectDialog(activeId)
    setInput("")
  }

  const handleSelectDialog = (id: string) => {
    setActiveId(id)
  }

  const totalUnread = dialogs.reduce((sum, d) => sum + d.unreadCount, 0)

  return (
    <>
      {/* Floating button */}
      <div className="fixed bottom-6 right-6 z-50" data-chat-launcher>
        <Button
          size="icon-lg"
          onClick={() => setOpen(!open)}
          className={cn(
            "rounded-full shadow-lg transition-all duration-200",
            open && "rotate-0",
          )}
        >
          {open ? (
            <X className="size-5" />
          ) : (
            <span className="relative">
              <ChatDots className="size-5" />
              {totalUnread > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-destructive-foreground">
                  {totalUnread}
                </span>
              )}
            </span>
          )}
        </Button>
      </div>

      {/* Mini modal */}
      {open && (
        <div className="fixed bottom-20 right-6 z-50 w-[360px] h-[480px] rounded-2xl bg-card ring-1 ring-foreground/10 shadow-xl flex flex-col overflow-hidden animate-in fade-in-0 zoom-in-95 duration-150">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
            <div className="flex items-center gap-2">
              <ChatDots className="size-4 text-primary" />
              <span className="text-sm font-semibold">Чат</span>
            </div>
            {activeId && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setActiveId(null)}
              >
                Назад
              </Button>
            )}
          </div>

          {activeId && activeDialog ? (
            /* Mini chat view */
            <>
              <div className="flex items-center gap-2.5 border-b border-border px-4 py-2.5 shrink-0">
                <Avatar className="size-7">
                  <AvatarFallback className="bg-primary/15 text-primary text-[10px] font-semibold">
                    {activeDialog.avatarInitials}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">
                    {activeDialog.title}
                  </p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {activeDialog.participantName}
                  </p>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
                {activeMessages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}
                <div ref={messagesEndRef} />
              </div>
              <div className="border-t border-border px-3 py-2.5 shrink-0">
                <div className="flex items-end gap-1.5">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault()
                        handleSend()
                      }
                    }}
                    placeholder="Сообщение..."
                    rows={1}
                    className="flex-1 resize-none rounded-lg border border-input bg-transparent px-2.5 py-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 placeholder:text-muted-foreground min-h-[32px] max-h-[80px]"
                  />
                  <Button
                    size="icon-xs"
                    onClick={handleSend}
                    disabled={!input.trim()}
                    className="shrink-0 rounded-lg"
                  >
                    <Send className="size-3" />
                  </Button>
                </div>
              </div>
            </>
          ) : (
            /* Dialog list */
            <div className="flex-1 overflow-y-auto">
              {recentDialogs.map((dialog) => (
                <button
                  key={dialog.id}
                  onClick={() => handleSelectDialog(dialog.id)}
                  className="flex w-full items-start gap-2.5 px-4 py-3 text-left transition-colors hover:bg-muted border-b border-border/50 last:border-0"
                >
                  <Avatar className="size-8 shrink-0">
                    <AvatarFallback className="bg-primary/15 text-primary text-[10px] font-semibold">
                      {dialog.avatarInitials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="text-xs font-medium truncate">
                        {dialog.title}
                      </span>
                      <span className="text-[9px] text-muted-foreground shrink-0 tabular-nums">
                        {formatDialogTime(dialog.lastMessageAt)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-1">
                      {dialog.lastMessage}
                    </p>
                  </div>
                  {dialog.unreadCount > 0 && (
                    <Badge className="mt-0.5 size-4 shrink-0 items-center justify-center rounded-full p-0 text-[9px]">
                      {dialog.unreadCount}
                    </Badge>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}

// ========================================
// ChatPage — полная страница чатов
// ========================================
interface ChatPageProps {
  dialogs?: ChatDialog[]
  messages?: Record<string, ChatMessage[]>
}

function ChatPage({
  dialogs = [],
  messages = {},
}: ChatPageProps) {
  const [activeDialogId, setActiveDialogId] = React.useState<string | null>(
    () => {
      const first = dialogs.find((d) => d.unreadCount > 0) || dialogs[0]
      return first?.id || null
    },
  )

  const [localMessages, setLocalMessages] =
    React.useState<Record<string, ChatMessage[]>>(messages)

  React.useEffect(() => {
    setLocalMessages(messages)
  }, [messages])

  const activeDialog = dialogs.find((d) => d.id === activeDialogId) || null
  // Proxy state for current messages
  const activeId = activeDialogId

  const handleSend = (text: string) => {
    if (!activeId) return
    const newMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      dialogId: activeId,
      senderId: "e1",
      senderName: "Иванов А.П.",
      text,
      createdAt: new Date().toISOString(),
      isOwn: true,
    }
    setLocalMessages((prev) => ({
      ...prev,
      [activeId]: [...(prev[activeId] || []), newMsg],
    }))
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden xl:flex-row">
      {/* Chat window — center */}
      <div className="min-w-0 flex-1 overflow-hidden">
        <ChatWindow
          dialog={activeDialog}
          messages={activeId ? localMessages[activeId] || [] : []}
          onSendMessage={handleSend}
        />
      </div>

      {/* Sidebar — right */}
      <ChatSidebar
        dialogs={dialogs}
        activeDialogId={activeDialogId}
        onSelectDialog={setActiveDialogId}
        className="w-full xl:w-[320px]"
      />
    </div>
  )
}

export {
  ChatWindow,
  ChatSidebar,
  ChatWidget,
  ChatPage,
  DialogItem,
  MessageBubble,
  type ChatWindowProps,
  type ChatSidebarProps,
  type ChatWidgetProps,
  type ChatPageProps,
  type DialogItemProps,
  type MessageBubbleProps,
}
