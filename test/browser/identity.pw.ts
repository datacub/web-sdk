import { expect, type Page, test } from '@playwright/test'
import { cookies, events, hide, newRun, plan, show, start, waitFor } from './helpers.ts'

async function flush(page: Page) {
  await hide(page)
  await show(page)
}

const sorted = async (page: Page, run: string) =>
  (await events(page, run)).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts) || a.seq - b.seq)

test.describe('anonymous identity', () => {
  test('rotate_anon_id from capture: a deleted browser starts a new anon_id', async ({ page }) => {
    const run = newRun()
    await start(page, run)
    const first = (await waitFor(page, run, 1, '$pageview'))[0]
    await plan(page, run, [{ status: 200, body: '{"accepted":0,"directives":["rotate_anon_id"]}' }])
    await page.evaluate(() => window.datacub.track('deleted_side'))
    await waitFor(page, run, 1, 'deleted_side')
    await page.evaluate(() => window.datacub.track('fresh'))
    const fresh = (await waitFor(page, run, 1, 'fresh')).find((e) => e.event === 'fresh')
    expect(fresh?.anon_id).toBeTruthy()
    expect(fresh?.anon_id).not.toBe(first?.anon_id)
    expect((await cookies(page)).datacub_id).toBe(fresh?.anon_id)
  })

  test('anon_id is stable across reloads and tabs, and is never restored after cookies are cleared', async ({
    page,
    context,
  }) => {
    const run = newRun()
    await start(page, run)
    const first = (await waitFor(page, run, 1, '$pageview'))[0]
    await start(page, run) // reload
    const tab = await context.newPage()
    await start(tab, run)
    await expect
      .poll(async () => (await events(page, run)).filter((e) => e.event === '$pageview').length)
      .toBe(3)
    const anons = new Set((await events(page, run)).map((e) => e.anon_id))
    expect([...anons]).toEqual([first?.anon_id])

    await context.clearCookies()
    await page.evaluate(() => window.datacub.track('after_clear'))
    await flush(page)
    const after = (await waitFor(page, run, 1, 'after_clear')).find(
      (e) => e.event === 'after_clear',
    )
    expect(after?.anon_id).not.toBe(first?.anon_id)
    expect(after?.session_id).not.toBe(first?.session_id)
    expect((await cookies(page)).datacub_id).toBe(after?.anon_id)
  })

  test('no cookies: memory persistence, events still sent, nothing survives a reload', async ({
    page,
  }) => {
    const run = newRun()
    // A browser that silently drops every cookie write.
    await page.addInitScript(() =>
      Object.defineProperty(Document.prototype, 'cookie', {
        get: () => '',
        set: () => {},
        configurable: true,
      }),
    )
    await start(page, run)
    await page.evaluate(() => window.datacub.track('memory_event'))
    await flush(page)
    const a = await waitFor(page, run, 1, 'memory_event')
    expect(a.every((e) => e.persistence === 'memory')).toBe(true)
    await start(page, run)
    await flush(page)
    const pv = (await waitFor(page, run, 2, '$pageview')).filter((e) => e.event === '$pageview')
    expect(pv[1]?.anon_id).not.toBe(pv[0]?.anon_id)
  })

  test('cookie access that throws (sandboxed frames) degrades to memory without page errors', async ({
    page,
  }) => {
    const run = newRun()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.addInitScript(() =>
      Object.defineProperty(Document.prototype, 'cookie', {
        get: () => {
          throw new DOMException('blocked', 'SecurityError')
        },
        set: () => {
          throw new DOMException('blocked', 'SecurityError')
        },
        configurable: true,
      }),
    )
    await start(page, run)
    await page.evaluate(() => window.datacub.track('still_works'))
    await flush(page)
    const all = await waitFor(page, run, 1, 'still_works')
    expect(all.every((e) => e.persistence === 'memory')).toBe(true)
    expect(errors).toEqual([])
  })
})

