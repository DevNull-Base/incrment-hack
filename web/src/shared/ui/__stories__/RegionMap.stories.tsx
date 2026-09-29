import type { Meta, StoryObj } from "@storybook/react-vite"
import { RegionMap, type RegionMapStat } from "@/shared/ui/region-map"

const stats: RegionMapStat[] = [
  {
    region: "Москва",
    universityCount: 1,
    interactionCount: 2,
    overdueCount: 0,
    studentsCount: 2,
    applicationCount: 1,
    universities: [{ name: "МГУ", city: "Москва" }],
  },
  {
    region: "Санкт-Петербург",
    universityCount: 1,
    interactionCount: 1,
    overdueCount: 1,
    studentsCount: 1,
    applicationCount: 1,
    universities: [{ name: "СПбПУ", city: "Санкт-Петербург" }],
  },
  {
    region: "Новосибирская область",
    universityCount: 1,
    interactionCount: 1,
    overdueCount: 0,
    studentsCount: 1,
    applicationCount: 0,
    universities: [{ name: "НГУ", city: "Новосибирск" }],
  },
  {
    region: "Республика Татарстан",
    universityCount: 1,
    interactionCount: 1,
    overdueCount: 0,
    studentsCount: 0,
    applicationCount: 1,
    universities: [{ name: "КФУ", city: "Казань" }],
  },
  {
    region: "Свердловская область",
    universityCount: 1,
    interactionCount: 0,
    overdueCount: 0,
    studentsCount: 1,
    applicationCount: 0,
    universities: [{ name: "УрФУ", city: "Екатеринбург" }],
  },
]

const meta: Meta<typeof RegionMap> = {
  title: "Widgets/RegionMap",
  component: RegionMap,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
}
export default meta
type Story = StoryObj<typeof RegionMap>

export const WithData: Story = {
  args: {
    stats,
  },
}

export const NoData: Story = {
  args: {
    stats: [],
  },
}
