import { RegionalAnalytics } from "@/components/RegionalAnalytics"

/** Карта вузов: регионы России по выбранному показателю. */
export function RegionMapPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Карта вузов</h1>
        <p className="text-sm text-muted-foreground">География присутствия по регионам России</p>
      </div>
      <RegionalAnalytics />
    </div>
  )
}
