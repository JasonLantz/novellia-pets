---
target: the dashboard (src/app/dashboard/page.tsx)
total_score: 16
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
target_identity: "file:/Users/mac/Workspace/projects/novellia-pets/src/app/dashboard/page.tsx"
target_fingerprint: "sha256:6c3aa224dc2ee7ec575cdef0cc1bd1a18e9b5e7275d3671e90ddc31cad295def"
target_path: /Users/mac/Workspace/projects/novellia-pets/src/app/dashboard/page.tsx
timestamp: 2026-10-25T13-59-13Z
slug: src-app-dashboard-page-tsx
---
# Critique — Novellia Pets Dashboard

Method: dual-agent (A: design review · B: detector/browser evidence)

## Heuristics (0–4)

| # | Heuristic | Score | Key Issue |
|---|-----------|:-----:|-----------|
| 1 | Visibility of System Status | 2 | No time-sensitive surfacing (CKD recheck unnoticed); active nav and feedback otherwise fine |
| 2 | Match System / Real World | 2 | "Records" umbrella is DB vocabulary; raw ISO dates on a glance surface |
| 3 | User Control and Freedom | 2 | No actions on dashboard; no undo; permanent deletes behind generic dialog |
| 4 | Consistency and Standards | 2 | Duplicate "Ask Nova (AI)" sidebar entries (different icons/behavior); type names differ across surfaces |
| 5 | Error Prevention | 1 | Unlabeled trash icon deletes pet + all records behind "Are you sure?" |
| 6 | Recognition Rather Than Recall | 2 | Same concept named 3 ways (Lab result / Labs); taxonomy memorization required |
| 7 | Flexibility and Efficiency | 1 | No shortcuts, no sorting, no bulk actions, no quick-add |
| 8 | Aesthetic and Minimalist Design | 2 | Glance card (~40% of fold) is inert; pets table below the fold at 1280×800 |
| 9 | Error Recovery | 2 | Empty states have no CTA; "Delete failed" toast is the whole error story |
| 10 | Help and Documentation | 0 | No tooltips, first-run guidance, or help surface |
| **Total** | | **16/40** | **Poor** |

n/a: none. Applicable max: 40.

## Design Specificity

shadcn dashboard-01 with pet labels pasted on. Stock zinc-grayscale palette; the only chromatic token is destructive-red — the sole meaningful color in a medical product means "danger". Emoji and pet names are the only product-specific artifacts.

Deterministic scan: CLI detect exit 0 (0 findings). Live DOM detect: 4 findings — overused-font (Inter 100%, factual/taste), nested-cards ×3 (false positive; sibling cards verified flat in DOM).

Overlay: injected in [Human] tab; badges shown, then cleaned up.

## Priority Issues

- **P0 Unlabeled delete + nameless destructive confirmation.** DeleteButton called with `label=""` → empty accessible name; dialog says "Are you sure? This cannot be undone." Fix: `confirmName` prop; dialog names pet + record count. → `$impeccable harden`
- **P1 Glance card eats the fold and is inert.** Five badges + two text lines above the fold; pets table (task object) below. Fix: table first full width; counts → inline stat row linking to filtered routes. → `$impeccable layout`
- **P1 Sidebar IA: 12 visible options, duplicate Ask Nova, inconsistent type labels.** Fix: single Ask Nova in My Pets; one canonical name per record type everywhere. → `$impeccable clarify`
- **P2 Dashboard has zero verbs.** Feed rows not links; no per-row add; "View all" drops context. Fix: link rows to /pets/{id}; ghost "Add record" per row. → `$impeccable polish`
- **P2 Accessibility floor.** Measured: 14/14 muted-foreground at ≈4.44:1 (fails small-text AA); card titles are divs (single h1); no nav landmark; emoji announced to SR ("BiscuitRabbit"); mobile table overflows (417>358px) with ISO dates clipped; tap targets 20–32px. Fix: darker muted, nav landmark, aria-hidden emoji, relative dates, taller mobile targets. → `$impeccable adapt` + audit

## Persona Red Flags

- **Alex:** no shortcuts/sorting/bulk; 4-step path to add a record for Luna; "View all" discards pet context.
- **Sam:** empty-name delete triggers; dialog announces nothing; no heading structure; emoji read aloud; muted text fails small-text AA.
- **Jordan:** first visit = empty state with no button; two Ask Nova links; can't map vaccine card → "Document" or bloodwork → "Lab result".

## Minor Observations

- "Not veterinary advice" only on /ask though dashboard shows lab values.
- ageLabel fixed 365/30-day math drifts.
- Dead code: site-header default title, ArrowUpRightRightIcon wrapper.
- Pets table shows record count without types (types live on another card).
- 100% Inter; display face would add character cheaply.
- No mobile nav for Medical section beyond off-canvas drawer.
- "N" stray in screenshots = harness artifact, not app DOM.

## Questions to Consider

1. Miso has CKD — why is the dashboard's most prominent content a count of nail trims?
2. Can a user reach "add a vaccination for Biscuit" in two clicks without the sidebar? Should every card own a verb?
3. The only non-gray color means "destructive." What breaks if record types get stable semantic color?
