import { expect, type Page, test } from '@playwright/test'
import pkg from '../../package.json' with { type: 'json' }
import { type Event, hide, KEY, log, newRun, start, waitFor } from './helpers.ts'

// Privacy suite. Every string below is synthetic.
const PAGE = '/privacy.html'

// Page errors and console errors the SDK might cause; tests that throw on purpose skip this.
function watchErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))
  return errors
}

async function begin(page: Page, run: string, init: Record<string, unknown> = {}) {
  await start(page, run, { path: PAGE, init })
  // the initial $consent and $pageview go out at once; wait so nothing is in flight later
  await waitFor(page, run, 2)
}

// Flushes through sendBeacon and waits for a final marker event, so every earlier event is in.
async function finish(page: Page, run: string) {
  await page.evaluate(() => window.datacub.track('done_marker'))
  await hide(page)
  await waitFor(page, run, 1, 'done_marker')
  const l = await log(page, run)
  return { bodies: l.batches.map((b) => b.body), all: l.batches.flatMap((b) => b.events) }
}

// The SDK sends a route change 100 ms after it; a 150 ms timer set later always fires after that one.
const settle = (page: Page) => page.evaluate(() => new Promise((r) => setTimeout(r, 150)))

const named = (all: Event[], name: string) => all.filter((e) => e.event === name)

function expectAbsent(bodies: string[], secrets: string[]) {
  const joined = bodies.join('\n')
  for (const s of secrets) expect(joined, `leaked: ${s}`).not.toContain(s)
}

// Real typing into sensitive fields; nothing typed or selected reaches any request.
test('sdk.no_input_values: typed and selected values never leave the page', async ({ page }) => {
  const run = newRun()
  const errors = watchErrors(page)
  await begin(page, run)
  const typed = {
    pw: 'Pw!Secret-7731',
    cc: '4111 1111 1111 1111',
    otp: '482913',
    nid: '1012345678',
    email: 'typed.user@example.com',
    ta: 'رسالة خاصة جدا TYPED-MSG-91',
  }
  for (const [id, v] of Object.entries(typed)) {
    await page.click(`#${id}`)
    await page.locator(`#${id}`).pressSequentially(v)
  }
  await page.fill('#nid', '١٠١٢٣٤٥٦٧٨')
  await page.click('#ce')
  await page.keyboard.type('CE-TYPED-سري')
  await page.click('#ce-child')
  await page.click('#sel')
  await page.selectOption('#sel', 'OPTVAL-B')
  await page.click('#action-shadow')
  await page.click('#go')
  const { bodies, all } = await finish(page, run)

  expectAbsent(bodies, [
    ...Object.values(typed),
    '4111111111111111',
    '١٠١٢٣٤٥٦٧٨',
    'CE-TYPED',
    'OPTVAL',
    'الرياض السرية',
    'خيار سري ثاني',
    'clobber',
    'evil.example',
  ])
  // only the submit button is a click (with its own text); fields, the editor and the select are not
  expect(named(all, '$click').map((e) => e.properties)).toMatchObject([
    { $el_tag: 'button', $el_name: 'checkout', $el_text: 'ادفع', $el_in_form: true },
  ])
  // field structure is captured (types and names are the form's schema), values never are
  const fields = named(all, '$form_fields')[0]?.properties.$form_fields as unknown[][]
  expect(fields.map((f) => f[0])).toContain('password')
  expect(fields.find((f) => f[0] === 'password')?.[1]).toBe('')
  // the field named "action" shadows form.action (DOM clobbering): the real attribute is used
  expect(named(all, '$form_submit').map((e) => e.properties)).toEqual([
    {
      $form_name: 'checkout',
      $form_action_path: '/pay/:redacted',
      $field_count: 8,
      $dropped_count: 1,
    },
  ])
  expect(errors).toEqual([])
})

