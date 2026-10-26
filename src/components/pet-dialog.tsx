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

const SPECIES = ["Dog", "Cat", "Rabbit", "Bird", "Reptile", "Other"]
const EMOJIS = ["🐕", "🐈", "🐇", "🦜", "🦎", "🐹", "🐢", "🐾"]

export type PetFormData = {
  id?: string
  name: string
  species: string
  breed: string
  sex: string
  dateOfBirth: string
  weightKg: string
  emoji: string
  notes: string
}

const empty: PetFormData = {
  name: "",
  species: "Dog",
  breed: "",
  sex: "",
  dateOfBirth: "",
  weightKg: "",
  emoji: "🐾",
  notes: "",
}

export function PetDialog({
  pet,
  trigger,
}: {
  pet?: PetFormData
  trigger?: React.ReactNode
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<PetFormData>(pet ?? empty)
  const [pending, startTransition] = useTransition()

  const set = (k: keyof PetFormData) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim() || !form.species) {
      toast.error("Name and species are required")
      return
    }
    const res = await fetch("/api/pets", {
      method: pet?.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, id: pet?.id }),
    })
    if (!res.ok) {
      toast.error((await res.json().catch(() => ({})))?.error ?? "Save failed")
      return
    }
    toast.success(pet?.id ? "Pet updated" : "Pet added")
    setOpen(false)
    setForm(pet ?? empty)
    startTransition(() => router.refresh())
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? <Button>{pet?.id ? "Edit" : "Add pet"}</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{pet?.id ? "Edit pet" : "Add pet"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={form.name} onChange={(e) => set("name")(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Species</Label>
              <Select value={form.species} onValueChange={set("species")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SPECIES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="breed">Breed</Label>
              <Input id="breed" value={form.breed} onChange={(e) => set("breed")(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Sex</Label>
              <Select value={form.sex || undefined} onValueChange={set("sex")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="male">Male</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="dob">Date of birth</Label>
              <Input
                id="dob"
                type="date"
                value={form.dateOfBirth}
                onChange={(e) => set("dateOfBirth")(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="weight">Weight (kg)</Label>
              <Input
                id="weight"
                type="number"
                step="0.1"
                value={form.weightKg}
                onChange={(e) => set("weightKg")(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Emoji</Label>
              <Select value={form.emoji} onValueChange={set("emoji")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EMOJIS.map((e) => (
                    <SelectItem key={e} value={e}>
                      {e}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" rows={3} value={form.notes} onChange={(e) => set("notes")(e.target.value)} />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : pet?.id ? "Save changes" : "Add pet"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
