import { Routes, Route } from "react-router-dom"
import { AppLayout } from "@/layouts/AppLayout"
import { LoginPage } from "@/pages/LoginPage"
import { DashboardPage } from "@/pages/DashboardPage"
import { UniversitiesPage } from "@/pages/UniversitiesPage"
import { CoursesPage } from "@/pages/CoursesPage"
import { UniversityDetailPage } from "@/pages/UniversityDetailPage"
import { InteractionsPage } from "@/pages/InteractionsPage"
import { InteractionDetailPage } from "@/pages/InteractionDetailPage"
import { ProgramsPage } from "@/pages/ProgramsPage"
import { ProgramDetailPage } from "@/pages/ProgramDetailPage"
import { DocumentsPage } from "@/pages/DocumentsPage"
import { DocumentDetailPage } from "@/pages/DocumentDetailPage"
import { AnalyticsPage } from "@/pages/AnalyticsPage"
import { SettingsPage } from "@/pages/SettingsPage"
import { ProfilePage } from "@/pages/ProfilePage"
import { NotificationsPage } from "@/pages/NotificationsPage"
import { ProductsPage } from "@/pages/ProductsPage"
import { ApplicationsPage } from "@/pages/ApplicationsPage"
import { AuditLogPage } from "@/pages/AuditLogPage"
import { WorkflowPage } from "@/pages/WorkflowPage"
import { CalendarPage } from "@/pages/CalendarPage"
import { RequireAuth } from "@/app/guards/RequireAuth"
import { RequireRole } from "@/app/guards/RequireRole"
import { FlowEditorPage } from "@/pages/admin/FlowEditorPage"
import { UsersPage } from "@/pages/admin/UsersPage"
import { ImportPage } from "@/pages/admin/ImportPage"
import { IntegrationsPage } from "@/pages/admin/IntegrationsPage"
import { PersonsPage } from "@/pages/admin/PersonsPage"
import { NotFoundPage } from "@/pages/NotFoundPage"
import { RegionMapPage } from "@/pages/RegionMapPage"
import { ChatPage } from "@/pages/ChatPage"
import { HelpPage } from "@/pages/HelpPage"

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/universities" element={<UniversitiesPage />} />
        <Route path="/universities/:id" element={<UniversityDetailPage />} />
        <Route path="/interactions" element={<InteractionsPage />} />
        <Route path="/interactions/:id" element={<InteractionDetailPage />} />
        <Route path="/programs" element={<ProgramsPage />} />
        <Route path="/courses" element={<CoursesPage />} />
        <Route path="/programs/:id" element={<ProgramDetailPage />} />
        <Route path="/documents" element={<DocumentsPage />} />
        <Route path="/documents/:id" element={<DocumentDetailPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route
          path="/settings"
          element={
            <RequireRole roles={["ADMIN"]}>
              <SettingsPage />
            </RequireRole>
          }
        />
        <Route
          path="/settings/audit"
          element={
            <RequireRole roles={["ADMIN"]}>
              <AuditLogPage />
            </RequireRole>
          }
        />
        <Route
          path="/admin/flow-editor"
          element={
            <RequireRole roles={["ADMIN"]}>
              <FlowEditorPage />
            </RequireRole>
          }
        />
        <Route
          path="/admin/users"
          element={
            <RequireRole roles={["ADMIN"]}>
              <UsersPage />
            </RequireRole>
          }
        />
        <Route
          path="/admin/import"
          element={
            <RequireRole roles={["ADMIN"]}>
              <ImportPage />
            </RequireRole>
          }
        />
        <Route
          path="/admin/integrations"
          element={
            <RequireRole roles={["ADMIN"]}>
              <IntegrationsPage />
            </RequireRole>
          }
        />
        <Route
          path="/admin/persons"
          element={
            <RequireRole roles={["ADMIN"]}>
              <PersonsPage />
            </RequireRole>
          }
        />
        <Route path="/workflow" element={<WorkflowPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/applications" element={<ApplicationsPage />} />
        <Route path="/region-map" element={<RegionMapPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
