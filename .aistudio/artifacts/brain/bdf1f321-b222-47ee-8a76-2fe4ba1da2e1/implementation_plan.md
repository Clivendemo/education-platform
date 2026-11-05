# PROMPT 39D — ELIMUPIN PHASE 2 FINAL NEXT.JS ROUTE ARCHITECTURE & TEST-COUNT RECONCILIATION

**Project:** ElimuPin  
**Repository:** `Clivendemo/education-platform`  
**Phase:** Phase 2 — Public Homepage & Navigation Architecture  
**Mode:** PLAN ONLY — NO IMPLEMENTATION — ZERO CODE MODIFICATIONS  
**Governance:** PLAN → HUMAN APPROVAL → IMPLEMENT → TEST → REPORT → STOP  
**Timestamp:** 2026-11-05  

---

## 1. RECONCILIATION OBJECTIVE & GOVERNANCE

This document establishes the definitive, final technical reconciliation (**Prompt 39D**) for the ElimuPin Phase 2 Public Homepage and Navigation Architecture. It directly resolves the 5 specific architectural and consistency points raised in the Prompt 39C review:

1. **Framework-Safe Next.js Route Architecture:** Solves the build-breaking custom-prop issue on `page.tsx` by introducing a dedicated, reusable server component (`web/src/components/homepage/kenya-homepage.tsx`). Both `/` (`web/src/app/page.tsx`) and `/ke` (`web/src/app/[country]/page.tsx`) import and render this reusable component without custom page-prop pollution or duplicate data fetching.
2. **Updated 47-File Inventory Arithmetic:** Reflects the addition of `kenya-homepage.tsx`:
   - **36 Reused Unchanged Baseline Files**
   - **4 Modified Baseline Files**
   - **7 New Authored Files**
   - **Total:** **Exactly 47 Files**
3. **Aligned 9-Area Test Specification:** Aligns the heading and item count in Section 6.2 and Section 7 to exactly 9 Phase 2 test specifications in `web/src/__tests__/homepage-contracts.test.tsx`.
4. **Authentic Dynamic Resource Version Display:** Mandates rendering the actual `publishedVersion.versionLabel` string provided by the backend (never hardcoding `"v1.0"`).
5. **Truthful Update Category Presentation:** Removes the unverified `"Official Circular"` label from update cards; renders the verified category (`item.category.name`) when present or a neutral update label (`"Education Update"`).
6. **Accurate Root Test Scope Definition:** Documents that `npm test` in `/app/applet` executes the full root backend suite across all `tests/**/*.test.ts` (excluding `web/**`), rather than misrepresenting it as running only 12 tests.
7. **Genuine HTTP 404 Status Verification:** Enforces that unsupported country routes are tested for the genuine `notFound()` signal and HTTP 404 status code, not merely for visual 404 text on a 200 OK page.

---

## 2. COMPLETE BASELINE RECONCILIATION & REVISED 47-FILE INVENTORY

### 2.1 Complete Phase 1 Baseline Inventory (Exactly 40 Files)
Forensic directory inspection confirms that the Phase 1 repository contains exactly **40 tracked files** (1 in the repository root and 39 under `/web`). Every file is listed below with its current responsibility and Phase 2 classification:

