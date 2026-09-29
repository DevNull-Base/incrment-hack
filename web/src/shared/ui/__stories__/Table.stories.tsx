import type { Meta, StoryObj } from "@storybook/react-vite"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table"
import { Badge } from "@/shared/ui/badge"

const meta: Meta<typeof Table> = {
  title: "UI/Table",
  component: Table,
  tags: ["autodocs"],
}
export default meta
type Story = StoryObj<typeof Table>

const mockData = [
  { id: 1, name: "МГУ", region: "Москва", interactions: 2, status: "active" },
  { id: 2, name: "СПбПУ", region: "Санкт-Петербург", interactions: 1, status: "active" },
  { id: 3, name: "НГУ", region: "Новосибирск", interactions: 1, status: "active" },
  { id: 4, name: "КФУ", region: "Казань", interactions: 0, status: "pending" },
]

export const Default: Story = {
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Вуз</TableHead>
          <TableHead>Регион</TableHead>
          <TableHead>Взаимодействий</TableHead>
          <TableHead>Статус</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {mockData.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="font-medium">{row.name}</TableCell>
            <TableCell>{row.region}</TableCell>
            <TableCell>{row.interactions}</TableCell>
            <TableCell>
              <Badge variant={row.status === "active" ? "default" : "outline"}>
                {row.status === "active" ? "Активный" : "Ожидает"}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
}
