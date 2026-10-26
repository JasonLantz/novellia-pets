"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { RecordType } from "@/db/schema"

export type RecordFormData = {
  id?: string
  type: RecordType
  title: string
  authoredAt: string
  veterinarian: string
  notes: string
}

const TYPE_OPTIONS: { value: RecordType; label: string }[] = [
  { value: "visit", label: "Visit" },
  { value: "vaccination", label: "Vaccination" },
  { value: "lab", label: "Lab result" },
  { value: "prescription", label: "Prescription" },
  { value: "document", label: "Document" },
]

export function RecordDialog({
  petId,
  defaultType,
  record,
  pets,
  trigger,
}: {
  petId?: string
  defaultType?: RecordType
  record?: RecordFormData
  pets?: { id: string; name: string }[]
  trigger?: React.ReactNode
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(() => ({
    type: record?.type ?? defaultType ?? "visit",
    title: record?.title ?? "",
    authoredAt: record?.authoredAt ?? new Date().toISOString().slice(0, 10),
    veterinarian: record?.veterinarian ?? "",
    notes: record?.notes ?? "",
    petId: petId ?? pets?.[0]?.id ?? "",
  }))
  const [pending, startTransition] = useTransition()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) {
      toast.error("Title is required")
      return
    }
    if (!petId && !form.petId) {
      toast.error("Pick a pet")
      return
    }
    const res = await fetch("/api/records", {
      method: record?.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: record?.id,
        petId: petId ?? form.petId,
        type: form.type,
        title: form.title,
        authoredAt: form.authoredAt,
        veterinarian: form.veterinarian || null,
        notes: form.notes || null,
      }),
    })
    if (!res.ok) {
      toast.error((await res.json().catch(() => ({})))?.error ?? "Save failed")
      return
    }
    toast.success(record?.id ? "Record updated" : "Record added")
    setOpen(false)
    startTransition(() => router.refresh())
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? <Button>Add record</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{record?.id ? "Edit record" : "Add medical record"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          {!petId && (
            <div className="grid gap-2">
              <Label>Pet</Label>
              <Select value={form.petId} onValueChange={(v) => setForm((f) => ({ ...f, petId: v }))}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select pet" />
                </SelectTrigger>
                <SelectContent>
                  {(pets ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Type</Label>
              <Select
                value={form.type}
                onValueChange={(v) => setForm((f) => ({ ...f, type: v as RecordType }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="authoredAt">Date</Label>
              <Input
                id="authoredAt"
                type="date"
                value={form.authoredAt}
                onChange={(e) => setForm((f) => ({ ...f, authoredAt: e.target.value }))}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="vet">Veterinarian</Label>
            <Input
              id="vet"
              value={form.veterinarian}
              onChange={(e) => setForm((f) => ({ ...f, veterinarian: e.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              rows={3}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : record?.id ? "Save changes" : "Add record"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