| # | Exact File Path | Category | Phase 1 Baseline Responsibility | Phase 2 Classification |
| :-: | :--- | :--- | :--- | :--- |
| 1 | `vitest.config.ts` | Root Config | Configures root Vitest suite; excludes `web/**` from backend tests | **Reused Unchanged** |
| 2 | `web/.env.example` | Web Config | Documents client/server environment variables (`FASTIFY_INTERNAL_URL`, etc.) | **Reused Unchanged** |
| 3 | `web/.gitignore` | Web Config | Ignores `.next/`, `node_modules/`, and local test coverage artifacts | **Reused Unchanged** |
| 4 | `web/next.config.ts` | Web Config | Configures Next.js security headers, image locks, and `/api/v1/*` proxy rewrites | **Reused Unchanged** |
| 5 | `web/next-env.d.ts` | Web Config | Next.js TypeScript declaration file | **Reused Unchanged** |
| 6 | `web/package.json` | Web Config | Web package manifest with scripts (`dev`, `build`, `typecheck`, `test`) and dependencies | **Reused Unchanged** |
| 7 | `web/package-lock.json` | Web Config | Deterministic npm dependency lockfile (0 audit vulnerabilities) | **Reused Unchanged** |
| 8 | `web/postcss.config.mjs` | Web Config | PostCSS configuration for Tailwind CSS v4 | **Reused Unchanged** |
| 9 | `web/tsconfig.json` | Web Config | TypeScript configuration with `@/*` path alias mapping to `./src/*` | **Reused Unchanged** |
| 10 | `web/vitest.config.ts` | Web Config | Vitest configuration for `/web` test suites in JSDOM environment | **Reused Unchanged** |
| 11 | `web/src/styles/tokens.css` | Styles | 32 CSS custom properties for typography, color, spacing, and placeholder patterns | **Reused Unchanged** |
| 12 | `web/src/app/globals.css` | App Shell | Imports Tailwind CSS (`@import "tailwindcss";`) and custom token variables | **Reused Unchanged** |
| 13 | `web/src/app/layout.tsx` | App Shell | Root HTML layout wrapping children in `AppProviders` and `AppShell` | **Reused Unchanged** |
| 14 | `web/src/app/error.tsx` | App Shell | Client error boundary for unexpected rendering errors | **Reused Unchanged** |
| 15 | `web/src/app/not-found.tsx` | App Shell | Accessible Kenyan education 404 recovery page | **Reused Unchanged** |
| 16 | `web/src/app/page.tsx` | Page Route | Phase 1 foundation demo & test integration readiness banner | **Modified** |
| 17 | `web/src/components/brand/elimupin-logo.tsx` | Brand | Accessible Kenyan education brand mark vector icon and wordmark | **Reused Unchanged** |
| 18 | `web/src/components/layout/app-shell.tsx` | Layout | Accessible shell with skip-to-content anchor, header, main landmark, and footer | **Reused Unchanged** |
| 19 | `web/src/components/layout/site-header.tsx` | Layout | Sticky 3-zone header with brand mark, primary nav, theme toggle, and drawer | **Modified** |
| 20 | `web/src/components/layout/site-footer.tsx` | Layout | Global footer with curriculum statement, Kenya baseline notice, and policies | **Modified** |
| 21 | `web/src/components/ui/button.tsx` | UI Primitive | Touch-friendly interactive button (`min-h-11`/`min-h-12`) with primary/secondary/ghost | **Reused Unchanged** |
| 22 | `web/src/components/ui/empty-state.tsx` | UI Primitive | Dashed container with title, description, optional icon, and action slot | **Reused Unchanged** |
| 23 | `web/src/components/ui/input-field.tsx` | UI Primitive | Form input with accessible label, error message, helper text, and ARIA wiring | **Reused Unchanged** |
| 24 | `web/src/components/ui/skeleton.tsx` | UI Primitive | Loading placeholder box with `role="status"`, `aria-label`, and `animate-pulse` | **Reused Unchanged** |
| 25 | `web/src/components/ui/status-notice.tsx` | UI Primitive | Semantic alert banner with tones (`ok`, `info`, `warn`, `error`) and status icons | **Reused Unchanged** |
| 26 | `web/src/components/ui/surface-card.tsx` | UI Primitive | Container card supporting `div`, `section`, `article` and 4 padding levels | **Reused Unchanged** |
| 27 | `web/src/components/ui/visual-placeholder.tsx` | UI Primitive | Aspect-ratio locked primitive (16:9, 4:3, 3:4, 1:1) with WCAG alt-text & UGC firewall | **Reused Unchanged** |
| 28 | `web/src/config/public-env.ts` | Config | Validated client environment variables (`NEXT_PUBLIC_APP_NAME`, etc.) | **Reused Unchanged** |
| 29 | `web/src/config/server-env.ts` | Config | Server-only environment variables (`FASTIFY_INTERNAL_URL`) with bundle canary | **Reused Unchanged** |
| 30 | `web/src/lib/api/browser-client.ts` | API Lib | Browser client with CSRF auto-retry, transition barrier, and idempotency headers | **Reused Unchanged** |
| 31 | `web/src/lib/api/csrf-manager.ts` | API Lib | Single-flight CSRF manager with 9-route transition barrier and BroadcastChannel sync | **Reused Unchanged** |
| 32 | `web/src/lib/api/idempotency.ts` | API Lib | Idempotency key builders (analytics body-only vs. commerce header-synchronized) | **Reused Unchanged** |
| 33 | `web/src/lib/api/server-client.ts` | API Lib | Server-only Fastify fetcher returning plain serializable DTOs (`cache: 'no-store'`) | **Reused Unchanged** |
| 34 | `web/src/lib/api/types.ts` | API Lib | Shared API success/error envelopes, error classes, and DTO contracts | **Modified** |
| 35 | `web/src/providers/app-providers.tsx` | Providers | Root provider composer (ThemeProvider + SessionCsrfProvider) | **Reused Unchanged** |
| 36 | `web/src/providers/session-csrf-provider.tsx` | Providers | React context for CSRF token availability and epoch rotation | **Reused Unchanged** |
| 37 | `web/src/providers/theme-provider.tsx` | Providers | Light/dark theme provider with localStorage persistence and system sync | **Reused Unchanged** |
| 38 | `web/src/__tests__/setup.ts` | Test Suite | Vitest global test setup (DOM matchers, BroadcastChannel mock, matchMedia mock) | **Reused Unchanged** |
| 39 | `web/src/__tests__/foundation-contracts.test.ts` | Test Suite | 13 Phase 1 foundation contract tests (security prohibitions, CSRF barrier, UI rules) | **Reused Unchanged** |
| 40 | `web/src/__tests__/proxy-integration.test.ts` | Test Suite | 1 Phase 1 live proxy rewrite integration and process teardown test | **Reused Unchanged** |