test.describe('identify and reset', () => {
  test('login: $identify links the current anon_id; later events carry user_id, also after reload', async ({
    page,
  }) => {
    const run = newRun()
    await start(page, run)
    const anon = (await waitFor(page, run, 1, '$pageview'))[0]?.anon_id
    await page.evaluate(() => {
      window.datacub.identify('user_42')
      window.datacub.identify('user_42') // repeat: no second $identify
      window.datacub.track('after_login')
    })
    await flush(page)
    await start(page, run)
    await page.evaluate(() => window.datacub.track('after_reload'))
    await flush(page)
    const all = await waitFor(page, run, 1, 'after_reload')
    const ids = all.filter((e) => e.event === '$identify')
    expect(ids).toHaveLength(1)
    expect(ids[0]).toMatchObject({
      user_id: 'user_42',
      anon_id: anon,
      properties: { $anon_id: anon },
    })
    for (const name of ['after_login', 'after_reload'])
      expect(all.find((e) => e.event === name)).toMatchObject({ user_id: 'user_42', anon_id: anon })
  })

  test('logout: reset gives a new anon_id and session; nothing after it is attributed to the user', async ({
    page,
  }) => {
    const run = newRun()
    await start(page, run)
    await page.evaluate(() => {
      window.datacub.identify('user_42', { account: 'org_7' })
      window.datacub.track('before_logout')
      window.datacub.reset()
      window.datacub.track('after_logout')
    })
    await flush(page)
    const all = await waitFor(page, run, 1, 'after_logout')
    const before = all.find((e) => e.event === 'before_logout')
    const after = all.find((e) => e.event === 'after_logout')
    expect(before).toMatchObject({ user_id: 'user_42', account_id: 'org_7' })
    expect(after).toMatchObject({ user_id: null, account_id: null })
    expect(after?.anon_id).not.toBe(before?.anon_id)
    expect(after?.session_id).not.toBe(before?.session_id)
    // WebKit hands page cookie writes to the context a moment later.
    await expect.poll(async () => (await cookies(page)).datacub_id).toBe(after?.anon_id)
    const c = await cookies(page)
    expect(c.datacub_u).toBeUndefined()
    expect(c.datacub_a).toBeUndefined()
  })

  test('account switch: identify(B) while A resets first, so A and B are never linked', async ({
    page,
  }) => {
    const run = newRun()
    await start(page, run)
    await page.evaluate(() => {
      window.datacub.identify('user_a')
      window.datacub.identify('user_b')
    })
    await flush(page)
    const ids = (await waitFor(page, run, 2, '$identify')).filter((e) => e.event === '$identify')
    expect(ids.map((e) => e.user_id)).toEqual(['user_a', 'user_b'])
    expect(ids[1]?.anon_id).not.toBe(ids[0]?.anon_id)
  })

  // Traits ride the $identify, then a $set only when they change; never on other events
  test('traits: email, name, phone on $identify, changes as $set, nothing on other events', async ({
    page,
  }) => {
    const run = newRun()
    await start(page, run)
    await page.evaluate(() => {
      window.datacub.identify('user_t', {
        email: ' Sara@Example.SA ',
        name: 'سارة',
        phone: '0551234567',
        plan: 'pro',
        password: 'hunter2',
      })
      window.datacub.identify('user_t', {
        email: ' Sara@Example.SA ',
        name: 'سارة',
        phone: '0551234567',
        plan: 'pro',
        password: 'hunter2',
      })
      window.datacub.identify('user_t', { email: 'sara@example.sa', plan: 'team' })
      window.datacub.track('after_traits', { note: 'x' })
    })
    await flush(page)
    const all = await waitFor(page, run, 1, 'after_traits')
    const ids = all.filter((e) => e.event === '$identify')
    expect(ids).toHaveLength(1)
    expect(ids[0]?.properties).toMatchObject({
      $email: ' Sara@Example.SA ',
      $name: 'سارة',
      $phone: '0551234567',
      plan: 'pro',
    })
    // the client floor still drops blocked keys from custom traits
    expect(ids[0]?.properties.password).toBeUndefined()
    const sets = all.filter((e) => e.event === '$set')
    // the same user again: traits as $set, never a second $identify (not deduplicated)
    expect(sets).toHaveLength(2)
    expect(sets[1]).toMatchObject({
      user_id: 'user_t',
      properties: { $email: 'sara@example.sa', plan: 'team' },
    })
    const other = JSON.stringify(all.filter((e) => e.event !== '$identify' && e.event !== '$set'))
    expect(other).not.toMatch(/example\.sa|0551234567|سارة/)
  })

  test('identify({ id, ... }): id aliases, field aliases, nested metadata, repeated updates', async ({
    page,
  }) => {
    const run = newRun()
    await start(page, run)
    await page.evaluate(() => {
      window.datacub.identify({
        id: 'user_o',
        email: 'nora@example.sa',
        fullName: 'نورة',
        phoneNumber: '+966 55 123 4567',
        plan: 'starter',
        premium: true,
        seats: 3,
        signupDate: new Date('2026-11-01T09:00:00Z'),
        company: { name: 'Darb', size: 40, address: { city: 'Riyadh' } },
        roles: ['admin', 'billing'],
      })
      // the same user by another id key: an update, kept on the same person
      window.datacub.identify({ userId: 'user_o', plan: 'pro' })
      window.datacub.identify({ user_id: 'user_o', role: 'owner' })
      window.datacub.track('after_object_identify')
    })
    await flush(page)
    const all = await waitFor(page, run, 1, 'after_object_identify')
    const ids = all.filter((e) => e.event === '$identify')
    expect(ids).toHaveLength(1)
    expect(ids[0]?.user_id).toBe('user_o')
    expect(ids[0]?.properties).toMatchObject({
      $email: 'nora@example.sa',
      $name: 'نورة',
      $phone: '+966 55 123 4567',
      plan: 'starter',
      premium: true,
      seats: 3,
      signupDate: '2026-11-01T09:00:00.000Z',
      company: { name: 'Darb', size: 40, address: { city: 'Riyadh' } },
      roles: ['admin', 'billing'],
    })
    // the id and the alias keys never stay as traits
    for (const k of ['id', 'fullName', 'phoneNumber']) expect(ids[0]?.properties[k]).toBeUndefined()
    const sets = all.filter((e) => e.event === '$set')
    expect(sets.map((e) => [e.user_id, e.properties])).toEqual([
      ['user_o', { plan: 'pro' }],
      ['user_o', { role: 'owner' }],
    ])
    expect(all.at(-1)?.user_id).toBe('user_o')
  })

  test('identify({}) without an id is refused and sends nothing', async ({ page }) => {
    const run = newRun()
    await start(page, run)
    await page.evaluate(() => {
      window.datacub.identify({ email: 'no-id@example.sa' } as never)
      window.datacub.track('after_bad_identify')
    })
    await flush(page)
    const all = await waitFor(page, run, 1, 'after_bad_identify')
    expect(all.some((e) => e.event === '$identify' || e.event === '$set')).toBe(false)
    expect(JSON.stringify(all)).not.toContain('no-id@example.sa')
  })

  test('traits on a different user are a new person: reset first, never merged', async ({
    page,
  }) => {
    const run = newRun()
    await start(page, run)
    await page.evaluate(() => {
      window.datacub.identify('user_a', { email: 'same@example.sa' })
      window.datacub.identify('user_b', { email: 'same@example.sa' })
    })
    await flush(page)
    const ids = (await waitFor(page, run, 2, '$identify')).filter((e) => e.event === '$identify')
    expect(ids.map((e) => e.user_id)).toEqual(['user_a', 'user_b'])
    expect(ids[1]?.anon_id).not.toBe(ids[0]?.anon_id)
    expect(ids[1]?.properties.$email).toBe('same@example.sa')
  })

  test('account changes without a user change update account_id only', async ({ page }) => {
    const run = newRun()
    await start(page, run)
    await page.evaluate(() => {
      window.datacub.identify('user_a', { account: 'org_1' })
      window.datacub.identify('user_a', { account: 'org_2' })
      window.datacub.track('in_org_2')
    })
    await flush(page)
    const all = await waitFor(page, run, 1, 'in_org_2')
    expect(all.filter((e) => e.event === '$identify')).toHaveLength(1)
    expect(all.find((e) => e.event === 'in_org_2')?.account_id).toBe('org_2')
  })

  test('identify before consent is applied at grant, in order: $consent, $identify, $pageview', async ({
    page,
  }) => {
    const run = newRun()
    await start(page, run, { grant: false })
    await page.evaluate(() => {
      window.datacub.identify('user_9')
      window.datacub.consent.grant()
    })
    await flush(page)
    const all = await sorted(page, run)
    expect(all.map((e) => e.event).slice(0, 3)).toEqual(['$consent', '$identify', '$pageview'])
    expect(all[2]?.user_id).toBe('user_9')
  })

  test('tabs share identity: login and logout in one tab apply to the other', async ({
    page,
    context,
  }) => {
    const run = newRun()
    await start(page, run)
    const other = await context.newPage()
    await start(other, run)
    // Cookie writes reach another tab's process a moment later in WebKit; wait until they are visible.
    const sees = (on: boolean) =>
      expect
        .poll(() => other.evaluate(() => document.cookie.includes('datacub_u_abcdefgh=')))
        .toBe(on)
    await page.evaluate(() => window.datacub.identify('user_42'))
    await sees(true)
    await other.evaluate(() => window.datacub.track('other_tab_after_login'))
    await page.evaluate(() => window.datacub.reset())
    await sees(false)
    await other.evaluate(() => window.datacub.track('other_tab_after_logout'))
    await flush(other)
    await flush(page)
    const all = await waitFor(page, run, 1, 'other_tab_after_logout')
    const login = all.find((e) => e.event === 'other_tab_after_login')
    const logout = all.find((e) => e.event === 'other_tab_after_logout')
    expect(login?.user_id).toBe('user_42')
    expect(logout?.user_id).toBeNull()
    expect(logout?.anon_id).toBe((await cookies(page)).datacub_id)
    expect(logout?.anon_id).not.toBe(login?.anon_id)
  })
})

