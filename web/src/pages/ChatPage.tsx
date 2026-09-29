import { ChatPage as ChatPageComponent } from "@/components/ui/chat"
import { useStore } from "@/app/store"
import { selectChatDialogs, selectChatMessages } from "@/app/store/selectors"

export function ChatPage() {
  const chatDialogs = useStore(selectChatDialogs)
  const chatMessages = useStore(selectChatMessages)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Внутренний мессенджер</h1>
        <p className="text-sm text-muted-foreground">
          Коммуникация команды, коллег и рабочих обсуждений по проектам
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border bg-background">
        <div className="h-[70vh] min-h-[420px] w-full overflow-hidden">
          <ChatPageComponent dialogs={chatDialogs} messages={chatMessages} />
        </div>
      </div>
    </div>
  )
}
