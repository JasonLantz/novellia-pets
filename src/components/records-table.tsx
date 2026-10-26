import Link from "next/link"

import { DeleteButton } from "@/components/delete-button"
import { RecordDetails } from "@/components/record-details"
import { RecordDialog } from "@/components/record-dialog"
import { Badge } from "@/components/ui/badge"
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
import { listRecords } from "@/db/queries"
import { RECORD_TYPE_LABELS, type RecordType } from "@/db/schema"

export async function RecordsTable({
  title,
  types,
  query,
}: {
  title: string
  types?: RecordType[]
  query?: string
}) {
  const pets = await import("@/db/queries").then((m) => m.listPets())
  const records = await listRecords({ types, query })

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          {records.length} record{records.length === 1 ? "" : "s"}
          {query ? ` matching “${query}”` : ""}
        </p>
        <RecordDialog
          pets={pets.map((p) => ({ id: p.id, name: p.name }))}
          defaultType={types?.length === 1 ? types[0] : undefined}
        />
      </div>
      <Card>
        <CardHeader className="sr-only">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{title} records</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Pet</TableHead>
                {types?.length !== 1 && <TableHead>Type</TableHead>}
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
                    <Link href={`/pets/${r.petId}`} className="flex items-center gap-1 hover:underline">
                      <span>{r.petEmoji}</span>
                      {r.petName}
                    </Link>
                  </TableCell>
                  {types?.length !== 1 && (
                    <TableCell>
                      <Badge variant="secondary">
                        {RECORD_TYPE_LABELS[r.type as RecordType] ?? r.type}
                      </Badge>
                    </TableCell>
                  )}
                  <TableCell>
                    <p className="font-medium">{r.title}</p>
                    {r.notes && <p className="text-muted-foreground text-xs">{r.notes}</p>}
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
                  <TableCell colSpan={6} className="text-muted-foreground">
                    Nothing here yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

