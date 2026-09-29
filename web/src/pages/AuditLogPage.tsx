import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useStore } from "@/app/store"
import { selectAuditLog, selectEmployees } from "@/app/store/selectors"
import { Shield } from "@mynaui/icons-react"
import type { ChainVerificationDto } from "@/shared/api"
import { auditAction, auditDetails, auditEntity } from "@/shared/lib/audit"
import { dataSource } from "@/shared/config"
import { toast } from "@/shared/lib/toast-store"

export function AuditLogPage() {
  const auditLog = useStore(selectAuditLog)
  const employees = useStore(selectEmployees)
  const verifyAudit = useStore((s) => s.verifyAudit)
  const refreshAudit = useStore((s) => s.refreshAudit)
  const [verification, setVerification] = useState<ChainVerificationDto | null>(null)
  const [verifying, setVerifying] = useState(false)

  // Журнал — цепочка хэшей: подмена или удаление записи задним числом
  // разрывает её, и проверка показывает место разрыва.
  const handleVerify = async () => {
    setVerifying(true)
    const result = await verifyAudit()
    setVerifying(false)
    if (!result) return
    setVerification(result)
    if (result.intact) toast.success("Цепочка журнала цела", `Проверено записей: ${result.checked}`)
    else toast.error("Цепочка журнала нарушена", result.message)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Аудит-лог</h1>
          <p className="text-sm text-muted-foreground">Журнал действий пользователей в системе</p>
        </div>
        {dataSource === "api" && (
          <div className="flex items-center gap-2">
            {verification && (
              <Badge variant={verification.intact ? "default" : "destructive"}>
                {verification.intact ? `цела · ${verification.checked} записей` : `разрыв на записи ${verification.brokenAtId}`}
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={() => void refreshAudit()}>
              Обновить
            </Button>
            <Button size="sm" disabled={verifying} onClick={() => void handleVerify()}>
              {verifying ? "Проверка…" : "Проверить целостность"}
            </Button>
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="size-4" />
            Все записи ({auditLog.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Дата</TableHead>
                <TableHead>Пользователь</TableHead>
                <TableHead>Действие</TableHead>
                <TableHead>Сущность</TableHead>
                <TableHead>Описание</TableHead>
                <TableHead>IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auditLog.map((entry) => {
                const user = employees.find((e) => e.email === entry.actorEmail)
                const action = auditAction(entry.action)
                const snapshot = entry.afterState as Record<string, unknown> | null
                const details = auditDetails(snapshot)
                return (
                  <TableRow key={entry.id}>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {new Date(entry.occurredAt).toLocaleDateString("ru-RU")} {new Date(entry.occurredAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                    </TableCell>
                    <TableCell className="font-medium text-sm">{user?.displayName || entry.actorEmail || "Система"}</TableCell>
                    <TableCell><Badge variant={action.variant}>{action.label}</Badge></TableCell>
                    <TableCell className="text-sm">{auditEntity(entry.entityType)}</TableCell>
                    <TableCell
                      className="text-sm text-muted-foreground max-w-xs truncate"
                      title={snapshot ? JSON.stringify(snapshot, null, 1) : undefined}
                    >
                      {details}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{entry.ipAddress}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
