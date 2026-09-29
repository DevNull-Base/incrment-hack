import * as React from "react"
import { cn } from "cn"
import { CloudUpload, FileText, X } from "lucide-react"
import { Button } from "@/components/ui/button"

interface FileUploadFile {
  id: string
  name: string
  size: number
  type: string
}

interface FileUploadProps {
  value?: FileUploadFile[]
  onChange?: (files: FileUploadFile[]) => void
  accept?: string
  multiple?: boolean
  maxFiles?: number
  maxSize?: number // in bytes
  className?: string
  disabled?: boolean
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

function getFileExtension(name: string): string {
  return name.split(".").pop()?.toLowerCase() || ""
}

const EXTENSION_COLORS: Record<string, string> = {
  pdf: "bg-destructive/10 text-destructive",
  doc: "bg-info/10 text-info",
  docx: "bg-info/10 text-info",
  xls: "bg-success/10 text-success",
  xlsx: "bg-success/10 text-success",
  png: "bg-accent/10 text-accent",
  jpg: "bg-accent/10 text-accent",
  jpeg: "bg-accent/10 text-accent",
  zip: "bg-muted text-muted-foreground",
  rar: "bg-muted text-muted-foreground",
}

function FileUpload({
  value = [],
  onChange,
  accept,
  multiple = true,
  maxFiles = 10,
  maxSize = 10 * 1024 * 1024,
  className,
  disabled = false,
}: FileUploadProps) {
  const [isDragOver, setIsDragOver] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList) return
    const newFiles: FileUploadFile[] = []

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i]
      if (value.length + newFiles.length >= maxFiles) break
      if (file.size > maxSize) continue

      newFiles.push({
        id: `${Date.now()}-${i}`,
        name: file.name,
        size: file.size,
        type: file.type,
      })
    }

    if (newFiles.length > 0) {
      onChange?.([...value, ...newFiles])
    }
  }

  const handleRemove = (id: string) => {
    onChange?.(value.filter((f) => f.id !== id))
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!disabled) setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    if (!disabled) handleFiles(e.dataTransfer.files)
  }

  const handleClick = () => {
    if (!disabled) inputRef.current?.click()
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            handleClick()
          }
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-all duration-150 cursor-pointer",
          "outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          isDragOver
            ? "border-primary bg-primary/5 scale-[1.01]"
            : "border-border hover:border-primary/40 hover:bg-muted/50",
          disabled && "opacity-50 cursor-not-allowed",
        )}
      >
        <span
          className={cn(
            "flex size-10 items-center justify-center rounded-xl transition-colors",
            isDragOver ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          <CloudUpload className="size-5" />
        </span>
        <div>
          <p className="text-sm font-medium">
            {isDragOver ? "Отпустите файлы" : "Нажмите или перетащите файлы"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {accept
              ? `Поддерживаемые форматы: ${accept}`
              : "Любые файлы"}
            {maxFiles > 1 && ` · До ${maxFiles} файлов`}
          </p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple && maxFiles > 1}
        onChange={(e) => {
          handleFiles(e.target.files)
          e.target.value = ""
        }}
        className="hidden"
      />

      {/* File list */}
      {value.length > 0 && (
        <div className="space-y-1.5">
          {value.map((file) => {
            const ext = getFileExtension(file.name)
            const colorClass = EXTENSION_COLORS[ext] || "bg-muted text-muted-foreground"

            return (
              <div
                key={file.id}
                className="group flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2 transition-colors hover:bg-muted/50"
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold uppercase",
                    colorClass,
                  )}
                >
                  {ext || <FileText className="size-4" />}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{file.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatFileSize(file.size)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRemove(file.id)
                  }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export { FileUpload, type FileUploadProps, type FileUploadFile }