// Allowlisted targets only, attribute allowlist, no-capture regions.
test('sdk.autocapture_allowlist: click properties, link targets and no-capture regions', async ({
  page,
}) => {
  const run = newRun()
  const errors = watchErrors(page)
  await begin(page, run)
  for (const id of [
    'ar-btn',
    'named',
    'in-submit',
    'in-button',
    'sum',
    'tab',
    'mi',
    'tel',
    'sms',
    'mail',
    'ext',
    'js',
    'home',
    'nc1',
    'nc2',
    'nc3',
    'nc-submit',
  ])
    await page.click(`#${id}`)
  const { bodies, all } = await finish(page, run)

  const clicks = named(all, '$click').map((e) => e.properties)
  expect(clicks).toMatchObject([
    { $el_tag: 'button', $el_name: null, $el_text: 'ادفع الآن بسرعة', $el_sig: 'button#ar-btn' },
    { $el_tag: 'button', $el_name: '[redacted]', $el_text: 'ملفي' },
    { $el_tag: 'input', $el_name: null, $el_type: 'submit' },
    { $el_tag: 'input', $el_name: null, $el_type: 'button' },
    { $el_tag: 'summary', $el_name: null, $el_text: 'تفاصيل الطلب' },
    { $el_tag: 'div', $el_name: null, $el_role: 'tab', $el_text: 'تبويب' },
    { $el_tag: 'div', $el_name: null, $el_role: 'menuitem', $el_text: 'عنصر القائمة' },
    { $el_tag: 'a', $el_name: null, $el_href_path: 'tel:', $el_text: 'اتصل' },
    { $el_tag: 'a', $el_name: null, $el_href_path: 'sms:' },
    { $el_tag: 'a', $el_name: null, $el_href_path: 'mailto:' },
    { $el_tag: 'a', $el_name: null, $el_href_path: 'partner.example/u/:redacted/orders/:redacted' },
    { $el_tag: 'a', $el_name: null },
    { $el_tag: 'a', $el_name: null, $el_href_path: '/privacy.html', $el_text: 'الرئيسية' },
  ])
  for (const c of clicks) {
    // a share of the window, and the element chain
    expect(c.$click_x).toBeGreaterThanOrEqual(0)
    expect(c.$click_x).toBeLessThanOrEqual(100)
    expect(typeof c.$el_sig).toBe('string')
  }
  // input buttons: never their value, which is what they show
  expect(clicks[2]?.$el_text).toBeUndefined()
  expect(clicks[3]?.$el_text).toBeUndefined()
  expect(named(all, '$form_submit')).toEqual([])
  expectAbsent(bodies, [
    // values, and labels the element's own text already gives
    'INPUT-SUBMIT-VALUE',
    'INPUT-BUTTON-VALUE',
    'TITLEATTR',
    'ARIALABEL',
    // link and data-datacub-name contents
    'named.user',
    'link.user',
    'LINKSUBJECT',
    '966551234567',
    'QUERYTOKEN',
    'FRAGTOKEN',
    '1012345678',
    'user:pw',
    'javascript',
    // no-capture regions
    'hidden_one',
    'hidden_form',
    '/secret',
  ])
  expect(errors).toEqual([])
})

// Query, fragment, userinfo and ID-like path segments; title and full referrer.
// Three quick clicks are one $rageclick (once per burst), with the $click data plus $count.
test('sdk.rage_click: one event per burst, click data plus $count, off with rageClicks false', async ({
  page,
}) => {
  const run = newRun()
  await begin(page, run)
  await page.click('#named', { clickCount: 2 })
  await page.click('#ar-btn', { clickCount: 4 })
  const { all } = await finish(page, run)
  expect(named(all, '$rageclick').map((e) => e.properties)).toMatchObject([
    { $el_tag: 'button', $el_name: null, $el_text: 'ادفع الآن بسرعة', $count: 3 },
  ])
  expect(named(all, '$click')).toHaveLength(6)

  const off = newRun()
  await begin(page, off, { rageClicks: false })
  await page.click('#ar-btn', { clickCount: 3 })
  expect(named((await finish(page, off)).all, '$rageclick')).toEqual([])
})

