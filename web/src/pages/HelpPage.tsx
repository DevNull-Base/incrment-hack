import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { api, type GuideSummaryDto } from "@/shared/api"
import { dataSource } from "@/shared/config"
import { Markdown } from "@/shared/ui/markdown"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"

interface GuideSection {
  title: string
  steps: string[]
}

const USER_GUIDE: GuideSection[] = [
  {
    title: "Вход и роли",
    steps: [
      "Введите учётные данные или выберите тестовый аккаунт в списке под формой.",
      "КАМ — свои заявки и вузы; Руководитель — команда и уведомления о зависших заявках; Администратор — техническая часть системы.",
    ],
  },
  {
    title: "Рабочий стол",
    steps: [
      "KPI-цифры вверху — быстрый срез: заявки в работе, успешные коммуникации, просроченные SLA.",
      "«Зависшие задачи» — заявки без изменений за N дней; порог (7/14/30) переключается в шапке блока.",
    ],
  },
  {
    title: "Канбан взаимодействий",
    steps: [
      "Раздел «Взаимодействия»: переключайте сегмент B2B/B2C вверху справа.",
      "Перетаскивайте карточку между этапами — статус меняется сразу (перетаскивание начинается после 5px движения).",
    ],
  },
  {
    title: "Разделение экрана",
    steps: [
      "Кнопка «Разделение экрана» в хедере или Ctrl+\\: слева текущая страница, справа — окно выбора.",
      "Панели хранятся в адресной строке — ссылкой можно поделиться; назад/вперёд работает.",
    ],
  },
  {
    title: "Карта вузов",
    steps: [
      "Откройте «Карта вузов»: наведение — подсказка, клик по региону — статистика и список вузов.",
      "Кнопка «Скачать статистику (CSV)» выгружает данные региона; иконка во весь экран — увеличенный вид.",
    ],
  },
  {
    title: "Чат и уведомления",
    steps: [
      "Плавающая кнопка чата справа внизу — переписка по диалогам.",
      "Колокольчик в хедере — уведомления, включая сообщения о зависших заявках.",
    ],
  },
]

const ADMIN_GUIDE: GuideSection[] = [
  {
    title: "Пользователи и роли",
    steps: [
      "Администрирование → Пользователи: смена роли и статуса (свою роль изменить нельзя).",
      "Роли: USER = КАМ, MANAGER = руководитель, ADMIN = технический администратор.",
    ],
  },
  {
    title: "Конструктор workflow",
    steps: [
      "Администрирование → Редактор флоу: процессы B2B и B2C, этапы, переходы и публикация новой редакции.",
      "Изменения применяются едино для всех заявок; удаление состояния переносит заявки.",
    ],
  },
  {
    title: "Импорт данных",
    steps: [
      "Администрирование → Импорт данных: мастер из трёх шагов — файл, сопоставление полей, применение.",
    ],
  },
  {
    title: "Интеграции",
    steps: [
      "Администрирование → Интеграции: статусы источников (LMS, сайт, email, Telegram) и синхронизация.",
    ],
  },
  {
    title: "Аудит и 152-ФЗ",
    steps: [
      "Аудит-лог (/settings/audit) — все действия пользователей.",
      "Персоны — обезличивание данных по регламенту 152-ФЗ с записью причины в аудит.",
    ],
  },
  {
    title: "Настройки системы",
    steps: [
      "Раздел «Настройки системы» доступен только администратору.",
    ],
  },
]

function GuideList({ sections }: { sections: GuideSection[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {sections.map((section) => (
        <Card key={section.title}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{section.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1.5 pl-4 text-sm text-muted-foreground">
              {section.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export function HelpPage() {
  return dataSource === "api" ? <GuidesFromApi /> : <HelpDemo />
}

/**
 * Режим API: руководства — часть поставки бэкенда (docs/guides, GET /guides):
 * по ТЗ они открываются из самой системы. Список зависит от роли.
 */
function GuidesFromApi() {
  const [guides, setGuides] = useState<GuideSummaryDto[] | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [content, setContent] = useState<Record<string, string>>({})

  useEffect(() => {
    api.guides.list().then(
      (list) => {
        const sorted = [...list].sort((a, b) => a.order - b.order)
        setGuides(sorted)
        setActive((current) => current ?? sorted[0]?.slug ?? null)
      },
      () => setGuides([]),
    )
  }, [])

  useEffect(() => {
    if (!active || content[active] !== undefined) return
    api.guides.get(active).then(
      (guide) => setContent((c) => ({ ...c, [guide.slug]: guide.content })),
      () => {},
    )
  }, [active, content])

  const header = (
    <div>
      <h1 className="text-2xl font-bold">Справка</h1>
      <p className="text-sm text-muted-foreground">Руководства пользователя и администратора</p>
    </div>
  )

  if (!guides || guides.length === 0 || !active) {
    return (
      <div className="space-y-6">
        {header}
        {guides === null && <p className="text-sm text-muted-foreground">Загрузка…</p>}
      </div>
    )
  }

  // Переключатель руководств — в строке заголовка: он выбирает документ,
  // а не раздел текста, и не должен отнимать место у самого руководства.
  return (
    <Tabs value={active} onValueChange={(value) => setActive(String(value))} className="gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {header}
        {guides.length > 1 && (
          <TabsList aria-label="Руководство">
            {guides.map((g) => (
              <TabsTrigger key={g.slug} value={g.slug} className="px-3">
                {g.title}
              </TabsTrigger>
            ))}
          </TabsList>
        )}
      </div>
      {guides.map((g) => (
        <TabsContent key={g.slug} value={g.slug}>
          <Card>
            <CardHeader>
              <p className="text-sm text-muted-foreground">
                {g.description} · обновлено {new Date(g.updatedAt).toLocaleDateString("ru-RU")}
              </p>
            </CardHeader>
            <CardContent>
              {content[g.slug] === undefined ? (
                <p className="text-sm text-muted-foreground">Загрузка…</p>
              ) : (
                <Markdown source={content[g.slug]} />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      ))}
    </Tabs>
  )
}

/** Демо-режим: краткие шаги по интерфейсу. */
function HelpDemo() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Справка</h1>
        <p className="text-sm text-muted-foreground">
          Руководства пользователя и администратора
        </p>
      </div>

      <Tabs defaultValue="user">
        <TabsList>
          <TabsTrigger value="user">Руководство пользователя</TabsTrigger>
          <TabsTrigger value="admin">Руководство администратора</TabsTrigger>
        </TabsList>
        <TabsContent value="user" className="mt-4">
          <GuideList sections={USER_GUIDE} />
        </TabsContent>
        <TabsContent value="admin" className="mt-4">
          <GuideList sections={ADMIN_GUIDE} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
