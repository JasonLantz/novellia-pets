import { RecordsTable } from "@/components/records-table"
import { SearchBox } from "@/components/search-box"
import { connection } from "next/server"
import { Shell } from "@/components/shell"


export const instant = false

export default async function VisitsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  await connection()
  const { q } = await searchParams
  return (
    <Shell title="Visits">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SearchBox placeholder="Search visits…" />
      </div>
      <RecordsTable title="Visits" types={["visit", "vaccination"]} query={q} />
    </Shell>
  )
}
