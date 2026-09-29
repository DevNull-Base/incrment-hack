import * as React from "react"
import { Routes, Route } from "react-router-dom"
import { cn } from "cn"
import { GripVertical } from "lucide-react"
import { useSplit } from "./SplitContext"
import { SidebarV2 } from "@/layouts/SidebarV2"
import { RequireRole } from "@/app/guards/RequireRole"
import { PageBreadcrumbs } from "./PageBreadcrumbs"
import { visiblePages, type SplitPageDef } from "@/app/nav-config"
import { useStore } from "@/app/store"
import { getSplitRecent } from "@/shared/lib/split-recent"

// ========================================
// SplitPageChooser — правая панель без страницы: серый фон
// и центральное окно с популярными/недавними страницами
// ========================================
const CHOOSER_POPULAR_PATHS = ["/universities", "/interactions", "/documents", "/applications"]

function ChooserTile({
  page,
  onSelect,
}: {
  page: SplitPageDef
  onSelect: (path: string) => void
}) {
  const Icon = page.icon
  return (
    <button
      type="button"
      onClick={() => onSelect(page.path)}
      className="group flex items-center gap-3 rounded-lg border border-border/60 bg-card p-3 text-left transition-all duration-150 ease-out hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-md bg-muted",
          page.color,
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 truncate text-sm font-medium">{page.label}</span>
    </button>
  )
}