test('sdk.url_sanitisation: PII in path, query and fragment; title scrubbed; referrer host and path', async ({
  page,
  baseURL,
}) => {
  const run = newRun()
  const errors = watchErrors(page)
  await page.goto(
    `${PAGE}?email=q.user%40example.com&phone=0551234567&utm_campaign=sale&utm_source=q.user%40example.com&gclid=CLICKVALUE123#token=FRAGSECRET`,
    { referer: 'https://search.example/results/ref.user%40example.com?q=REFQUERY' },
  )
  await page.evaluate(
    ([key, run]) => {
      window.datacub.init(key as string, { apiHost: `${location.origin}/r/${run}` })
      window.datacub.consent.grant()
      history.pushState(
        {},
        '',
        '/u/push.user%40example.com/orders/1012345678/منتجات?token=PUSHTOKEN#PUSHFRAG',
      )
    },
    [KEY, run],
  )
  await settle(page)
  const { bodies, all } = await finish(page, run)
  const views = named(all, '$pageview')
  const slug = new URL('https://datacub.example/منتجات').pathname
  expect(views.map((e) => e.context.path)).toEqual([
    '/privacy.html',
    `/u/:redacted/orders/:redacted${slug}`,
  ])
  expect(views.map((e) => e.context.url)).toEqual([
    `${baseURL}/privacy.html`,
    `${baseURL}/u/:redacted/orders/:redacted${slug}`,
  ])
  expect(views[0]?.context).toMatchObject({
    utm: { campaign: 'sale', source: '[redacted]' },
    click_id_type: 'gclid',
    referrer_host: 'search.example',
    // the referrer's path, templated: the email in it is redacted, the query dropped
    referrer_path: '/results/:redacted',
  })
  expect(views[1]?.properties.$prev_path).toBe('/privacy.html')
  // the title is kept with its personal data redacted (project setting: on by default)
  expect(views[0]?.context.title).toContain('حساب أحمد')
  for (const e of all) expect(e.context.referrer).toBeUndefined()
  expectAbsent(bodies, [
    'TITLE-1012345678',
    'title.user',
    'q.user',
    '0551234567',
    'CLICKVALUE123',
    'FRAGSECRET',
    'ref.user',
    'REFQUERY',
    'push.user',
    'PUSHTOKEN',
    'PUSHFRAG',
    '1012345678',
  ])
  expect(errors).toEqual([])
})

test('sdk.url_sanitisation: hash routes are templated; other fragments dropped', async ({
  page,
}) => {
  const run = newRun()
  await begin(page, run, { hashRouting: true })
  await page.evaluate(() =>
    history.pushState({}, '', '/privacy.html#/users/1012345678/edit?email=h.user@example.com'),
  )
  await settle(page)
  await page.evaluate(async () => {
    const changed = new Promise((r) => addEventListener('hashchange', r, { once: true }))
    location.hash = '#access_token=HASHSECRET'
    await changed
    await new Promise((r) => setTimeout(r, 150))
  })
  const { bodies, all } = await finish(page, run)
  expect(named(all, '$pageview').map((e) => e.context.path)).toEqual([
    '/privacy.html',
    '/privacy.html#/users/:redacted/edit',
    '/privacy.html',
  ])
  expectAbsent(bodies, ['1012345678', 'h.user', 'HASHSECRET'])
})