test.describe('sessions', () => {
  const START = new Date('2026-01-01T09:00:00Z')

  test('idle timeout: 29 minutes continues the session, 31 minutes starts a new one', async ({
    page,
  }) => {
    const run = newRun()
    await page.clock.install({ time: START })
    await start(page, run)
    await page.clock.fastForward('29:00')
    await page.evaluate(() => window.datacub.track('at_29'))
    await page.clock.fastForward('31:00')
    await page.evaluate(() => window.datacub.track('at_60'))
    await flush(page)
    const all = await waitFor(page, run, 1, 'at_60')
    const s = (n: string) => all.find((e) => e.event === n)?.session_id
    expect(s('at_29')).toBe(s('$pageview'))
    expect(s('at_60')).not.toBe(s('at_29'))
  })

  test('user input keeps the session alive without sending events', async ({ page }) => {
    const run = newRun()
    await page.clock.install({ time: START })
    await start(page, run)
    for (let i = 0; i < 3; i++) {
      await page.clock.fastForward('20:00')
      await page.mouse.click(5, 300) // not an allowed target: no $click, only activity
    }
    await page.evaluate(() => window.datacub.track('after_hour_of_activity'))
    await flush(page)
    const all = await waitFor(page, run, 1, 'after_hour_of_activity')
    expect(all.filter((e) => e.event === '$click')).toHaveLength(0)
    expect(all.find((e) => e.event === 'after_hour_of_activity')?.session_id).toBe(
      all.find((e) => e.event === '$pageview')?.session_id,
    )
  })

  test('24 hour maximum: continuous activity still starts a new session after 24 hours', async ({
    page,
  }) => {
    const run = newRun()
    await page.clock.install({ time: START })
    await start(page, run)
    for (let h = 0; h < 25 * 3; h++) {
      await page.clock.fastForward('20:00')
      await page.evaluate(() => window.datacub.track('tick'))
    }
    await flush(page)
    const ticks = (await waitFor(page, run, 75, 'tick')).filter((e) => e.event === 'tick')
    const sessions = [...new Set(ticks.map((e) => e.session_id))]
    expect(sessions).toHaveLength(2)
    const firstOfSecond = ticks.find((e) => e.session_id === sessions[1])
    expect(Date.parse(firstOfSecond?.ts as string) - START.getTime()).toBeGreaterThan(
      24 * 3600 * 1000,
    )
  })

  test('datacub_ss is rewritten for a new session or after 5 s of activity, not on every event', async ({
    page,
  }) => {
    const run = newRun()
    await page.clock.install({ time: START })
    await start(page, run)
    const ss = async () => ((await cookies(page)).datacub_ss ?? '').split('.')
    const first = await ss()
    await page.clock.fastForward(2000)
    await page.evaluate(() => window.datacub.track('at_2s'))
    expect(await ss()).toEqual(first)
    await page.clock.fastForward(4000)
    await page.evaluate(() => window.datacub.track('at_6s'))
    const next = await ss()
    expect(next[0]).toBe(first[0])
    expect(Number(next[2]) - Number(first[2])).toBeGreaterThan(5000)
    await flush(page)
    const all = await waitFor(page, run, 1, 'at_6s')
    expect(new Set(all.map((e) => e.session_id))).toEqual(new Set([first[0]]))
  })

  test('no split at midnight Asia/Riyadh', async ({ page }) => {
    const run = newRun()
    await page.clock.install({ time: new Date('2026-01-01T20:50:00Z') }) // 23:50 in Riyadh
    await start(page, run)
    await page.clock.fastForward('20:00') // 00:10 in Riyadh
    await page.evaluate(() => window.datacub.track('after_midnight'))
    await flush(page)
    const all = await waitFor(page, run, 1, 'after_midnight')
    expect(all.find((e) => e.event === 'after_midnight')?.session_id).toBe(
      all.find((e) => e.event === '$pageview')?.session_id,
    )
  })

  test('reload and a second tab within the timeout share the session', async ({
    page,
    context,
  }) => {
    const run = newRun()
    await start(page, run)
    await start(page, run)
    const tab = await context.newPage()
    await start(tab, run)
    // at least once: a send cut by the reload can arrive twice with the same uuid; the server dedupes
    const pageviews = async () =>
      new Set((await events(page, run)).filter((e) => e.event === '$pageview').map((e) => e.uuid))
        .size
    await expect.poll(pageviews).toBe(3)
    expect(new Set((await events(page, run)).map((e) => e.session_id)).size).toBe(1)
  })

  test('clock moved backwards: the session continues and events still go out', async ({ page }) => {
    const run = newRun()
    await page.clock.install({ time: START })
    await start(page, run)
    await page.clock.setSystemTime(new Date(START.getTime() - 3600_000))
    await page.evaluate(() => window.datacub.track('earlier_clock'))
    await flush(page)
    const all = await waitFor(page, run, 1, 'earlier_clock')
    const e = all.find((x) => x.event === 'earlier_clock')
    expect(e?.session_id).toBe(all.find((x) => x.event === '$pageview')?.session_id)
    // the installed clock keeps running in real time, so allow the test's own duration
    expect(Date.parse(e?.ts as string) - (START.getTime() - 3600_000)).toBeLessThan(2000)
  })
})
