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

export type NavItem = {
  title: string
  url: string
  icon?: React.ReactNode
}

/**
 * Medical sections (Documents, Labs, Prescriptions…). A section stays
 * highlighted while the pathname is at or under its url.
 */
export function NavDocuments({ items }: { items: NavItem[] }) {
  const pathname = usePathname()
  const isActive = (url: string) =>
    pathname === url || (pathname.startsWith(url + "/") && !pathname.startsWith("/pets"))
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Medical</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <SidebarMenuItem key={item.title}>
            <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
              <Link href={item.url}>
                {item.icon}
                <span>{item.title}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
