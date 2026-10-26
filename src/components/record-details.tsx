/**
 * Medical record `details` is free-form JSON typed by the owner. Render it as
 * human-readable data — labeled pairs and value lists — never as a raw JSON
 * string. Unknown keys are humanized; values are read back verbatim.
 */

function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

function formatValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const s = String(value)
    return s.trim() === "" ? null : s
  }
  if (Array.isArray(value)) {
    const parts = value.map(formatValue).filter((v): v is string => v !== null)
    return parts.length ? parts.join(", ") : null
  }
  if (typeof value === "object") {
    const parts = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => {
        const fv = formatValue(v)
        return fv === null ? null : `${humanizeKey(k)}: ${fv}`
      })
      .filter((p): p is string => p !== null)
    return parts.length ? parts.join(" · ") : null
  }
  return String(value)
}

/** Field labels worth translating into plain veterinary language. */
const KEY_LABELS: Record<string, string> = {
  lot: "Lot",
  nextDue: "Next due",
  dosage: "Dosage",
  frequency: "Frequency",
  refills: "Refills",
  values: "Results",
  test: "Test",
  unit: "Unit",
  reference: "Reference range",
}

function labelFor(key: string): string {
  return KEY_LABELS[key] ?? humanizeKey(key)
}

interface DetailPair {
  label: string
  value: string
}

function toPairs(obj: Record<string, unknown>): DetailPair[] {
  return Object.entries(obj)
    .map(([k, v]) => {
      // Flat test-value maps read better as "Result · WBC: 7.1 K/µL · …"
      if (k === "values" && v && typeof v === "object" && !Array.isArray(v)) {
        const inner = Object.entries(v as Record<string, unknown>)
          .map(([ik, iv]) => {
            const fv = formatValue(iv)
            return fv === null ? null : `${ik}: ${fv}`
          })
          .filter((p): p is string => p !== null)
        return inner.length
          ? { label: labelFor(k), value: inner.join(" · ") }
          : null
      }
      const fv = formatValue(v)
      return fv === null ? null : { label: labelFor(k), value: fv }
    })
    .filter((p): p is DetailPair => p !== null)
}

function parseDetails(raw: string | null): DetailPair[] | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed.startsWith("{")) return null
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
    const pairs = toPairs(parsed as Record<string, unknown>)
    return pairs.length ? pairs : null
  } catch {
    return null
  }
}

/**
 * Renders details as small labelled rows: `Dosage 16 mg · Frequency once daily`.
 * Falls back to a plain sentence for non-JSON detail strings.
 */
export function RecordDetails({ details }: { details: string | null }) {
  const pairs = parseDetails(details)
  if (!pairs) {
    const fallback = details?.trim()
    if (!fallback) return null
    return (
      <p className="text-muted-foreground text-xs">{fallback}</p>
    )
  }
  return (
    <dl className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
      {pairs.map((p) => (
        <div key={p.label} className="flex items-baseline gap-1.5">
          <dt className="text-muted-foreground">{p.label}</dt>
          <dd className="font-medium tabular-nums">{p.value}</dd>
        </div>
      ))}
    </dl>
  )
}