// Adversarial track() input never leaks and never throws into the page.
test('sdk.track_adversarial: hostile properties are cleaned, nothing throws', async ({ page }) => {
  const run = newRun()
  const errors = watchErrors(page)
  await begin(page, run)
  const result = await page.evaluate(() => {
    const circ: Record<string, unknown> = { a: 1 }
    circ.self = circ
    const props = JSON.parse(
      '{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted2":"yes"}}}',
    )
    Object.assign(props, {
      note: 'contact track.user@example.com now',
      ar: 'هويتي ١٠١٢٣٤٥٦٧٨',
      num: 1012345678,
      list: ['0551234567', { x: '4111 1111 1111 1111' }, 'SA0380000000608010167519'],
      deep: { a: { b: { c: '1012345678' } } },
      password: 'hunter2-PWVAL',
      'كلمة المرور': 'سر-خاص-ARPW',
      user_token: 'TOKVAL',
      national_id: 'NIDVAL',
      $set: { email: 'set.user@example.com' },
      distinct_id: 'DISTINCTVAL',
      ip: '203.0.113.7',
      api_key: 'APIKEYVAL',
      circ,
      huge: 'H'.repeat(1_000_000),
      many: Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`k${i}`, i])),
      fn: () => 'FNVAL',
      sym: Symbol('SYMVAL'),
      big: 10n,
      nan: Number.NaN,
      map: new Map([['m', 'MAPVAL']]),
      date: new Date(0),
    })
    const thrown: string[] = []
    const call = (f: () => void) => {
      try {
        f()
      } catch (e) {
        thrown.push(String(e))
      }
    }
    call(() => window.datacub.track('adversarial', props))
    const getter = {
      get boom() {
        throw new Error('getter boom getter.user@example.com')
      },
    }
    call(() => window.datacub.track('getter_event', getter as never))
    const trap = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error('ownKeys trap')
        },
      },
    )
    call(() => window.datacub.track('proxy_event', trap as never))
    call(() => window.datacub.track('null_props', null as never))
    call(() => window.datacub.track('string_props', 'track.user@example.com' as never))
    for (const name of [
      'track.user@example.com',
      'order_1012345678',
      '$pageview',
      '‮evil',
      'id 3f2b9c4e-8a1d-4e5f-b6c7-d8e9fa0b1c2d',
      'deadbeefdeadbeefcafe',
      'x'.repeat(101),
      '',
      42 as never,
    ])
      call(() => window.datacub.track(name))
    return {
      thrown,
      polluted:
        ({} as Record<string, unknown>).polluted ?? ({} as Record<string, unknown>).polluted2,
    }
  })
  expect(result).toEqual({ thrown: [], polluted: undefined })
  const { bodies, all } = await finish(page, run)
  expect(all.map((e) => e.event).filter((n) => !n.startsWith('$'))).toEqual([
    'adversarial',
    'null_props',
    'string_props',
    'done_marker',
  ])
  const p = named(all, 'adversarial')[0]?.properties as Record<string, unknown>
  expect(p).toMatchObject({
    note: 'contact [redacted] now',
    ar: 'هويتي [redacted]',
    num: '[redacted]',
    list: ['[redacted]', { x: '[redacted]' }, 'SA[redacted]'],
    deep: { a: { b: '[depth]' } },
    circ: { a: 1, self: { a: 1, self: '[depth]' } },
    huge: '[redacted]',
    date: '1970-01-01T00:00:00.000Z',
  })
  expect(Object.keys(p.many as object)).toHaveLength(200)
  for (const k of [
    'password',
    'كلمة المرور',
    'user_token',
    'national_id',
    '$set',
    'distinct_id',
    'ip',
    'api_key',
    'fn',
    'sym',
    'big',
    'nan',
    'map',
    '__proto__',
  ])
    expect(Object.hasOwn(p, k), k).toBe(false)
  expect(p.$dropped_count).toBeGreaterThan(10)
  expect(named(all, 'string_props')[0]?.properties).toEqual({})
  expectAbsent(bodies, [
    'track.user',
    'getter.user',
    '١٠١٢٣٤٥٦٧٨',
    '1012345678',
    '0551234567',
    '4111',
    '0380000000608010167519',
    'PWVAL',
    'ARPW',
    'TOKVAL',
    'NIDVAL',
    'set.user',
    'DISTINCTVAL',
    '203.0.113.7',
    'APIKEYVAL',
    'HHHHHHHHHH',
    'FNVAL',
    'SYMVAL',
    'MAPVAL',
    'polluted"',
    'evil',
    'deadbeefdeadbeefcafe',
  ])
  expect(errors).toEqual([])
})

// Names with 6 or more digits are refused, and digits are normalised first, so Arabic-Indic and spaced digits count too.
test('sdk.track_adversarial: event names with Arabic-Indic or spaced digits are refused', async ({
  page,
}) => {
  const run = newRun()
  await begin(page, run)
  await page.evaluate(() => {
    window.datacub.track('طلب_١٠١٢٣٤٥٦٧٨')
    window.datacub.track('id 1 0 1 2 3 4 5 6 7 8')
  })
  const { bodies } = await finish(page, run)
  expectAbsent(bodies, ['١٠١٢٣٤٥٦٧٨', '1 0 1 2 3 4 5 6 7 8'])
})

