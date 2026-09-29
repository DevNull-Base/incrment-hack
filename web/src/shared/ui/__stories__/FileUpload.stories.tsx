import type { Meta, StoryObj } from "@storybook/react-vite"
import { FileUpload } from "@/shared/ui/file-upload"
import { useState, type ComponentProps } from "react"
import type { FileUploadFile } from "@/shared/ui/file-upload"

const meta: Meta<typeof FileUpload> = {
  title: "UI/FileUpload",
  component: FileUpload,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
}
export default meta
type Story = StoryObj<typeof FileUpload>

function FileUploadStory({
  initial,
  ...uploadProps
}: { initial?: FileUploadFile[] } & Omit<
  ComponentProps<typeof FileUpload>,
  "value" | "onChange"
>) {
  const [files, setFiles] = useState<FileUploadFile[]>(initial ?? [])
  return (
    <div className="mx-auto max-w-lg">
      <FileUpload value={files} onChange={setFiles} {...uploadProps} />
    </div>
  )
}

export const Default: Story = {
  render: () => <FileUploadStory />,
}

export const WithPreloadedFiles: Story = {
  render: () => (
    <FileUploadStory
      initial={[
        { id: "1", name: "Договор_МГУ.pdf", size: 245760, type: "application/pdf" },
        { id: "2", name: "Программа_обучения.docx", size: 102400, type: "application/docx" },
        { id: "3", name: "Презентация.pptx", size: 5242880, type: "application/pptx" },
      ]}
    />
  ),
}

export const SingleFile: Story = {
  render: () => <FileUploadStory multiple={false} maxFiles={1} accept=".pdf,.doc,.docx" />,
}

export const Disabled: Story = {
  args: {
    disabled: true,
  },
}

export const MaxFilesReached: Story = {
  render: () => (
    <FileUploadStory
      initial={[
        { id: "1", name: "file1.pdf", size: 1024, type: "application/pdf" },
        { id: "2", name: "file2.pdf", size: 2048, type: "application/pdf" },
        { id: "3", name: "file3.pdf", size: 3072, type: "application/pdf" },
      ]}
      maxFiles={3}
    />
  ),
}

export const WithAcceptFilter: Story = {
  render: () => <FileUploadStory accept=".pdf,.doc,.docx,.xls,.xlsx" />,
}
