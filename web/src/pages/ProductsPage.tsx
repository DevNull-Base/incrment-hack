import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Box, Plus, Search } from "@mynaui/icons-react"
import { useStore } from "@/app/store"
import { selectInteractions, selectPrograms, selectProducts } from "@/app/store/selectors"
import { matchesQuery } from "@/shared/lib/search"
import { toast } from "@/shared/lib/toast-store"

export function ProductsPage() {
  const navigate = useNavigate()
  const products = useStore(selectProducts)
  const programs = useStore(selectPrograms)
  const interactions = useStore(selectInteractions)
  const user = useStore((s) => s.user)
  const [query, setQuery] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const canCreate = user?.role === "MANAGER" || user?.role === "ADMIN"

  const rows = products
    .filter((p) => matchesQuery(query, [p.name, p.vendorName, p.description]))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">IT-продукты</h1>
          <p className="text-sm text-muted-foreground">Каталог продуктов, передаваемых вузам</p>
        </div>
        {canCreate && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            Добавить продукт
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Box className="size-4" />
            Продукты ({rows.length})
          </CardTitle>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Продукт или вендор"
              aria-label="Поиск продукта"
              className="h-9 pl-8"
            />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Название</TableHead>
                <TableHead>Вендор</TableHead>
                <TableHead>Описание</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Программ</TableHead>
                <TableHead>Взаимодействий</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => {
                const programCount = programs.filter((prog) => prog.productId === p.id).length
                const interactionCount = interactions.filter((i) =>
                  i.productId ? i.productId === p.id : i.productName === p.name,
                ).length
                return (
                  <TableRow
                    key={p.id}
                    className="cursor-pointer hover:bg-muted/50"
                    title="Открыть взаимодействия по продукту"
                    onClick={() => navigate(`/interactions?productId=${p.id}`)}
                  >
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="text-sm">{p.vendorName}</TableCell>
                    <TableCell className="max-w-xs truncate text-sm text-muted-foreground">{p.description ?? "—"}</TableCell>
                    <TableCell><Badge variant="outline">{p.isActive ? "Активен" : "Неактивен"}</Badge></TableCell>
                    <TableCell><Badge variant="outline">{programCount}</Badge></TableCell>
                    <TableCell><Badge>{interactionCount}</Badge></TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CreateProductDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}

function CreateProductDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const vendors = useStore((s) => s.vendors)
  const addProduct = useStore((s) => s.addProduct)
  const [name, setName] = useState("")
  const [vendorId, setVendorId] = useState("")
  const [description, setDescription] = useState("")
  const [busy, setBusy] = useState(false)

  const close = (next: boolean) => {
    if (!next) {
      setName("")
      setVendorId("")
      setDescription("")
    }
    onOpenChange(next)
  }

  const submit = async () => {
    setBusy(true)
    const result = await addProduct({ name: name.trim(), vendorId, description: description.trim() || undefined })
    setBusy(false)
    if (!result.ok) {
      toast.error("Продукт не добавлен", result.error)
      return
    }
    toast.success("Продукт добавлен", result.product.name)
    close(false)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новый ИТ-продукт</DialogTitle>
          <DialogDescription>Продукт вендора из каталога. Вендоры с контактами загружаются импортом.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="product-name">Название</Label>
            <Input id="product-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Базис Dynamix" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="product-vendor">Вендор</Label>
            <select
              id="product-vendor"
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
              className="h-9 w-full rounded-lg border bg-transparent px-2 text-sm"
            >
              <option value="">Выберите вендора</option>
              {vendors
                .filter((v) => v.isActive)
                .map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="product-description">Описание</Label>
            <textarea
              id="product-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={busy}>
            Отмена
          </Button>
          <Button onClick={() => void submit()} disabled={busy || name.trim().length < 2 || !vendorId}>
            {busy ? "Сохранение…" : "Добавить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