*(Note: `web/tsconfig.tsbuildinfo` is a transient compiler cache generated by `tsc` and is excluded from the tracked baseline inventory.)*

---

### 2.2 Reconciled File Inventory Summary & Exact Arithmetic
- **Baseline Files:** 40
- **Modified Baseline Files (4 files):**
  1. `web/src/app/page.tsx` — Standard Next.js page route for `/`. Imports and renders `<KenyaHomepage />`.
  2. `web/src/components/layout/site-header.tsx` — Updated navigation anchor targets (`#search`, `#pillars`, `#trending`, `#updates`, `#calendar`).
  3. `web/src/components/layout/site-footer.tsx` — Enhanced with authentic Kenyan educational quick links (CBC, KCSE, Academic Calendar).
  4. `web/src/lib/api/types.ts` — Extended with verified Phase 2 DTOs (`HomepageResourceCardDto`, `HomepageUpdateCardDto`, `HomepageCalendarHighlightCardDto`, `CurriculumShortcutCardDto`, `HomepageSectionDto`, `PublicHomepagePayload`, `ResourceTypeResult`, `AutocompleteSuggestion`).
- **Reused Unchanged Files (36 files):**
  Exactly 40 baseline files minus 4 modified files = **36 reused unchanged files** (1 in repository root + 35 under `/web`).
- **Removed Files (0 files):** Zero files removed.
- **New Authored Files (7 files):**
  1. `web/src/components/homepage/kenya-homepage.tsx` — Reusable Server Component owning Kenya public homepage data fetching (`fetchPublicHomepage('ke')`, `fetchActiveResourceTypes()`), degraded state handling, and layout composition.
  2. `web/src/app/[country]/page.tsx` — Dynamic route handler normalizing `country.toLowerCase()`; renders `<KenyaHomepage />` for `'ke'`; invokes `notFound()` for all others.
  3. `web/src/components/homepage/hero-section.tsx` — Search-first hero section housing `AutocompleteSearch` and 16:9 vector placeholder.
  4. `web/src/components/homepage/autocomplete-search.tsx` — Client search combobox with 250ms debounce, 2-char guard, max 5 suggestions, ARIA combobox/listbox attributes, and keyboard navigation.
  5. `web/src/components/homepage/pillar-grid.tsx` — Grid rendering the 8 canonical MVP pillars from `RESOURCE_PILLARS` with active child type grouping and honest empty-state handling.
  6. `web/src/components/homepage/slot-section-renderer.tsx` — Dynamic renderer iterating through the 6 backend slots, rendering non-clickable presentation cards (`ResourceCard`, `UpdateCard`, `CalendarCard`, `CurriculumShortcutCard`).
  7. `web/src/__tests__/homepage-contracts.test.tsx` — Dedicated Phase 2 test suite covering DTOs, slots, pillars, autocomplete, genuine 404 routing, and degraded state.
