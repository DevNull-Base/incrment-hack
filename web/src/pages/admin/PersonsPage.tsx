import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useStore } from "@/app/store"
import { selectPersons } from "@/app/store/selectors"
import { toast } from "@/shared/lib/toast-store"
import { Trash, Shield } from "@mynaui/icons-react"
import type { LawfulBasis } from "@/shared/api/types"

/** Правовое основание обработки (ст. 6 152-ФЗ) — словами, а не кодом перечисления. */
const LAWFUL_BASIS_LABELS: Record<LawfulBasis, string> = {
  CONTRACT: "Договор",
  CONSENT: "Согласие",
  LEGAL_OBLIGATION: "Требование закона",
  UNDEFINED: "Не определено",
}

/** Персоны (152-ФЗ): просмотр, retention, erase с подтверждением. */
export function PersonsPage() {
  const persons = useStore(selectPersons)
  const loaded = useStore((s) => s.personsLoaded)
  const loadPersons = useStore((s) => s.loadPersons)
  const erasePerson = useStore((s) => s.erasePerson)

  useEffect(() => {
    void loadPersons()
  }, [loadPersons])
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [reason, setReason] = useState("")

  const user = useStore((s) => s.user)
  // Обезличивание — только администратор (бэкенд: POST /persons/{id}/erase).
  const canErase = user?.role === "ADMIN"

  const handleErase = async () => {
    if (!confirmId || !reason.trim()) return
    const result = await erasePerson(confirmId, reason.trim())
    if (!result.ok) {
      toast.error("Не удалось обезличить", result.error)
      return
    }
    setConfirmId(null)
    setReason("")
    toast.success("ПДн обезличены", "Запись добавлена в аудит-лог")
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Персональные данные (152-ФЗ)</h1>
        <p className="text-sm text-muted-foreground">
          Обработка ПДн: правовое основание, срок хранения, стирание по требованию субъекта
        </p>
      </div>

      <Card className="border-warning/40">
        <CardContent className="flex items-start gap-3 p-4">
          <Shield className="mt-0.5 size-4 text-warning" />
          <p className="text-sm text-muted-foreground">
            Обращения к данным пишутся в аудит-лог. Стирание обезличивает контакт необратимо
            и фиксирует причину.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Контакты ({persons.length}){!loaded && " · загрузка…"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ФИО</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Телефон</TableHead>
                <TableHead>Основание</TableHead>
                <TableHead>Хранение до</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {persons.map((p) => (
                <TableRow key={p.id} className={p.erasedAt ? "opacity-50" : ""}>
                  <TableCell className="font-medium">{p.fullName}</TableCell>
                  <TableCell className="text-sm">{p.email ?? "—"}</TableCell>
                  <TableCell className="text-sm">{p.phone ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={p.lawfulBasis === "UNDEFINED" ? "secondary" : "outline"}>
                      {LAWFUL_BASIS_LABELS[p.lawfulBasis] ?? p.lawfulBasis}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {p.retentionUntil ? new Date(p.retentionUntil).toLocaleDateString("ru-RU") : "—"}
                  </TableCell>
                  <TableCell>
                    {!p.erasedAt && canErase && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => setConfirmId(p.id)}
                      >
                        <Trash className="size-4" /> Стереть
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {confirmId && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base text-destructive">Подтвердите стирание (152-ФЗ)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Причина стирания (обязательно)"
              className="h-auto w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" disabled={!reason.trim()} onClick={handleErase}>
                Стереть ПДн
              </Button>
              <Button size="sm" variant="outline" onClick={() => setConfirmId(null)}>
                Отмена
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
