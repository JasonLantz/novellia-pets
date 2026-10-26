import { RecordsTable } from "@/components/records-table"
import { SearchBox } from "@/components/search-box"
import { connection } from "next/server"
import { Shell } from "@/components/shell"


export const instant = false

export default async function LabsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  await connection()
  const { q } = await searchParams
  return (
    <Shell title="Labs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SearchBox placeholder="Search lab results…" />
      </div>
      <RecordsTable title="Labs" types={["lab"]} query={q} />
    </Shell>
  )
}
