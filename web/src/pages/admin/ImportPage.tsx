import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { toast } from "@/shared/lib/toast-store"
import { Upload, ArrowRight, CheckCircle } from "lucide-react"
import { dataSource } from "@/shared/config"
import { ImportLive } from "./ImportLive"

type WizardStep = "fields" | "file" | "mapping" | "resolutions" | "apply"

const STEPS: { id: WizardStep; label: string }[] = [
  { id: "fields", label: "Поля" },
  { id: "file", label: "Файл" },
  { id: "mapping", label: "Маппинг" },
  { id: "resolutions", label: "Конфликты" },
  { id: "apply", label: "Применить" },
]

const DEMO_FIELDS = [
  { key: "name", label: "Наименование вуза", required: true, synonyms: ["вуз", "университет"] },
  { key: "inn", label: "ИНН", required: false, synonyms: ["инн"] },
  { key: "region", label: "Регион", required: false, synonyms: ["регион", "область"] },
]

/** Мастер импорта (ADMIN): 5 шагов openapi /import. */
export function ImportPage() {
  return dataSource === "api" ? <ImportLive /> : <ImportDemo />
}

/** Демо-режим: шаги мастера без бэкенда. */
function ImportDemo() {
  const [step, setStep] = useState<WizardStep>("fields")
  const [fileName, setFileName] = useState<string | null>(null)
  const stepIndex = STEPS.findIndex((s) => s.id === step)

  const next = () => {
    const i = STEPS.findIndex((s) => s.id === step)
    if (i < STEPS.length - 1) setStep(STEPS[i + 1].id)
  }
  const back = () => {
    const i = STEPS.findIndex((s) => s.id === step)
    if (i > 0) setStep(STEPS[i - 1].id)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Импорт данных</h1>
        <p className="text-sm text-muted-foreground">
          Мастер загрузки: поля → файл → маппинг → конфликты → применение
        </p>
      </div>

      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2">
            <Badge variant={i <= stepIndex ? "default" : "outline"}>
              {i + 1}. {s.label}
            </Badge>
            {i < STEPS.length - 1 && <ArrowRight className="size-3 text-muted-foreground" />}
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {STEPS[stepIndex].label}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === "fields" && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Доступные поля назначения (GET /api/v1/import/fields)
              </p>
              {DEMO_FIELDS.map((f) => (
                <div key={f.key} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <span className="text-sm font-medium">{f.label}</span>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{f.key}</span>
                  </div>
                  <div className="flex gap-1">
                    {f.required && <Badge variant="secondary">обязательно</Badge>}
                    {f.synonyms.map((s) => (
                      <Badge key={s} variant="outline">{s}</Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {step === "file" && (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <Upload className="mx-auto size-8 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">
                Загрузите CSV/XLSX (POST /api/v1/import)
              </p>
              <label className="mt-3 inline-block cursor-pointer">
                <Input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    if (!/\.(csv|xlsx|xls)$/i.test(file.name)) {
                      setFileName(null)
                      toast.error("Файл не загружен", "Поддерживаются CSV и XLSX")
                      return
                    }
                    setFileName(file.name)
                    toast.success("Файл загружен", file.name)
                  }}
                />
                <span className="rounded-lg border px-4 py-2 text-sm">Выбрать файл</span>
              </label>
              {fileName && (
                <p className="mt-2 text-sm font-medium text-success">{fileName}</p>
              )}
            </div>
          )}

          {step === "mapping" && (
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                Сопоставьте заголовки файла с полями (PUT /import/&#123;id&#125;/mapping)
              </p>
              <div className="rounded-lg border p-3 font-mono text-xs">
                «Вуз» → name · «ИНН» → inn · «Регион» → region
              </div>
            </div>
          )}

          {step === "resolutions" && (
            <p className="text-sm text-muted-foreground">
              Разрешите конфликты дубликатов: сопоставить с существующим UUID или «CREATE_NEW»
              (PUT /import/&#123;id&#125;/resolutions)
            </p>
          )}

          {step === "apply" && (
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle className="size-5 text-success" />
              <span>Готово к применению (POST /import/&#123;id&#125;/apply)</span>
            </div>
          )}

          <div className="flex justify-between pt-2">
            <Button variant="outline" onClick={back} disabled={stepIndex === 0}>
              Назад
            </Button>
            {stepIndex < STEPS.length - 1 ? (
              <Button onClick={next}>Далее</Button>
            ) : (
              <Button
                disabled={!fileName}
                onClick={() => {
                  setStep("fields")
                  toast.success("Импорт применён", fileName ?? undefined)
                }}
              >
                Завершить
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
