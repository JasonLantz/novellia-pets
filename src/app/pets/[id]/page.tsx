import { notFound } from "next/navigation"

import { connection } from "next/server"
import { Shell } from "@/components/shell"
import { DeleteButton } from "@/components/delete-button"
import { PetDialog } from "@/components/pet-dialog"
import { RecordDetails } from "@/components/record-details"
import { RecordDialog } from "@/components/record-dialog"
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
import { getPet, listChatMessages, listRecords } from "@/db/queries"
import { RECORD_TYPE_LABELS, type RecordType } from "@/db/schema"


export const instant = false

export default async function PetPage({ params }: { params: Promise<{ id: string }> }) {
  await connection()
  const { id } = await params
  const pet = await getPet(id)
  if (!pet) notFound()

  const [records, chat] = await Promise.all([
    listRecords({ petId: id }),
    listChatMessages(id, 1),
  ])

  const petForm = {
    id: pet.id,
    name: pet.name,
    species: pet.species,
    breed: pet.breed ?? "",
    sex: pet.sex ?? "",
    dateOfBirth: pet.dateOfBirth ?? "",
    weightKg: pet.weightG ? String(pet.weightG / 1000) : "",
    emoji: pet.emoji ?? "🐾",
    notes: pet.notes ?? "",
  }

  return (
    <Shell title={`${pet.emoji ?? "🐾"} ${pet.name}`}>
      <div className="grid gap-4 @5xl/main:grid-cols-3">
        <Card className="@5xl/main:col-span-1">
          <CardHeader className="flex-row items-start justify-between">
            <div>
              <CardTitle>Profile</CardTitle>
              <CardDescription>
                {pet.species}
                {pet.breed ? ` · ${pet.breed}` : ""}
              </CardDescription>
            </div>
            <div className="flex gap-1">
              <PetDialog pet={petForm} trigger={<Button size="sm" variant="outline">Edit</Button>} />
              <DeleteButton
                url="/api/pets"
                body={{ id: pet.id }}
                label=""
                doneLabel="Pet deleted"
              />
            </div>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <p>
              <span className="text-muted-foreground">Born:</span>{" "}
              {pet.dateOfBirth ?? "unknown"}
            </p>
            <p>
              <span className="text-muted-foreground">Sex:</span> {pet.sex ?? "unknown"}
            </p>
            <p>
              <span className="text-muted-foreground">Weight:</span>{" "}
              {pet.weightG ? `${(pet.weightG / 1000).toFixed(1)} kg` : "unknown"}
            </p>
            {pet.notes && <p className="pt-1">{pet.notes}</p>}
            <div className="flex gap-2 pt-2">
              <Button asChild size="sm">
                <a href={`/ask?pet=${encodeURIComponent(pet.name)}`}>✨ Ask Nova</a>
              </Button>
              <RecordDialog
                petId={pet.id}
                trigger={<Button size="sm" variant="outline">Add record</Button>}
              />
            </div>
            {chat.length > 0 && (
              <p className="text-muted-foreground text-xs">Last chat: {chat[0].createdAt}</p>
            )}
          </CardContent>
        </Card>

        <Card className="@5xl/main:col-span-2">
          <CardHeader>
            <CardTitle>Medical records</CardTitle>
            <CardDescription>{records.length} records, most recent first</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Vet</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{r.authoredAt}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {RECORD_TYPE_LABELS[r.type as RecordType] ?? r.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{r.title}</p>
                      {r.notes && (
                        <p className="text-muted-foreground text-xs">{r.notes}</p>
                      )}
                      <RecordDetails details={r.details} />
                    </TableCell>
                    <TableCell>{r.veterinarian ?? "—"}</TableCell>
                    <TableCell>
                      <DeleteButton
                        url="/api/records"
                        body={{ id: r.id }}
                        label=""
                        doneLabel="Record deleted"
                      />
                    </TableCell>
                  </TableRow>
                ))}
                {records.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground">
                      No records yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </Shell>
  )
}
