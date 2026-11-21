import { expect, test } from '@playwright/test'
import { cookies, events, hide, KEY, log, newRun, start, waitFor } from './helpers.ts'

// sdk.consent_pending: with requireConsent, before grant nothing
// is stored or sent.
test('sdk.consent_pending: nothing is sent or stored before grant', async ({ page }) => {
  const run = newRun()
  await start(page, run, { grant: false })
  await page.evaluate(() => {
    window.datacub.track('signup_started', { plan: 'pro' })
    window.datacub.identify('user_42')
    history.pushState({}, '', '/page.html?step=2')
  })
  await page.click('#buy')
  await page.waitForTimeout(300)
  await hide(page)
  await page.waitForTimeout(300)
  expect((await log(page, run)).requests).toBe(0)
  expect(Object.keys(await cookies(page)).filter((k) => k.startsWith('datacub_'))).toEqual([])
  expect(
    await page.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage))),
  ).toEqual([])
})

test('grant starts collection: $consent, then exactly one initial $pageview', async ({ page }) => {
  const run = newRun()
  await start(page, run, { grant: false })
  await page.evaluate(() =>
    window.datacub.consent.grant({ method: 'banner', policyVersion: '2026-10' }),
  )
  const all = await waitFor(page, run, 2)
  expect(all.map((e) => e.event)).toEqual(['$consent', '$pageview'])
  expect(all[0]?.properties).toEqual({
    $state: 'granted',
    $method: 'banner',
    $policy_version: '2026-10',
    $purposes: ['analytics'],
  })
  const c = await cookies(page)
  expect(c.datacub_id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  )
  expect(all.every((e) => e.anon_id === c.datacub_id && e.consent_state === 'granted')).toBe(true)
  // a second grant on the same page changes nothing
  await page.evaluate(() => window.datacub.consent.grant())
  await hide(page)
  await page.waitForTimeout(300)
  expect(
    (await events(page, run)).filter((e) => e.event === '$pageview' || e.event === '$consent'),
  ).toHaveLength(2)
})

// Revoke stops sending and clears storage.
test('revoke clears datacub_ cookies and stops all collection', async ({ page }) => {
  const run = newRun()
  await start(page, run)
  await waitFor(page, run, 2)
  await page.evaluate(() => {
    window.datacub.identify('user_42', { account: 'org_7' })
    window.datacub.consent.revoke()
    window.datacub.track('after_revoke')
    history.pushState({}, '', '/after-revoke')
  })
  await page.click('#buy')
  await page.waitForTimeout(300)
  await hide(page)
  await page.waitForTimeout(300)
  const all = await events(page, run)
  expect(all.some((e) => e.event === 'after_revoke' || e.event === '$click')).toBe(false)
  expect(all.some((e) => (e.context.path as string)?.includes('after-revoke'))).toBe(false)
  // only the opt-out itself stays: no identifier
  expect(await cookies(page)).toEqual({ datacub_optout: '1' })
})

// The default tracks from init, with no grant and no $consent event.
test('default: tracking starts at init as not_required', async ({ page }) => {
  const run = newRun()
  await start(page, run, { grant: false, init: { requireConsent: false } })
  await page.evaluate(() => window.datacub.track('signup_started'))
  const all = await waitFor(page, run, 2)
  expect(all.map((e) => e.event)).toEqual(['$pageview', 'signup_started'])
  const c = await cookies(page)
  expect(all.every((e) => e.anon_id === c.datacub_id && e.consent_state === 'not_required')).toBe(
    true,
  )
})

// A revoke is remembered on the device, so the next page load sends nothing; a grant
// (an explicit choice) starts again.
test('default: a revoke survives a page load, and a grant clears it', async ({ page }) => {
  const run = newRun()
  const init = { grant: false, init: { requireConsent: false } }
  await start(page, run, init)
  await waitFor(page, run, 1, '$pageview')
  await page.evaluate(() => window.datacub.consent.revoke())
  // WebKit writes document.cookie to the cookie store asynchronously: wait for it
  await expect.poll(async () => (await cookies(page)).datacub_optout).toBe('1')
  const before = (await log(page, run)).requests
  await start(page, run, init)
  await page.evaluate(() => window.datacub.track('after_reload'))
  await page.waitForTimeout(400)
  expect((await log(page, run)).requests).toBe(before)
  expect(Object.keys(await cookies(page)).filter((k) => k.startsWith('datacub_'))).toEqual([
    'datacub_optout',
  ])
  await page.evaluate(() => window.datacub.consent.grant())
  const after = await waitFor(page, run, 1, '$consent')
  expect(after.find((e) => e.event === '$consent')?.consent_state).toBe('granted')
  expect((await cookies(page)).datacub_optout).toBeUndefined()
  // and the grant holds on the next page load
  await start(page, run, init)
  expect((await waitFor(page, run, 2, '$pageview')).length).toBeGreaterThan(1)
})

// Global Privacy Control acts as revoke unless a user action overrides it.
test('Global Privacy Control blocks grant unless overridden', async ({ page }) => {
  const run = newRun()
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'globalPrivacyControl', { value: true }),
  )
  await start(page, run, { init: { requireConsent: false } })
  await page.evaluate(() => window.datacub.track('blocked'))
  await page.waitForTimeout(400)
  expect((await log(page, run)).requests).toBe(0)
  await page.evaluate(() => window.datacub.consent.grant({ overrideGPC: true }))
  expect((await waitFor(page, run, 1, '$pageview')).length).toBeGreaterThan(0)
})

// A secret key in a browser is refused outright.
test('a secret key is refused and nothing is sent', async ({ page }) => {
  const run = newRun()
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto('/page.html')
  await page.evaluate((run) => {
    // built at runtime so secret scanners do not mistake the fixture for a real key
    window.datacub.init(['sk', 'live', 'abcdefghijklmnopqrstuvwx'].join('_'), {
      apiHost: `${location.origin}/r/${run}`,
    })
    window.datacub.consent.grant()
    window.datacub.track('leak')
  }, run)
  await page.waitForTimeout(300)
  expect((await log(page, run)).requests).toBe(0)
  expect(errors.join()).toContain('refused a secret key')
})

test('the key and apiHost are validated', async ({ page }) => {
  const run = newRun()
  await page.goto('/page.html')
  await page.evaluate(
    ([key, run]) => {
      window.datacub.init('pk_live_short', { apiHost: `${location.origin}/r/${run}` })
      window.datacub.init(key as string, { apiHost: 'http://evil.example' })
      window.datacub.consent.grant()
    },
    [KEY, run],
  )
  await page.waitForTimeout(300)
  expect((await log(page, run)).requests).toBe(0)
})