- **Total Phase 2 Files:** 36 (reused) + 4 (modified) + 7 (new) = **exactly 47 files**.
  The arithmetic is complete, verified, and mathematically consistent.

---

## 3. FRAMEWORK-SAFE NEXT.JS ROUTE ARCHITECTURE

### 3.1 Separation of Page Route Handlers from Homepage View Component
In Next.js App Router, `page.tsx` default exports must strictly adhere to framework-defined page component signatures (`{ params, searchParams }`). Treating `page.tsx` as a general-purpose component and passing custom props such as `<HomePage countryCode="ke" />` can fail TypeScript typegen (`next typegen`) or break Next.js production builds.

To guarantee complete framework compatibility, Phase 2 decouples route handling from UI presentation:

```
┌─────────────────────────────────────────┐   ┌─────────────────────────────────────────┐
│ Route Handler: /                        │   │ Route Handler: /[country]               │
│ web/src/app/page.tsx                    │   │ web/src/app/[country]/page.tsx          │
│ (Standard Next.js Page without custom   │   │ - Validates country.toLowerCase()       │
│  props; delegates to KenyaHomepage)     │   │ - Invokes notFound() if !== 'ke'        │
│                                         │   │ - Delegates to KenyaHomepage if === 'ke'│
└────────────────────┬────────────────────┘   └────────────────────┬────────────────────┘
                     │                                             │
                     └──────────────────────┬──────────────────────┘
                                            ▼
               ┌────────────────────────────────────────────────────────┐
               │ Reusable Server Component                              │
               │ web/src/components/homepage/kenya-homepage.tsx         │
               │ - Owns server-side Fastify fetch (country: 'ke')       │
               │ - Fetches active resource types for pillar grouping    │
               │ - Handles degraded states gracefully without mocks     │
               │ - Composes Hero, Pillars, and 6 Canonical Slots        │
               └────────────────────────────────────────────────────────┘
```

### 3.2 Code Contracts for Route Files
```typescript
// web/src/app/page.tsx
import { KenyaHomepage } from '@/components/homepage/kenya-homepage';

export default async function RootPage() {
  return <KenyaHomepage />;
}
```

```typescript
// web/src/app/[country]/page.tsx
import { notFound } from 'next/navigation';
import { KenyaHomepage } from '@/components/homepage/kenya-homepage';

interface CountryPageProps {
  params: Promise<{ country: string }>;
}

export default async function CountryPage({ params }: CountryPageProps) {
  const { country } = await params;
  const normalized = country.toLowerCase().trim();

  // Kenya is the sole operational MVP country
  if (normalized !== 'ke') {
    notFound();
  }

  return <KenyaHomepage />;
}
```

Both routes render the exact same server-side view with zero duplicated code, zero prop violations, and zero conflicting data fetches.

---

## 4. CANONICAL PILLARS & EMPTY PILLAR STATE CONTRACT

### 4.1 Eight Canonical Content Pillars
The platform strictly maintains the 8 canonical MVP content pillars defined in `src/db/schema/resource.ts` (`RESOURCE_PILLARS`):
1. `PAST_PAPERS` ("Past Papers & Marking Schemes")
2. `LESSON_PLANS` ("Lesson Plans")
3. `SCHEMES_OF_WORK` ("Schemes of Work")
4. `NOTES_REVISION` ("Revision Notes & Study Guides")
5. `SCHOOL_DOCUMENTS` ("School Documents & Forms")
6. `ACADEMIC_CALENDAR` ("Academic Calendar & Events")
7. `EDUCATION_UPDATES` ("Education Updates & Circulars")
8. `TEACHER_RESOURCES` ("Teacher Training & Professional Resources")

### 4.2 Cardinality & Grouping Rule
- `GET /api/v1/resource-types?includeInactive=false` returns active child resource types (`ResourceTypeResult[]`).
- The frontend groups incoming active types by `item.pillar`.
- The homepage always displays **exactly 8 pillar cards** in canonical sequence (1 to 8).

