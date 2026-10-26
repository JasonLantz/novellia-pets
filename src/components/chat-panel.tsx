"use client"

import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { useEffect, useMemo, useRef, useState } from "react"
import { SendIcon, SquareIcon, Trash2Icon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { PetRow } from "@/db/queries"

type ModelStatus = { status: string; percent: number; model: string }

export function ChatPanel({ pets }: { pets: PetRow[] }) {
  const [petId, setPetId] = useState<string>(pets[0]?.id ?? "")
  const [input, setInput] = useState("")
  const scroller = useRef<HTMLDivElement>(null)

  const pet = pets.find((p) => p.id === petId)

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { petId },
      }),
    [petId],
  )

  const { messages, sendMessage, status, stop } = useChat({
    id: `chat-${petId}`,
    transport,
    throttle: 50,
  })

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [messages])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || status !== "ready" || !petId) return
    setInput("")
    await sendMessage({ text })
  }

  return (
    <Card className="flex h-[calc(100dvh-8rem)] min-h-[420px] flex-col">
      <CardHeader className="flex-row items-center justify-between gap-2">
        <div>
          <CardTitle>✨ Ask Nova</CardTitle>
          <CardDescription>
            On-device AI (Qwen2.5-0.5B-Instruct) grounded in{" "}
            {petId === "all"
              ? "all your pets’ records"
              : pet
                ? `${pet.name}’s records`
                : "your pet’s records"}
            . Not veterinary advice.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Select value={petId} onValueChange={setPetId}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Pick a pet" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All pets</SelectItem>
              {pets.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.emoji} {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            title="New conversation"
            onClick={() => window.location.reload()}
          >
            <Trash2Icon />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
        <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-2">
          {messages.length === 0 && (
            <div className="text-muted-foreground pt-8 text-center text-sm">
              <p>Try: “When is {pets[0]?.name ?? "Luna"}’s next vaccine due?”</p>
              <p className="mt-1">
                The first question downloads the model (~480MB) — later chats are cached.
              </p>
            </div>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
            >
              <div
                className={
                  m.role === "user"
                    ? "bg-primary text-primary-foreground max-w-[85%] rounded-2xl px-3 py-2 text-sm"
                    : "bg-muted max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap"
                }
              >
                {m.parts.map((p, i) => {
                  if (p.type === "text") return <span key={i}>{p.text}</span>
                  if (p.type === "data-modelStatus") {
                    const d = (p as { data: ModelStatus }).data
                    if (d.status === "ready") return null
                    return (
                      <p key={i} className="text-muted-foreground text-xs">
                        {d.status === "downloading"
                          ? `Downloading model… ${d.percent}%`
                          : "Loading model…"}
                      </p>
                    )
                  }
                  return null
                })}
              </div>
            </div>
          ))}
          {status === "submitted" && (
            <div className="flex justify-start">
              <div className="bg-muted text-muted-foreground rounded-2xl px-3 py-2 text-sm">
                Nova is thinking…
              </div>
            </div>
          )}
        </div>
        <form onSubmit={submit} className="flex items-center gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={pet ? `Ask about ${pet.name}…` : "Pick a pet first"}
            disabled={!petId}
          />
          {status === "streaming" ? (
            <Button type="button" variant="outline" size="icon" onClick={stop}>
              <SquareIcon />
            </Button>
          ) : (
            <Button type="submit" size="icon" disabled={!input.trim() || status !== "ready"}>
              <SendIcon />
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