// identity.reject_pii_ids: every refused shape leaves user_id null.
test('identity.reject_pii_ids: emails, phones, IDs, cards, JWTs and sentinels are refused', async ({
  page,
}) => {
  const run = newRun()
  await begin(page, run)
  const accepted = await page.evaluate(() => {
    const anon = document.cookie.match(/datacub_id_abcdefgh=([^;]*)/)?.[1]
    const ss = decodeURIComponent(
      document.cookie.match(/datacub_ss_abcdefgh=([^;]*)/)?.[1] ?? '',
    ).split('.')[0]
    const refused: unknown[] = [
      'ahmed@example.com',
      ' Ahmed@Example.com ',
      '1012345678',
      '2012345678',
      '١٠١٢٣٤٥٦٧٨',
      '۲۰۱۲۳۴۵۶۷۸',
      '１０１２３４５６７８',
      '101 234 5678',
      '101-234-5678',
      '0551234567',
      '05 5123 4567',
      '+966551234567',
      '+966 55 123 4567',
      '00966551234567',
      '966551234567',
      '+44 20 7946 0958',
      '+1 (415) 555-0100',
      '4111111111111111',
      '4111-1111-1111-1111',
      '4111 1111 1111 1111',
      '378282246310005',
      '6011111111111117',
      '5555555555554444',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln',
      'null',
      'undefined',
      'NULL',
      '0',
      '-1',
      'anonymous',
      'Guest',
      '[object Object]',
      'none',
      'NaN',
      'false',
      'true',
      'user',
      'test',
      'unknown',
      'not_authenticated',
      'distinct_id',
      'id',
      '',
      '   ',
      'abc\u0000',
      'a\nb',
      '‮user',
      'u‏42',
      'x'.repeat(129),
      1012345678,
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      null,
      undefined,
      {},
      [],
      true,
      anon,
      ss,
    ]
    const out: unknown[] = []
    for (const v of refused) {
      window.datacub.identify(v as string)
      if (v != null) window.datacub.identify('acct_ok_user', { account: v as string })
      if (/datacub_u_abcdefgh=/.test(document.cookie)) {
        out.push(v)
        window.datacub.reset()
      }
    }
    return out
  })
  expect(accepted).toEqual([])
  const { all } = await finish(page, run)
  expect(named(all, '$identify')).toEqual([])
  expect(all.every((e) => e.user_id === null && e.account_id === null)).toBe(true)
})

test('identity.reject_pii_ids: a normal ID is accepted (control)', async ({ page }) => {
  const run = newRun()
  await begin(page, run)
  await page.evaluate(() => window.datacub.identify('user_42', { account: 'org_7' }))
  const { all } = await finish(page, run)
  expect(named(all, '$identify')).toHaveLength(1)
  expect(named(all, 'done_marker')[0]).toMatchObject({ user_id: 'user_42', account_id: 'org_7' })
})

// Tatweel, slashes, dashes and zero-width characters are separators
// hidden inside numbers; identify() removes all of them before matching.
test('identity.reject_pii_ids: IDs hidden with separators are refused', async ({ page }) => {
  const run = newRun()
  await begin(page, run)
  const accepted = await page.evaluate(() => {
    const out: string[] = []
    for (const v of ['1ـ012345678', '101/234/5678', '1​012345678', '055–1234567']) {
      window.datacub.identify(v)
      if (/datacub_u_abcdefgh=/.test(document.cookie)) {
        out.push(v)
        window.datacub.reset()
      }
    }
    return out
  })
  expect(accepted).toEqual([])
})

