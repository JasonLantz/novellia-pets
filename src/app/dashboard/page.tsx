import Link from "next/link"
import { ArrowUpRightIcon, ClipboardListIcon, PawPrintIcon } from "lucide-react"

import { connection } from "next/server"
import { Shell } from "@/components/shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { PetActivityChart, type PetActivityDatum } from "@/components/pet-activity-chart"
import { getDashboardStats, listPets, listRecords, RECORD_TYPE_LABELS } from "@/db/queries"
import type { RecordType } from "@/db/schema"

const CHART_TYPE_KEYS = ["visit", "vaccination", "lab", "prescription", "document"]

/** Records per pet, segmented by type; most active pet first. */
function buildActivityData(
  pets: { id: string; name: string }[],
  records: { petId: string; type: string }[],
): PetActivityDatum[] {
  const byPet = new Map<string, PetActivityDatum>()
  for (const p of pets) {
    const row = { pet: p.name } as PetActivityDatum
    for (const t of CHART_TYPE_KEYS) row[t] = 0
    byPet.set(p.id, row)
  }
  for (const r of records) {
    const row = byPet.get(r.petId)
    if (!row) continue
    if (CHART_TYPE_KEYS.includes(r.type)) {
      row[r.type] = (row[r.type] ?? 0) + 1
    }
  }
  return [...byPet.values()].slice(0, 8)
}


function ageLabel(dob: string | null): string {
  if (!dob) return "—"
  const d = new Date(dob)
  if (Number.isNaN(d.getTime())) return "—"
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  const years = Math.floor(days / 365)
  const months = Math.floor((days % 365) / 30)
  return years > 0 ? `${years}y ${months}m` : `${months}m`
}

export const instant = false

export default async function DashboardPage() {
  await connection()
  const [stats, pets, recent] = await Promise.all([
    getDashboardStats(),
    listPets(),
    listRecords({ limit: 8 }),
  ])
  const allRecords = await listRecords({})
  const activityData = buildActivityData(pets, allRecords)

  return (
    <Shell title="Dashboard">
      <div className="grid grid-rows-[auto_auto_1fr] gap-4 @5xl/main:grid-cols-2 @5xl/main:gap-6">
        <Card className="@5xl/main:col-span-2">
          <div className="grid gap-8 p-6 @2xl/main:grid-cols-[auto_minmax(0,1fr)] @2xl/main:items-center @2xl/main:gap-10">
            <div className="w-full shrink-0 @2xl/main:w-[340px]">
              <p className="mb-2 text-center text-xs font-medium tracking-wide uppercase">
                Activity by pet
              </p>
              {stats.records === 0 ? (
                <p className="text-muted-foreground py-10 text-center text-sm">
                  Add records to see activity here.
                </p>
              ) : (
                <PetActivityChart data={activityData} />
              )}
            </div>
            <div className="min-w-0">
              <CardHeader className="p-0 pb-2">
                <CardTitle>Your pets at a glance</CardTitle>
                <CardDescription>
                  {stats.pets} pet{stats.pets === 1 ? "" : "s"} · {stats.records} medical record
                  {stats.records === 1 ? "" : "s"}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2 p-0 pt-2">
                {(Object.entries(stats.byType) as [RecordType, number][]).map(([type, count]) => (
                  <Badge key={type} variant="outline">
                    {RECORD_TYPE_LABELS[type]}: {count}
                  </Badge>
                ))}
              </CardContent>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PawPrintIcon className="size-4" /> Pets
            </CardTitle>
            <CardDescription>Overview of every pet</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pet</TableHead>
                  <TableHead>Age</TableHead>
                  <TableHead>Weight</TableHead>
                  <TableHead>Records</TableHead>
                  <TableHead>Last record</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pets.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Link
                        className="flex items-center gap-2 font-medium hover:underline"
                        href={`/pets/${p.id}`}
                      >
                        <span>{p.emoji ?? "🐾"}</span> {p.name}
                        <span className="text-muted-foreground text-xs">{p.species}</span>
                      </Link>
                    </TableCell>
                    <TableCell>{ageLabel(p.dateOfBirth)}</TableCell>
                    <TableCell>
                      {p.weightG ? `${(p.weightG / 1000).toFixed(1)} kg` : "—"}
                    </TableCell>
                    <TableCell>{p.recordCount}</TableCell>
                    <TableCell>{p.lastRecordAt ?? "—"}</TableCell>
                  </TableRow>
                ))}
                {pets.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground">
                      No pets yet — add your first pet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ClipboardListIcon className="size-4" /> Recent records
              </CardTitle>
              <CardDescription>Latest activity across all pets</CardDescription>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/records">
                View all <ArrowUpRightRightIcon />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {recent.map((r) => (
              <div key={r.id} className="flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {r.petEmoji} {r.title}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {r.petName} · {r.authoredAt}
                    {r.veterinarian ? ` · ${r.veterinarian}` : ""}
                  </p>
                </div>
                <Badge variant="secondary" className="shrink-0">
                  {RECORD_TYPE_LABELS[r.type as RecordType] ?? r.type}
                </Badge>
              </div>
            ))}
            {recent.length === 0 && (
              <p className="text-muted-foreground text-sm">No records yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </Shell>
  )
}

function ArrowUpRightRightIcon() {
  return <ArrowUpRightIcon className="size-4" />
}
