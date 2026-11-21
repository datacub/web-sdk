import { expect, type Page } from '@playwright/test'

export const KEY = 'pk_test_abcdefghijklmnopqrstuvwx'
export type Event = Record<string, unknown> & {
  uuid: string
  event: string
  ts: string
  anon_id: string
  user_id: string | null
  session_id: string
  page_id: string | null
  seq: number
  context: Record<string, unknown>
  properties: Record<string, unknown>
}

declare global {
  interface Window {
    datacub: import('../../src/index.ts').DatacubClient
  }
}

// One isolated ingestion endpoint per test.
export function newRun() {
  return crypto.randomUUID()
}

// Every batch any test captures is checked against the shared envelope contract.
export async function log(page: Page, run: string) {
  const res = await page.request.get(`/r/${run}/log`)
  const l = (await res.json()) as { batches: { events: Event[]; body: string }[]; requests: number }
  return l
}

export async function events(page: Page, run: string) {
  return (await log(page, run)).batches.flatMap((b) => b.events)
}

export async function plan(
  page: Page,
  run: string,
  steps: { status: number; retryAfter?: number; delay?: number; body?: string }[],
) {
  await page.request.post(`/r/${run}/plan`, { data: steps })
}

// Loads the fixture, starts the SDK against this run's endpoint and, unless told not to, grants consent.
// It starts in requireConsent mode, so a test sees exactly what its grant does; pass
// init: { requireConsent: false } for the default, which tracks from init.
export async function start(
  page: Page,
  run: string,
  o: { path?: string; grant?: boolean; init?: Record<string, unknown> } = {},
) {
  await page.goto(o.path ?? '/page.html')
  await page.evaluate(
    ([key, run, init, grant]) => {
      window.datacub.init(key as string, {
        apiHost: `${location.origin}/r/${run}`,
        requireConsent: true,
        ...(init as object),
      })
      if (grant) window.datacub.consent.grant()
    },
    [KEY, run, o.init ?? {}, o.grant !== false] as const,
  )
}

// Hides the page so the SDK flushes through sendBeacon, as a real tab switch or close would.
export async function hide(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

export async function show(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

export async function waitFor(page: Page, run: string, count: number, name?: string) {
  await expect
    .poll(async () => (await events(page, run)).filter((e) => !name || e.event === name).length, {
      timeout: 10_000,
    })
    .toBeGreaterThanOrEqual(count)
  return events(page, run)
}

// Identity cookies end with eight characters of the key (FD-65); read here under their base names.
export const SUFFIX = `_${KEY.slice(8, 16)}`
export async function cookies(page: Page) {
  return Object.fromEntries(
    (await page.context().cookies()).map((c) => [
      c.name.endsWith(SUFFIX) ? c.name.slice(0, -SUFFIX.length) : c.name,
      c.value,
    ]),
  )
}
