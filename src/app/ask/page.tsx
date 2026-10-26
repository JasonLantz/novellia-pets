import { redirect } from "next/navigation"

import { ChatPanel } from "@/components/chat-panel"
import { connection } from "next/server"
import { Shell } from "@/components/shell"
import { listPets } from "@/db/queries"


export const instant = false

export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<{ pet?: string }>
}) {
  await connection()
  const { pet: petName } = await searchParams
  const pets = await listPets()
  if (pets.length === 0) redirect("/pets")

  // Preselect via ?pet=<name> from the sidebar
  const ordered = petName
    ? [
        ...pets.filter((p) => p.name.toLowerCase() === petName.toLowerCase()),
        ...pets.filter((p) => p.name.toLowerCase() !== petName.toLowerCase()),
      ]
    : pets

  return (
    <Shell title="Ask Nova">
      <ChatPanel pets={ordered} />
    </Shell>
  )
}
