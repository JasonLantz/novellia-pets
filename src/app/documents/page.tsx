import { RecordsTable } from "@/components/records-table"
import { SearchBox } from "@/components/search-box"
import { connection } from "next/server"
import { Shell } from "@/components/shell"


export const instant = false

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  await connection()
  const { q } = await searchParams
  return (
    <Shell title="Documents">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SearchBox placeholder="Search documents…" />
      </div>
      <RecordsTable title="Documents" types={["document"]} query={q} />
    </Shell>
  )
}
