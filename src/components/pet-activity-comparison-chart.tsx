"use client"

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"

export type PetActivityDatum = { pet: string } & Record<string, number>

export const PET_ACTIVITY_TYPES = [
  { key: "visit", label: "Visits" },
  { key: "vaccination", label: "Vaccinations" },
  { key: "lab", label: "Labs" },
  { key: "prescription", label: "Prescriptions" },
  { key: "document", label: "Documents" },
] as const

const chartConfig = Object.fromEntries(
  PET_ACTIVITY_TYPES.map((t, i) => [t.key, { label: t.label, color: `var(--chart-${i + 1})` }]),
) satisfies ChartConfig

/**
 * Stacked bars: one bar per pet, segmented by record type — whose medical
 * history is the fullest, and what kind of care it consists of.
 */
export function PetActivityComparisonChart({ data }: { data: PetActivityDatum[] }) {
  const rows = data
    .filter((row) => PET_ACTIVITY_TYPES.some((t) => (row[t.key] ?? 0) > 0))
    .sort(
      (a, b) =>
        PET_ACTIVITY_TYPES.reduce((acc, t) => acc + (b[t.key] ?? 0), 0) -
        PET_ACTIVITY_TYPES.reduce((acc, t) => acc + (a[t.key] ?? 0), 0),
    )

  return (
    <div>
      <ChartContainer config={chartConfig} className="h-[240px] w-full">
        <BarChart accessibilityLayer data={rows} margin={{ top: 4, right: 4 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="pet" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis allowDecimals={false} width={28} tickLine={false} axisLine={false} />
          <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
          {PET_ACTIVITY_TYPES.map((t) => (
            <Bar
              key={t.key}
              dataKey={t.key}
              stackId="activity"
              fill={`var(--color-${t.key})`}
              radius={2}
            />
          ))}
        </BarChart>
      </ChartContainer>
      <ul className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs">
        {PET_ACTIVITY_TYPES.map((t, i) => (
          <li key={t.key} className="flex items-center gap-1.5">
            <span
              className="size-2 shrink-0 rounded-[2px]"
              style={{ backgroundColor: `var(--chart-${i + 1})` }}
              aria-hidden
            />
            <span className="text-muted-foreground">{t.label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