### 4.3 Rule for Pillars with No Active Resource Types
If the backend returns zero active resource types for a canonical pillar:
1. **Permanent Presence:** The pillar card **remains visible** to preserve the national curriculum structure.
2. **Honest Copy:** The card displays the pillar title and pedagogical description alongside a prominent, neutral status badge:
   > *"Curriculum materials in preparation"*
3. **No Synthetic Data:** The card renders zero child type badges and **zero fabricated counts**.
4. **Availability Protection:** The UI makes no claim that documents are published or available when the backend provides no evidence of availability.

---

## 5. HOMEPAGE CARD INTERACTION & DEFERRED DESTINATIONS

In accordance with Phase 2 governance, full catalogue search results (`/search`), resource streaming/downloads (`/resources/[id]`), full circular text (`/updates/[slug]`), and interactive calendars (`/calendar`) remain strictly deferred to Phase 3.

To guarantee that users never encounter broken links, dead ends, or misleading interaction cues, all cards in Phase 2 are implemented as **genuinely non-clickable presentation surfaces**:

### Card Interaction Specification
| Entity Type | Homepage Slot | Container Component | Clickable State | Interactive Controls | Displayed Information & Status Badge |
| :--- | :--- | :--- | :---: | :--- | :--- |
| `RESOURCE` | Slots 1, 2, 3 | `<SurfaceCard as="article">` | **NON-CLICKABLE** | Zero `href`, zero `<a>`, zero pointer cursor, zero buttons | Title, subject, grade, curriculum, actual dynamic version label (`item.publishedVersion.versionLabel`), quality badge (`VERIFIED` / `PREMIUM`), and subtle neutral badge: *"Catalogue details in Phase 3"* |
| `UPDATE` | Slot 4 | `<SurfaceCard as="article">` | **NON-CLICKABLE** | Zero `href`, zero `<a>`, zero pointer cursor, zero buttons | Title, summary, publication date (`d MMM yyyy`), verified category badge (`item.category.name`) when present or neutral badge: *"Education Update"* |
| `CALENDAR_EVENT` | Slot 5 | `<SurfaceCard as="article">` | **NON-CLICKABLE** | Zero `href`, zero `<a>`, zero pointer cursor, zero buttons | Event title, date, start/end times, location, event type badge, and academic year |
| `SUBJECT` | Slot 6 | `<SurfaceCard as="article">` | **NON-CLICKABLE** | Zero `href`, zero `<a>`, zero pointer cursor, zero buttons | Subject name, grade, education level, curriculum badge, and verified lateral `publishedResourceCount` |
| `RESOURCE_PILLAR` | Pillar Grid | `<SurfaceCard as="article">` | **NON-CLICKABLE** | Zero `href`, zero `<a>`, zero pointer cursor | Canonical title, pillar description, child type badges, or *"Curriculum materials in preparation"* badge |

### Search Form & Autocomplete Interaction
- **Autocomplete Suggestions:** Clicking or pressing Enter on a suggestion populates the search input text and closes the suggestion listbox. It does **not** trigger navigation to an unbuilt `/search` route.
- **Search Form Submission:** Submitting the search form does not navigate to `/search?q=...`. Instead, it displays an accessible, inline status notice directly under the input:
  > *"Catalogue search activation is scheduled for Phase 3. Live autocomplete suggestions are active above."*

---

## 6. COMPLETE TWO-TIER TESTING PLAN & ACCEPTANCE MATRIX

### 6.1 Existing Phase 1 Test Inventory (14 Tests Across 2 Suites)
The existing Phase 1 test suite located in `web/src/__tests__/` contains 14 tests that must remain 100% green:

