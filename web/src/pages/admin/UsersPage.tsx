import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useStore } from "@/app/store"
import { selectAdminUsers } from "@/app/store/selectors"
import { ROLE_LABELS } from "@/shared/lib/roles"
import type { SystemRole } from "@/shared/api"
import { toast } from "@/shared/lib/toast-store"
import { ShieldCheck, UserX, UserCheck } from "@mynaui/icons-react"
import { DataScopeDialog } from "@/components/DataScopeDialog"
import type { AdminUserRow } from "@/app/store/adminSlice"
import type { ScopeDimension } from "@/shared/api"

const ROLES: SystemRole[] = ["USER", "MANAGER", "ADMIN"]

const SCOPE_LABELS: Record<ScopeDimension, string> = {
  UNIVERSITY: "вузы",
  REGION: "регионы",
  IT_DIRECTION: "направления",
  SOFTWARE_PRODUCT: "продукты",
}

/** Кратко об ограничениях: «без ограничений» либо «вузы: 3, регионы: 1». */
function scopeSummary(u: AdminUserRow): string {
  const rules = u.scopeRules ?? []
  if (rules.length === 0) return "Без ограничений"
  return rules.map((r) => `${SCOPE_LABELS[r.dimension]}: ${r.allowedIds.length}`).join(", ")
}

/** Управление пользователями (ADMIN): роли, статус, руководитель и доступ к данным. */
export function UsersPage() {
  const users = useStore(selectAdminUsers)
  const changeUserRole = useStore((s) => s.changeUserRole)
  const changeUserStatus = useStore((s) => s.changeUserStatus)
  const changeUserManager = useStore((s) => s.changeUserManager)
  const me = useStore((s) => s.user)
  const [search, setSearch] = useState("")
  const [scopeUser, setScopeUser] = useState<AdminUserRow | null>(null)
  const managers = users.filter((u) => u.role === "MANAGER" && u.isActive)

  const filtered = users.filter(
    (u) =>
      u.displayName.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Пользователи</h1>
        <p className="text-sm text-muted-foreground">
          Роли, статусы, подчинённость и ограничения видимости данных.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4" />
            Учётные записи ({filtered.length})
          </CardTitle>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по имени или email"
            className="h-auto w-64 rounded-lg border bg-transparent px-3 py-1.5 text-sm"
          />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Сотрудник</TableHead>
                <TableHead>Роль</TableHead>
                <TableHead>Источник</TableHead>
                <TableHead>Руководитель</TableHead>
                <TableHead>Доступ к данным</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((u) => (
                <TableRow key={u.id}>
                  {/* Почта под именем, а не отдельной колонкой: иначе колонка действий не помещается. */}
                  <TableCell>
                    <div className="font-medium">{u.displayName}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </TableCell>
                  <TableCell>
                    <select
                      value={u.role}
                      disabled={u.id === me?.id}
                      onChange={async (e) => {
                        const role = e.target.value as SystemRole
                        const result = await changeUserRole(u.id, role)
                        if (result.ok) toast.success("Роль обновлена", `${u.displayName} — ${ROLE_LABELS[role]}`)
                        else toast.error("Роль не изменена", result.error)
                      }}
                      className="rounded-md border bg-transparent px-2 py-1 text-sm"
                      title={u.id === me?.id ? "Роль себе сменить нельзя" : "Сменить роль"}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.roleSource === "KEYCLOAK" ? "outline" : "secondary"}>
                      {u.roleSource}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {u.role === "USER" ? (
                      <select
                        value={u.managerId ?? ""}
                        aria-label={`Руководитель: ${u.displayName}`}
                        onChange={async (e) => {
                          const managerId = e.target.value || null
                          const result = await changeUserManager(u.id, managerId)
                          if (result.ok) toast.success("Руководитель назначен", u.displayName)
                          else toast.error("Руководитель не изменён", result.error)
                        }}
                        className="max-w-[12rem] rounded-md border bg-transparent px-2 py-1 text-sm"
                      >
                        <option value="">— не назначен</option>
                        {managers.map((m) => (
                          <option key={m.id} value={m.id}>{m.displayName}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => setScopeUser(u)}
                      disabled={u.role === "ADMIN"}
                      title={u.role === "ADMIN" ? "Администратор видит всё" : "Настроить доступ к данным"}
                      className="text-left text-sm text-primary underline-offset-2 hover:underline disabled:text-muted-foreground disabled:no-underline"
                    >
                      {u.role === "ADMIN" ? "Все данные" : scopeSummary(u)}
                    </button>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.isActive ? "default" : "destructive"}>
                      {u.isActive ? "Активен" : "Заблокирован"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={u.id === me?.id}
                      onClick={async () => {
                        const result = await changeUserStatus(u.id, !u.isActive)
                        if (result.ok) {
                          toast.success(
                            u.isActive ? "Пользователь заблокирован" : "Пользователь активирован",
                            u.displayName,
                          )
                        } else {
                          toast.error("Статус не изменён", result.error)
                        }
                      }}
                    >
                      {u.isActive ? <UserX className="size-4" /> : <UserCheck className="size-4" />}
                      {u.isActive ? "Заблокировать" : "Активировать"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <DataScopeDialog key={scopeUser?.id ?? "none"} user={scopeUser} onClose={() => setScopeUser(null)} />
    </div>
  )
}
