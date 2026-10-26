import Link from "next/link"
import {
  ClipboardListIcon,
  FileTextIcon,
  FlaskConicalIcon,
  HeartPulseIcon,
  LayoutDashboardIcon,
  PawPrintIcon,
  PillIcon,
  SparklesIcon,
} from "lucide-react"

import { NavDocuments } from "@/components/nav-documents"
import { NavMain } from "@/components/nav-main"
import { NavPets } from "@/components/nav-pets"
import { NavSecondary } from "@/components/nav-secondary"
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { listPets } from "@/db/queries"

export async function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pets = await listPets()

  const navMain = [
    { title: "Dashboard", url: "/dashboard", icon: <LayoutDashboardIcon /> },
    { title: "Pets", url: "/pets", icon: <PawPrintIcon /> },
    { title: "All Records", url: "/records", icon: <ClipboardListIcon /> },
  ]

  const medical = [
    { title: "Documents", url: "/documents", icon: <FileTextIcon /> },
    { title: "Labs", url: "/labs", icon: <FlaskConicalIcon /> },
    { title: "Prescriptions", url: "/prescriptions", icon: <PillIcon /> },
    { title: "Visits", url: "/visits", icon: <HeartPulseIcon /> },
  ]

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="data-[slot=sidebar-menu-button]:p-1.5!">
              <Link href="/dashboard">
                <HeartPulseIcon className="size-5!" />
                <span className="text-base font-semibold">Novellia Pets</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
        <NavPets
          pets={pets.map((p) => ({ name: p.name, url: `/pets/${p.id}`, emoji: p.emoji }))}
          askUrl="/ask"
        />
        <NavDocuments items={medical} />
        <NavSecondary
          items={[
            {
              title: "Ask Nova (AI)",
              url: "/ask",
              icon: <SparklesIcon />,
            },
          ]}
          className="mt-auto"
        />
      </SidebarContent>
    </Sidebar>
  )
}