#### Suite 1: `web/src/__tests__/foundation-contracts.test.ts` (13 Tests)
1. `AC-02: Security Advisory Architectural Prohibitions` — Verifies zero `'use server'` directives, zero `after()` calls, zero Edge runtime exports, zero `middleware.ts`/`proxy.ts` files, and zero `app/**/route.ts` Route Handlers.
2. `AC-03: Server-Only Isolation` — Verifies `import 'server-only'` on server modules and ensures client imports are rejected.
3. `AC-03: Bundle Canary Protection` — Verifies zero leakage of internal URLs or credentials into client bundles.
4. `AC-04: Analytics Body-Only Idempotency Contract` — Verifies UUID v4 idempotency key placed strictly in body and stripped from HTTP headers.
5. `AC-05: Commerce Synchronized Idempotency Contract` — Verifies identical UUID v4 in header and body, and 409 non-retry behavior.
6. `AC-07: 9-Route CSRF Transition Barrier` — Verifies accurate tracking of all 9 session-mutating backend routes.
7. `AC-07: Concurrent Request Serialization` — Verifies serialization of unsafe requests during in-flight session transitions.
8. `AC-08: BroadcastChannel Sync & Rotation Retry` — Verifies single retry on 403 CSRF mismatch and PII-free rotation broadcasts on `elimupin-csrf`.
9. `AC-10: Accessibility & Layout Shell` — Verifies skip-to-content anchor, 3-zone header, `>=44px` touch targets, and theme toggle.
10. `AC-10: Design Constitution Rule Compliance` — Verifies zero thick left borders (`border-l-*`) and zero static pill tags (`rounded-full`).
11. `AC-11: Next.js 16.4.5 Image Security Locks` — Verifies image security configuration (remote patterns locked, SVG execution blocked).
12. `AC-12: Zero Raster Images in Phase 1` — Verifies zero raster images anywhere in `/web`.
13. `AC-12: Informative vs. Decorative Alt-Text & UGC Firewall` — Verifies alt-text rules and blocks unmoderated uploads in curated slots.

#### Suite 2: `web/src/__tests__/proxy-integration.test.ts` (1 Test)
14. `AC-06: Live Next.js /api/v1 Rewrite Proxy Integration` — Verifies security headers and live `/api/v1/*` proxy forwarding with clean process teardown.

---

### 6.2 New Phase 2 Test Specifications (`web/src/__tests__/homepage-contracts.test.tsx` — Exactly 9 Specifications)
A new test suite covering the 9 Phase 2 functional and architectural requirements:

1. **DTO Fidelity & Dynamic Field Mapping:**
   - Verifies that `ResourceCard` correctly maps and displays `title`, `slug`, `qualityLabel`, `quality.effectiveTier`, `resourceType`, `curriculum`, `grade`, `subject`, and the dynamic `item.publishedVersion.versionLabel` (verifying it is not hardcoded to "v1.0").
   - Verifies that `UpdateCard` displays `title`, `summary`, formatted date (`d MMM yyyy`), and `category.name` (or `"Education Update"` when category is null, verifying zero unverified "Official Circular" claims).
   - Verifies that `CalendarCard` displays `title`, `startDate`, start/end times, location, and `eventType.name`.
   - Verifies that `CurriculumShortcutCard` displays `name`, `grade.name`, and verified `publishedResourceCount`.
2. **Canonical 6 Slots in Strict Numerical Order:**
   - Verifies that all 6 slots are rendered in exact numerical order (`1..6`) matching backend keys (`trending_resources`, `most_downloaded_resources`, `curated_resources`, `education_updates`, `calendar_highlights`, `curriculum_shortcuts`).
3. **Empty Slot Resilience:**
   - Verifies that when a slot returns `count: 0` and `items: []`, the section renders a graceful, quiet empty container without crashing or shifting adjacent sections.
4. **Canonical 8 Pillars & Empty Pillar State:**
   - Verifies that exactly 8 canonical pillar cards are rendered matching `RESOURCE_PILLARS`.
   - Verifies that active resource types are grouped under `pillar`.
   - Verifies that an empty pillar displays the honest notice *"Curriculum materials in preparation"* with zero child type badges and zero fake counts.
5. **Autocomplete Combobox Behavior:**
   - Verifies 250ms debounce before request dispatch.
   - Verifies short-circuiting to empty array when query is `< 2` trimmed characters.
   - Verifies `AbortController` cancellation of previous in-flight requests on rapid typing.
   - Verifies maximum 5 suggestions rendered.
   - Verifies keyboard accessibility: ArrowDown moves focus down listbox, ArrowUp moves up, Escape dismisses, Enter selects.
