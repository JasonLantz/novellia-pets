"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { SearchIcon } from "lucide-react"

import { Input } from "@/components/ui/input"

/**
 * URL-driven search: typing replaces ?q= so the server component filters.
 */
export function SearchBox({ placeholder }: { placeholder?: string }) {
  const router = useRouter()
  const [q, setQ] = useState(() => {
    if (typeof window === "undefined") return ""
    return new URLSearchParams(window.location.search).get("q") ?? ""
  })
  const [, startTransition] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const params = new URLSearchParams(window.location.search)
    if (q.trim()) params.set("q", q.trim())
    else params.delete("q")
    startTransition(() => router.replace(`?${params.toString()}`))
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-sm items-center gap-2">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder ?? "Search…"}
        className="h-8"
      />
      <button type="submit" className="text-muted-foreground" aria-label="Search">
        <SearchIcon className="size-4" />
      </button>
    </form>
  )
}
