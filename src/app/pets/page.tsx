import Link from "next/link"

import { connection } from "next/server"
import { Shell } from "@/components/shell"
import { DeleteButton } from "@/components/delete-button"
import { PetDialog } from "@/components/pet-dialog"
import { SearchBox } from "@/components/search-box"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { listPets } from "@/db/queries"


export const instant = false

export default async function PetsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  await connection()
  const { q } = await searchParams
  const all = await listPets()
  const pets = q
    ? all.filter((p) =>
        [p.name, p.species, p.breed, p.notes]
          .filter(Boolean)
          .some((v) => (v as string).toLowerCase().includes(q.toLowerCase())),
      )
    : all

  return (
    <Shell title="Pets">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SearchBox placeholder="Search pets…" />
        <PetDialog />
      </div>
      <div className="grid gap-4 md:grid-cols-2 @5xl/main:grid-cols-3">
        {pets.map((p) => (
          <Card key={p.id}>
            <CardHeader className="flex-row items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <span className="text-xl">{p.emoji ?? "🐾"}</span>
                  <Link href={`/pets/${p.id}`} className="hover:underline">
                    {p.name}
                  </Link>
                </CardTitle>
                <CardDescription>
                  {p.species}
                  {p.breed ? ` · ${p.breed}` : ""}
                  {p.dateOfBirth ? ` · born ${p.dateOfBirth}` : ""}
                </CardDescription>
              </div>
              <DeleteButton
                url="/api/pets"
                body={{ id: p.id }}
                label=""
                doneLabel={`${p.name} deleted`}
              />
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="secondary">{p.recordCount} records</Badge>
              {p.lastRecordAt && (
                <span className="text-muted-foreground text-xs">last: {p.lastRecordAt}</span>
              )}
              <Button asChild size="sm" variant="outline" className="ml-auto">
                <Link href={`/pets/${p.id}`}>Open</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
        {pets.length === 0 && (
          <p className="text-muted-foreground">No pets match “{q}”.</p>
        )}
      </div>
    </Shell>
  )
}