6. **Non-Clickable Presentation Enforcement:**
   - Inspects rendered DOM of all card types and verifies:
     - `a` tags are absent or do not point to unbuilt routes.
     - `href` attributes pointing to `/search`, `/resources/*`, `/updates/*`, or `/calendar` are zero.
     - Cards do not carry `cursor-pointer` classes.
7. **Country Routing & Genuine HTTP 404 Status Verification:**
   - Verifies that `/` defaults to Kenya.
   - Verifies that `/ke` renders Kenya data.
   - Verifies that any non-`ke` country code (e.g., `/ug`, `/tz`, `/us`) invokes Next.js `notFound()`, explicitly throwing the internal framework signal and verifying an actual HTTP 404 response rather than merely checking rendered text on a 200 OK page.
8. **Degraded State & Backend Downtime:**
   - Verifies that when backend returns 500 or 503, the page renders a neutral notification (*"Educational resources and updates are temporarily unavailable. Search and navigation remain active..."*) without claiming preview mode or showing mock data.
9. **Preservation of Root Boundary:**
   - Verifies that root `vitest.config.ts` continues to exclude `web/**` so backend tests run in total isolation.

---

### 6.3 Exact Execution Commands & Comprehensive Scope
| Scope | Working Directory | Command | Full Execution Scope |
| :--- | :--- | :--- | :--- |
| **Frontend Typecheck** | `/app/applet/web` | `npm run typecheck` | Validates Next.js type generation and strict TypeScript (`next typegen && tsc --noEmit`) |
| **Frontend Production Build** | `/app/applet/web` | `npm run build` | Produces production Next.js App Router build (`next build`) |
| **Frontend Vitest Tests** | `/app/applet/web` | `npm test` | Runs all frontend tests (14 Phase 1 + 9 Phase 2 specs) in JSDOM environment (`vitest run`) |
| **Root Backend Tests** | `/app/applet` | `npm test` | Runs the full root backend Vitest suite across all `tests/**/*.test.ts` (excluding `web/**`, `node_modules/**`, `dist/**`) with `--fileParallelism=false --maxWorkers=1` |
| **Root Backend Typecheck** | `/app/applet` | `npm run typecheck` | Validates complete root TypeScript compilation (`tsc --noEmit`) |

---

## 7. RESOLVED ISSUES & AUTHENTICITY AUDIT TRAIL

| Issue Identified in Review | Resolution in Prompt 39D |
| :--- | :--- |
| **1. Page.tsx Custom Prop Reuse** | Resolved by creating reusable Server Component `web/src/components/homepage/kenya-homepage.tsx`. Routes `/` and `/[country]` import and render this component without passing arbitrary props to Next.js page handlers. |
| **2. Inventory Arithmetic Update** | Added `kenya-homepage.tsx`, updating new files from 6 to 7. Inventory arithmetic is verified: 36 reused + 4 modified + 7 new = **exactly 47 total files**. |
| **3. Test Specification Count** | Harmonized Section 6.2 and Section 7 to exactly 9 Phase 2 test specifications in `web/src/__tests__/homepage-contracts.test.tsx`. |
| **4. Dynamic Resource Version** | Clarified that cards render dynamic `item.publishedVersion.versionLabel` from the backend, strictly prohibiting hardcoding `"v1.0"`. |
| **5. Update Card Badge Truthfulness** | Removed unverified `"Official Circular"` label; renders verified category (`item.category.name`) when present or neutral `"Education Update"` badge. |
| **6. Full Root Test Scope** | Accurately documented that root `npm test` executes the complete backend suite across all `tests/**/*.test.ts`, rather than misrepresenting it as only 12 tests. |
| **7. Genuine HTTP 404 Status** | Mandated explicit testing of the `notFound()` signal and genuine HTTP 404 status code for unsupported country routes. |

---

## 8. FINAL GOVERNANCE GATE & CONFIRMATION

- **Zero Implementation Executed:** No repository files have been created, modified, or deleted during this planning turn. Zero packages installed; zero backend schemas or migrations altered; zero builds or tests run.
- **Settled Architecture:** All Next.js route patterns, slot definitions, DTO schemas, and file inventories are 100% reconciled and framework-compliant.
- **Recommendation:** **READY FOR HUMAN APPROVAL**.

*STOP: Awaiting explicit human authorization before commencing Phase 2 implementation.*
