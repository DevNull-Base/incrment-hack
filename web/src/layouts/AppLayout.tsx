import { Outlet, useLocation } from "react-router-dom"
import { SidebarV2 } from "./SidebarV2"
import { Header } from "./Header"
import { SplitProvider, useSplit } from "@/components/SplitContext"
import { SplitScreenLayout } from "@/components/SplitScreenLayout"
import { PageBreadcrumbs } from "@/components/PageBreadcrumbs"
import { ChatWidget } from "@/components/ui/chat"
import { useStore } from "@/app/store"

function AppLayoutInner() {
  const { enabled } = useSplit()
  const location = useLocation()

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Хедер — всегда на всю ширину в самом верху */}
      <Header />

      {/* Контент: сайдбар + основная область */}
      <div className="flex flex-1 overflow-hidden min-w-0">
        {/* Основной сайдбар — скрывается при split */}
        <div className="hidden lg:block">
          <SidebarV2 hidden={enabled} />
        </div>

        <main className="flex-1 overflow-hidden min-w-0">
          <SplitScreenLayout>
            <div className="h-full overflow-y-auto">
              <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
                <PageBreadcrumbs path={location.pathname} className="mb-4" />
                <Outlet />
              </div>
            </div>
          </SplitScreenLayout>
        </main>
      </div>

    </div>
  )
}

/** Глобальный виджет чата (плавающая кнопка справа внизу). */
function ChatWidgetHost() {
  const dialogs = useStore((s) => s.chatDialogs)
  const messages = useStore((s) => s.chatMessages)
  const user = useStore((s) => s.user)
  const sendChatMessage = useStore((s) => s.sendChatMessage)
  // Мок-режим без бэкенда: отправка пишется в локальный стор чата.
  return (
    <ChatWidget
      dialogs={dialogs}
      messages={messages}
      onSelectDialog={() => undefined}
      onSendMessage={(dialogId, text) =>
        sendChatMessage(dialogId, text, {
          id: user?.id ?? "system",
          name: user?.displayName ?? "Система",
        })
      }
    />
  )
}

export function AppLayout() {
  return (
    <SplitProvider>
      <AppLayoutInner />
      <ChatWidgetHost />
    </SplitProvider>
  )
}
