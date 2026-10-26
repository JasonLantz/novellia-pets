"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export type NavPet = {
  name: string
  url: string
  emoji: string | null
}

/**
 * My Pets section: pets passed from the server. The "Ask Nova" link chats
 * about the currently selected pet (falls back to no selection).
 */
export function NavPets({ pets, askUrl }: { pets: NavPet[]; askUrl: string }) {
  const pathname = usePathname()
  const activePet = pets.find((p) => pathname.startsWith(p.url))
  const chatHref = activePet
    ? `${askUrl}?pet=${encodeURIComponent(activePet.name)}`
    : askUrl
  return (
    <SidebarGroup>
      <SidebarGroupLabel>My Pets</SidebarGroupLabel>
      <SidebarMenu>
        {pets.map((pet) => (
          <SidebarMenuItem key={pet.url}>
            <SidebarMenuButton asChild isActive={pathname === pet.url} tooltip={pet.name}>
              <Link href={pet.url}>
                <span className="text-base leading-none">{pet.emoji ?? "🐾"}</span>
                <span>{pet.name}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
        <SidebarMenuItem>
          <SidebarMenuButton asChild isActive={pathname === askUrl} tooltip="Ask Nova">
            <Link href={chatHref}>
              <span className="text-base leading-none">✨</span>
              <span>Ask Nova (AI)</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  )
}