function SplitPageChooser({
  onSelect,
  onClose,
}: {
  onSelect: (path: string) => void
  onClose: () => void
}) {
  const role = useStore((s) => s.user?.role)
  const available = visiblePages(role)
  const popular = CHOOSER_POPULAR_PATHS.map((path) => available.find((p) => p.path === path)).filter(
    (p): p is SplitPageDef => p != null,
  )
  const recent = getSplitRecent()
    .filter((path) => !CHOOSER_POPULAR_PATHS.includes(path))
    .map((path) => available.find((p) => p.path === path))
    .filter((p): p is SplitPageDef => p != null)
    .slice(0, 3)

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [onClose])

  return (
    <div className="flex h-full items-center justify-center bg-muted/40 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-150">
        <div className="w-full max-w-sm rounded-xl border border-border/60 bg-card p-6 shadow-lg">
        <h2 className="text-base font-semibold">Открыть справа</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Выберите страницу</p>

        {popular.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Популярные
            </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {popular.map((page) => (
                <ChooserTile key={page.path} page={page} onSelect={onSelect} />
              ))}
            </div>
          </div>
        )}

        {recent.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Недавние
            </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {recent.map((page) => (
                <ChooserTile key={page.path} page={page} onSelect={onSelect} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Lazy page components for split panes
const LazyDashboard = React.lazy(() => import("@/pages/DashboardPage").then((m) => ({ default: m.DashboardPage })))
const LazyCalendar = React.lazy(() => import("@/pages/CalendarPage").then((m) => ({ default: m.CalendarPage })))
const LazyUniversities = React.lazy(() => import("@/pages/UniversitiesPage").then((m) => ({ default: m.UniversitiesPage })))
const LazyCourses = React.lazy(() => import("@/pages/CoursesPage").then((m) => ({ default: m.CoursesPage })))
const LazyUniversityDetail = React.lazy(() => import("@/pages/UniversityDetailPage").then((m) => ({ default: m.UniversityDetailPage })))
const LazyPrograms = React.lazy(() => import("@/pages/ProgramsPage").then((m) => ({ default: m.ProgramsPage })))
const LazyProgramDetail = React.lazy(() => import("@/pages/ProgramDetailPage").then((m) => ({ default: m.ProgramDetailPage })))
const LazyDocuments = React.lazy(() => import("@/pages/DocumentsPage").then((m) => ({ default: m.DocumentsPage })))
const LazyDocumentDetail = React.lazy(() => import("@/pages/DocumentDetailPage").then((m) => ({ default: m.DocumentDetailPage })))
const LazyAnalytics = React.lazy(() => import("@/pages/AnalyticsPage").then((m) => ({ default: m.AnalyticsPage })))
const LazyApplications = React.lazy(() => import("@/pages/ApplicationsPage").then((m) => ({ default: m.ApplicationsPage })))
const LazyWorkflow = React.lazy(() => import("@/pages/WorkflowPage").then((m) => ({ default: m.WorkflowPage })))
const LazyRegionMap = React.lazy(() => import("@/pages/RegionMapPage").then((m) => ({ default: m.RegionMapPage })))
const LazyInteractions = React.lazy(() => import("@/pages/InteractionsPage").then((m) => ({ default: m.InteractionsPage })))
const LazyInteractionDetail = React.lazy(() => import("@/pages/InteractionDetailPage").then((m) => ({ default: m.InteractionDetailPage })))
const LazyProducts = React.lazy(() => import("@/pages/ProductsPage").then((m) => ({ default: m.ProductsPage })))
const LazyNotifications = React.lazy(() => import("@/pages/NotificationsPage").then((m) => ({ default: m.NotificationsPage })))
const LazyChat = React.lazy(() => import("@/pages/ChatPage").then((m) => ({ default: m.ChatPage })))
const LazyHelp = React.lazy(() => import("@/pages/HelpPage").then((m) => ({ default: m.HelpPage })))
const LazySettings = React.lazy(() => import("@/pages/SettingsPage").then((m) => ({ default: m.SettingsPage })))
const LazyAuditLog = React.lazy(() => import("@/pages/AuditLogPage").then((m) => ({ default: m.AuditLogPage })))
const LazyProfile = React.lazy(() => import("@/pages/ProfilePage").then((m) => ({ default: m.ProfilePage })))
const LazyAdminUsers = React.lazy(() => import("@/pages/admin/UsersPage").then((m) => ({ default: m.UsersPage })))
const LazyFlowEditor = React.lazy(() => import("@/pages/admin/FlowEditorPage").then((m) => ({ default: m.FlowEditorPage })))
const LazyImport = React.lazy(() => import("@/pages/admin/ImportPage").then((m) => ({ default: m.ImportPage })))
const LazyIntegrations = React.lazy(() => import("@/pages/admin/IntegrationsPage").then((m) => ({ default: m.IntegrationsPage })))
const LazyPersons = React.lazy(() => import("@/pages/admin/PersonsPage").then((m) => ({ default: m.PersonsPage })))

function AdminOnly({ children }: { children: React.ReactNode }) {
  return <RequireRole roles={["ADMIN"]}>{children}</RequireRole>
}

// ========================================
// SplitPage — renders page via <Routes> so useParams() works
// ========================================
function SplitPage({ path }: { path: string }) {
  return (
    <React.Suspense
      fallback={
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-xs">Загрузка...</p>
          </div>
        </div>
      }
    >
      <div className="h-full overflow-y-auto">
              <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
          <PageBreadcrumbs path={path} className="mb-4" />
          <Routes location={path}>
            <Route path="/" element={<LazyDashboard />} />
            <Route path="/calendar" element={<LazyCalendar />} />
          <Route path="/universities" element={<LazyUniversities />} />
          <Route path="/universities/:id" element={<LazyUniversityDetail />} />
          <Route path="/courses" element={<LazyCourses />} />
            <Route path="/programs" element={<LazyPrograms />} />
            <Route path="/programs/:id" element={<LazyProgramDetail />} />
            <Route path="/documents" element={<LazyDocuments />} />
            <Route path="/documents/:id" element={<LazyDocumentDetail />} />
            <Route path="/interactions" element={<LazyInteractions />} />
            <Route path="/interactions/:id" element={<LazyInteractionDetail />} />
            <Route path="/products" element={<LazyProducts />} />
            <Route path="/analytics" element={<LazyAnalytics />} />
            <Route path="/applications" element={<LazyApplications />} />
            <Route path="/workflow" element={<LazyWorkflow />} />
            <Route path="/region-map" element={<LazyRegionMap />} />
            <Route path="/notifications" element={<LazyNotifications />} />
            <Route path="/chat" element={<LazyChat />} />
            <Route path="/help" element={<LazyHelp />} />
            <Route path="/settings" element={<LazySettings />} />
            <Route path="/settings/audit" element={<AdminOnly><LazyAuditLog /></AdminOnly>} />
            <Route path="/admin/users" element={<AdminOnly><LazyAdminUsers /></AdminOnly>} />
            <Route path="/admin/flow-editor" element={<AdminOnly><LazyFlowEditor /></AdminOnly>} />
            <Route path="/admin/import" element={<AdminOnly><LazyImport /></AdminOnly>} />
            <Route path="/admin/integrations" element={<AdminOnly><LazyIntegrations /></AdminOnly>} />
            <Route path="/admin/persons" element={<AdminOnly><LazyPersons /></AdminOnly>} />
            <Route path="/profile" element={<LazyProfile />} />
            <Route
              path="*"
              element={
                <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                  <p className="text-sm font-medium">Страница не найдена</p>
                  <p className="text-xs mt-1">{path}</p>
                </div>
              }
            />
          </Routes>
        </div>
      </div>
    </React.Suspense>
  )
}

// ========================================
// SplitPane — panel with its own sidebar
// ========================================
interface SplitPaneProps {
  path: string
  side: "left" | "right"
  onPageSelect: (path: string) => void
  placeholder?: React.ReactNode
}

function SplitPane({ path, side, onPageSelect, placeholder }: SplitPaneProps) {
  const { setActiveSide } = useSplit()

  return (
    <div
      className="flex h-full overflow-visible"
      onMouseDown={() => setActiveSide(side)}
    >
      <SidebarV2 side={side} onPageSelect={onPageSelect} activePath={path} narrow />

      <div className="flex-1 overflow-hidden min-w-0">
        {path ? <SplitPage path={path} /> : placeholder}
      </div>
    </div>
  )
}

// ========================================
// SplitScreenLayout — main layout
// ========================================
export function SplitScreenLayout({ children }: { children: React.ReactNode }) {
  const { enabled, leftPage, rightPage, setLeftPage, setRightPage, reset } = useSplit()
  const [splitRatio, setSplitRatio] = React.useState(50)
  const [isDragging, setIsDragging] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  React.useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left
      const pct = (x / rect.width) * 100
      setSplitRatio(Math.min(Math.max(pct, 25), 75))
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
    return () => {
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
    }
  }, [isDragging])

  const handleDoubleClick = () => {
    setSplitRatio(50)
  }

  if (!enabled || !leftPage) {
    return <>{children}</>
  }

  return (
    <div ref={containerRef} className="flex h-full overflow-hidden">
      <div
        className="h-full overflow-visible transition-all duration-300 ease-out"
        style={{ width: `${splitRatio}%` }}
      >
        <SplitPane path={leftPage} side="left" onPageSelect={setLeftPage} />
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Разделитель панелей"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setSplitRatio((r) => Math.max(25, r - 5))
          if (e.key === "ArrowRight") setSplitRatio((r) => Math.min(75, r + 5))
        }}
        className={cn(
          "relative flex items-center justify-center transition-all duration-150 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
          isDragging
            ? "w-1.5 bg-primary/30 cursor-col-resize"
            : "w-1 bg-border hover:w-1.5 hover:bg-primary/20 cursor-col-resize",
        )}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
      >
        <div className={cn(
          "absolute flex items-center justify-center rounded-full transition-all",
          isDragging
            ? "size-6 bg-primary text-primary-foreground shadow-lg"
            : "size-5 bg-muted text-muted-foreground hover:bg-primary/20",
        )}>
          <GripVertical className="size-3" />
        </div>
      </div>

      <div
        className="h-full overflow-visible transition-all duration-300 ease-out"
        style={{ width: `${100 - splitRatio}%` }}
      >
        <SplitPane
          path={rightPage ?? ""}
          side="right"
          onPageSelect={setRightPage}
          placeholder={<SplitPageChooser onSelect={setRightPage} onClose={reset} />}
        />
      </div>
    </div>
  )
}