// sdk.error_capture (0.2.0): errors and rejections are captured with the personal data in their
// message redacted; console output is never read.
test('sdk.error_capture: errors and rejections captured, personal data redacted', async ({
  page,
}) => {
  const run = newRun()
  await begin(page, run)
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('ERRTEXT err.user@example.com 1012345678')
    })
    Promise.reject(new Error('REJTEXT rej.user@example.com 2012345678'))
    // biome-ignore lint/suspicious/noConsole: the page logs an error on purpose
    console.error('CONSOLETEXT con.user@example.com')
    window.dispatchEvent(new ErrorEvent('error', { message: 'EVTTEXT evt.user@example.com' }))
  })
  await page.evaluate(() => new Promise((r) => setTimeout(r, 50)))
  const { bodies, all } = await finish(page, run)
  const errs = named(all, '$error').map((e) => e.properties)
  expect(errs.map((e) => e.$error_kind).sort()).toEqual(['js', 'js', 'rejection'])
  const text = JSON.stringify(errs)
  for (const s of ['ERRTEXT', 'REJTEXT', 'EVTTEXT']) expect(text).toContain(s)
  expect(errs.find((e) => e.$error_kind === 'rejection')?.$error_name).toBe('Error')
  expect(named(all, '$pageleave')[0]?.properties.$error_count).toBe(3)
  expectAbsent(bodies, [
    'CONSOLETEXT',
    'err.user',
    'rej.user',
    'con.user',
    'evt.user',
    '1012345678',
    '2012345678',
  ])
})

// No fingerprinting, sensor or geolocation API in the shipped bundles.
test('sdk.no_geolocation: the shipped bundles reference no fingerprinting or sensor API', async ({
  request,
}) => {
  const banned: [string, RegExp][] = [
    ['canvas', /getContext|toDataURL|toBlob|getImageData|measureText/],
    ['webgl', /webgl|WebGL|getParameter|getExtension/],
    ['audio', /AudioContext|createOscillator|createAnalyser/],
    ['geolocation', /geolocation|getCurrentPosition|watchPosition/],
    // 0.2.0 reads device attributes (screen, cores, memory, connection) but never these
    ['hardware', /getBattery|getGamepads|\bbluetooth\b|\busb\b/],
    ['plugins', /\bplugins\b|mimeTypes/],
    ['media', /enumerateDevices|getUserMedia|mediaDevices/],
    ['screen', /colorDepth|pixelDepth|availWidth|availHeight/],
    [
      'sensors',
      /DeviceOrientation|DeviceMotion|deviceorientation|devicemotion|Accelerometer|Gyroscope|Magnetometer|OrientationSensor|AmbientLight|GravitySensor/,
    ],
    ['ua', /\buserAgent\b|\bplatform\b/],
    ['webrtc', /RTCPeerConnection/],
    ['permissions', /permissions\.query|Notification/],
    ['fonts', /document\.fonts|\bfonts\.check/],
    ['storage', /localStorage|sessionStorage|indexedDB/],
    ['text', /innerText|innerHTML|outerHTML|\.value\b|\.placeholder\b/],
  ]
  for (const file of ['/datacub.js', '/datacub.mjs', `/v1/sdk/insights-${pkg.version}.min.js`]) {
    // the insights module reads layout-shift entries' .value (CLS); field values are proven absent
    // at run time by sdk.no_input_values and the $form_fields tests
    const rules = file.includes('insights')
      ? banned.map(([n, re]): [string, RegExp] =>
          n === 'text' ? [n, /innerText|innerHTML|outerHTML|\.placeholder\b/] : [n, re],
        )
      : banned
    const res = await request.get(file)
    expect(res.ok()).toBe(true)
    const code = (await res.text()).replace(/\n\/\/# (?:debugId|sourceMappingURL)=.*/g, '')
    const hits = rules
      .filter(([, re]) => re.test(code))
      .map(([name, re]) => `${name}: ${code.match(re)?.[0]}`)
    expect(hits, file).toEqual([])
  }
})

// Wraps every fingerprinting and sensor API before the SDK loads, and records any call.
function installSpy() {
  const w = window as unknown as Record<string, unknown> & { __spy: string[] }
  w.__spy = []
  const hit = (n: string) => w.__spy.push(n)
  const wrap = (obj: object | undefined, name: string, label: string) => {
    if (!obj) return
    const d = Object.getOwnPropertyDescriptor(obj, name)
    if (!d?.configurable) return
    if (typeof d.value === 'function') {
      const f = d.value
      Object.defineProperty(obj, name, {
        ...d,
        value(this: unknown, ...a: unknown[]) {
          hit(label)
          return f.apply(this, a)
        },
      })
    } else if (d.get) {
      const g = d.get
      Object.defineProperty(obj, name, {
        ...d,
        get(this: unknown) {
          hit(label)
          return g.call(this)
        },
      })
    }
  }
  const proto = (n: string) => (w[n] as { prototype?: object } | undefined)?.prototype
  const methods: [string, string[]][] = [
    ['HTMLCanvasElement', ['getContext', 'toDataURL', 'toBlob']],
    ['OffscreenCanvas', ['getContext', 'convertToBlob']],
    ['CanvasRenderingContext2D', ['getImageData', 'measureText']],
    ['WebGLRenderingContext', ['getParameter', 'getExtension', 'getSupportedExtensions']],
    ['WebGL2RenderingContext', ['getParameter', 'getExtension', 'getSupportedExtensions']],
    ['Geolocation', ['getCurrentPosition', 'watchPosition']],
    ['MediaDevices', ['enumerateDevices', 'getUserMedia']],
    ['Permissions', ['query']],
    ['FontFaceSet', ['check', 'load']],
    [
      'Navigator',
      [
        'geolocation',
        'getBattery',
        'plugins',
        'mimeTypes',
        'mediaDevices',
        'permissions',
        'getGamepads',
        'bluetooth',
        'usb',
        'userAgent',
        'platform',
      ],
    ],
    ['Screen', ['colorDepth', 'pixelDepth', 'availWidth', 'availHeight']],
  ]
  for (const [cls, names] of methods) for (const n of names) wrap(proto(cls), n, `${cls}.${n}`)
  for (const c of [
    'AudioContext',
    'OfflineAudioContext',
    'webkitAudioContext',
    'DeviceOrientationEvent',
    'DeviceMotionEvent',
    'Accelerometer',
    'Gyroscope',
    'Magnetometer',
    'AbsoluteOrientationSensor',
    'RelativeOrientationSensor',
    'AmbientLightSensor',
    'GravitySensor',
    'LinearAccelerationSensor',
    'RTCPeerConnection',
  ]) {
    const C = w[c] as (new (...a: unknown[]) => object) | undefined
    if (C)
      w[c] = new Proxy(C, {
        construct(t, a) {
          hit(`new ${c}`)
          return Reflect.construct(t, a)
        },
      })
  }
  const add = EventTarget.prototype.addEventListener
  EventTarget.prototype.addEventListener = function (this: EventTarget, type, ...rest) {
    if (/^(?:deviceorientation|deviceorientationabsolute|devicemotion)$/.test(type))
      hit(`listen ${type}`)
    return add.call(this, type, ...rest)
  }
}

// Runtime half of the above: requests go only to the configured endpoint.
test('sdk.no_geolocation: a full session calls no sensor API and talks only to the endpoint', async ({
  page,
  baseURL,
}) => {
  const run = newRun()
  const errors = watchErrors(page)
  const requests: string[] = []
  page.on('request', (r) => requests.push(r.url()))
  await page.addInitScript(installSpy)
  await begin(page, run)
  await page.click('#ar-btn')
  await page.click('#ext')
  await page.click('#mail')
  await page.fill('#email', 'spy.user@example.com')
  await page.click('#go')
  await page.evaluate(async () => {
    window.datacub.track('session_step', { plan: 'pro' })
    window.datacub.identify('user_42')
    history.pushState({}, '', '/next/42')
    const changed = new Promise((r) => addEventListener('hashchange', r, { once: true }))
    location.hash = '#later'
    await changed
    await new Promise((r) => setTimeout(r, 150))
  })
  await page.evaluate(() => {
    window.datacub.reset()
    window.datacub.track('after_reset')
  })
  const { bodies } = await finish(page, run)
  expect(await page.evaluate(() => (window as unknown as { __spy: string[] }).__spy)).toEqual([])
  expectAbsent(bodies, ['spy.user'])
  const endpoint = `${baseURL}/r/${run}/v1/batch`
  const other = requests.filter(
    (u) =>
      u !== endpoint &&
      !/\/privacy\.html$|\/datacub\.js$|\/favicon\.ico$|\/v1\/sdk\/insights-[\d.]+\.min\.js$/.test(
        u,
      ),
  )
  expect(other).toEqual([])
  expect(requests.filter((u) => u === endpoint).length).toBeGreaterThan(1)
  expect(errors).toEqual([])
})
