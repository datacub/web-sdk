// @datacub/web: observe, sanitise, package, transmit. Everything else happens on the server.
// Importing this module has no side effects. No public method throws.

import {
  badText,
  clean,
  cleanUrl,
  eventName,
  label,
  tally,
  text,
  type Url,
  validId,
} from './scrub.ts'

// The package version, injected at build time from package.json (scripts/build.ts defines
// __VERSION__); a plain `bun test` run gets it from test/version.ts.
declare const __VERSION__: string
export const VERSION: string = __VERSION__
// sha384 of dist/insights.js, set by the build; empty when the sources run directly (tests)
declare const __INSIGHTS_SRI__: string

export type Property =
  | string
  | number
  | boolean
  | null
  | Date
  | Property[]
  | { [key: string]: Property }
export type Properties = Record<string, Property>

export interface InitOptions {
  /** Ingestion origin or first-party proxy path. Default https://in.datacub.to */
  apiHost?: string
  /** Treat `#/route` fragments as routes. Default false. */
  hashRouting?: boolean
  /** Clicks and form submits. Default true. Pageviews and page leaves are always on. */
  autocapture?: boolean
  /** Rage clicks: 3 quick clicks in a row (the browser's own click count). Default true; needs autocapture. */
  rageClicks?: boolean
  /** Your app version or deployment ID, sent as context.release. */
  release?: string
  /**
   * Store and send nothing until datacub.consent.grant(). Default false: tracking starts at once.
   * Turn it on with "Ask for consent first" in the project's settings, which makes datacub refuse events
   * sent without a grant.
   */
  requireConsent?: boolean
  /**
   * The insights module (Web Vitals, long tasks, resource totals, form field details, device
   * model), loaded after tracking starts from apiHost. Default true.
   */
  insights?: boolean
  /** Turn kinds of capture off on this site. The project's settings in datacub can turn them off too. */
  capture?: Capture
}

export interface Capture {
  /** Text of clicked buttons and links. */
  text?: boolean
  /** Page titles. */
  title?: boolean
  /** URL query values. */
  query?: boolean
  /** JavaScript errors and failed resources. */
  errors?: boolean
  /** Failed and slow fetch and XMLHttpRequest calls. */
  network?: boolean
  /** Form start, invalid submit and field details. */
  forms?: boolean
}

/**
 * Who the user is, beyond the ID. email, name and phone are shown on their profile and are
 * searchable; they never link two people. Any other key is a user property and passes the same
 * privacy rules as track() properties.
 */
export interface IdentifyOptions {
  /** Opaque workspace or organisation ID. Never a name or email. */
  account?: string | number
  email?: string
  name?: string
  phone?: string
  [trait: string]: Property | undefined
}

export interface GrantOptions {
  method?: 'banner' | 'settings' | 'api' | 'cmp'
  /** The customer's privacy notice version, at most 64 characters. */
  policyVersion?: string
  /** Only from an explicit user action: lets a grant override Global Privacy Control. */
  overrideGPC?: boolean
}

export interface DatacubClient {
  init(publicKey: string, options?: InitOptions): void
  track(event: string, properties?: Properties): void
  identify(userId: string | number, options?: IdentifyOptions): void
  /** The same with the id inside: identify({ id: 'u_42', email, plan: 'pro' }). */
  identify(
    profile: IdentifyOptions & {
      id?: string | number
      userId?: string | number
      user_id?: string | number
    },
  ): void
  reset(): void
  consent: { grant(options?: GrantOptions): void; revoke(): void }
  /** Added by the feedback widget (start() from @datacub/web/feedback, or /v1/feedback.js): show one question now. */
  ask?(questionId: string, options?: { into?: Element | string }): void
  /** Added by the feedback module: open the "Send feedback" card. */
  feedback?(): void
  /**
   * Added by the script-tag flags module (/v1/flags.js; with npm, import flag from @datacub/web/flags): is this feature flag on for this
   * visitor? false when it is off, unknown, or cannot be decided (before consent, offline).
   */
  flag?(key: string): Promise<boolean>
  /**
   * Added by the flags module: this visitor's version of an experiment, 'A' (the original) or 'B'.
   * Records that they saw it. 'A' when it is not running or cannot be decided.
   */
  experiment?(key: string): Promise<'A' | 'B'>
  /** @internal the feedback and flags modules' way in */
  _fb(): unknown[]
}

type Ev = Record<string, unknown>
type Fn = (...a: never[]) => unknown

const IDLE = 18e5 // 30 minutes
const DAY = 864e5 // session maximum
const YEAR = 34560000 // 400 days in seconds, the Chrome cap
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const NO_CAPTURE = '.datacub-no-capture,[data-datacub-no-capture]'
const COOKIES = ['datacub_id', 'datacub_u', 'datacub_a', 'datacub_ss']

let d: Document
let started = false
let opt: Capture = {}
let insights = true
// per page: what the SDK saw, sent as counts on $pageleave
let sentMs = 0
let errN = 0
let rqN = 0
let rfN = 0
let room: Record<string, number> = {}
const seen = new Set<string>()
let navK: string | undefined
let vw = 0
let vh = 0
// the pending dead-click check, and the last submit since the click
let dead: (() => void) | undefined
let sub: Event | undefined
let F: typeof fetch
let envS: unknown[] | undefined
// The insights module's way in (src/insights.ts): emit, and what it adds to $pageleave (l) and to
// the batch's env (h).
const hook: {
  e?: typeof emit
  f?: typeof fp
  v?: string
  l?: () => Ev
  h?: unknown[]
} = {}
let dev = false
let key = ''
let endpoint = ''
let hashRouting = false
let release: string | null = null
// While tracking, what events carry: 'granted' after datacub.consent.grant(), 'not_required' when it
// started at init. Tracking is on exactly while anon is set (begin() to revoke()).
let state: 'pending' | 'granted' | 'not_required' | 'denied' = 'pending'
let gpc = false
let cookies = false
// Cookie names carry part of the project key (FD-65): one key shares one visitor and session across
// every subdomain of its site; another key on the same site gets its own, never the same anon_id.
let ns = ''
let domain = ''
let anon = ''
let user: string | null = null
let account: string | null = null
let pendingUser: [string, string | null, Ev] | null = null
let sid = ''
let sStart = 0
let sLast = 0
// what the datacub_ss cookie held at the last sync()
let ssId: string | undefined
let ssLast = 0
let pageId = ''
let page: Url | null = null
let seq = 0
let visibleFrom = 0
let visibleMs = 0
let maxBottom = 0
let vp = ''
let left = true
let routeTimer: ReturnType<typeof setTimeout> | undefined
let lastActivity = 0
// Serialised once at emit, with its UTF-8 byte count: batching never stringifies an event again.
let queue: [string, number][] = []
let sendTimer: ReturnType<typeof setTimeout> | undefined
let soon = false
let raw = ''
let inflight = false
let attempts = 0
let stopped = false
// Events the SDK discarded (queue overflow, over-size); sent as the batch's dropped count.
let lost = 0
const early: [Fn, unknown[]][] = []

const now = Date.now

// Development hosts only; production stays quiet.
function warn(msg: string) {
  // biome-ignore lint/suspicious/noConsole: development hosts only
  if (dev) console.warn(`[datacub] ${msg}`)
}

// Every entry point is wrapped: an SDK fault must never reach the host page.
const guard =
  <F extends Fn>(f: F) =>
  (...a: Parameters<F>) => {
    try {
      f(...a)
    } catch {}
  }

// capture phase; none of these events can be cancelled in a way that blocks scrolling
const on = (t: EventTarget, type: string, f: (e: Event) => unknown) =>
  t.addEventListener(type, guard(f), true)

// ---- ids: crypto only; without it the SDK does not start.
// v4 for anon_id (no creation time in the cookie), v7 for time-ordered session, page and event ids.
function uuid(v7?: number): string {
  const b = crypto.getRandomValues(new Uint8Array(16))
  for (let i = 5, t = v7 as number; v7 && i >= 0; i--, t = Math.floor(t / 256)) b[i] = t & 255
  b[6] = ((b[6] as number) & 15) | (v7 ? 0x70 : 0x40)
  b[8] = ((b[8] as number) & 63) | 128
  const h = Array.from(b, (x) => (x + 256).toString(16).slice(1)).join('')
  return h.replace(/(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-')
}

// ---- first-party cookies (cookies only; memory when the browser refuses them)

// document.cookie throws in sandboxed iframes and some privacy modes: then nothing persists.
// One document.cookie read per event: sync() passes the jar it already has.
function jar(): Record<string, string> {
  const o: Record<string, string> = {}
  try {
    for (const c of d.cookie.split('; ')) {
      const i = c.indexOf('=')
      const n = c.slice(0, i)
      // the opt-out is shared by every key on the site, as the more protective reading
      if (n === 'datacub_optout' || (ns && n.endsWith(ns)))
        o[n === 'datacub_optout' ? n : n.slice(0, -ns.length)] = decodeURIComponent(c.slice(i + 1))
    }
  } catch {}
  return o
}

function setCookie(name: string, value: string | null, dom = domain, age = value ? YEAR : 0) {
  try {
    d.cookie = `${name === 'datacub_optout' ? name : name + ns}=${encodeURIComponent(value || '')};Path=/;Max-Age=${age};SameSite=Lax${dom}${location.protocol === 'https:' ? ';Secure' : ''}`
  } catch {}
}

// Every Domain= candidate, longest first. A revoke clears all of them; the shortest one the browser
// accepts is the eTLD+1 (public suffixes such as com.sa are refused).
function domains() {
  const h = location.hostname.split('.')
  return /^[\d.]+$|:/.test(location.hostname)
    ? []
    : h.slice(0, -1).map((_, i) => `;Domain=${h.slice(i).join('.')}`)
}

// Shared state other tabs may have changed: identify, reset and cookie clearing apply everywhere.
function sync() {
  if (!cookies) return
  const j = jar()
  const a = j.datacub_id ?? null
  // Another tab reset, or the user cleared cookies: a new anon_id never continues the old session.
  if (a !== anon) {
    anon = a && UUID.test(a) ? a : uuid()
    setCookie('datacub_id', anon)
    sid = ''
  }
  user = j.datacub_u ?? null
  account = j.datacub_a ?? null
  // Another tab's session wins; the same session keeps whichever last activity is newer.
  const [id, s, l] = (j.datacub_ss || '').split('.')
  ssId = id
  ssLast = +(l as string)
  if (id && UUID.test(id) && ssLast && (id !== sid || ssLast > sLast)) {
    sid = id
    sStart = +(s as string)
    sLast = ssLast
  }
}

// Session rules: 30 minutes idle, 24 hours maximum, no split at midnight.
function session(t: number, extend: boolean) {
  if (!sid || t - sLast > IDLE || t - sStart > DAY) {
    sid = uuid(now())
    sStart = sLast = t
    if (cookies) setCookie('datacub_id', anon) // refresh the 400-day cap once per session
  } else if (extend && t > sLast) sLast = t
  // Rewritten only for a new session or 5 s of new activity, because in Chromium a cookie
  // write makes the next document.cookie read a synchronous IPC (about 1 ms at 4x CPU, per event).
  // Other tabs and the cookie's expiry can lag this tab by up to 5 s, the same step as activity.
  if (cookies && (ssId !== sid || sLast - ssLast > 5000))
    setCookie('datacub_ss', `${sid}.${sStart}.${sLast}`, domain, IDLE / 1000)
}

// ---- events: the compact wire format. Positional arrays and short $ keys; the ingestion server
// expands them before checking the envelope.

// One send timer at a time: a new one replaces the old, none when ms is left out. soon marks the
// 0 ms one.
function later(ms?: number) {
  clearTimeout(sendTimer)
  soon = ms === 0
  sendTimer = ms == null ? undefined : setTimeout(guard(send), ms)
}

function schedule(urgent?: boolean) {
  // Urgent events, full batches and anything left while the page is hidden go in their own task, so
  // no call pays for a send. A page that closes first still flushes them through exit().
  // During a backoff (attempts > 0) nothing preempts the retry timer, so an outage is not a storm.
  if ((urgent || queue.length > 19 || d.visibilityState === 'hidden') && !soon && !attempts) {
    later(0)
  } else if (!sendTimer) later(5000)
}

// not Blob: new Blob() per event costs about 1 ms at 4x CPU (measured)
const enc = new TextEncoder()

// context: a pageview's [utm, click_id_type, referrer_host]
function emit(event: string, properties: Ev, context?: unknown, urgent?: boolean) {
  if (!anon) return
  const t = now()
  sync()
  // what the page does by itself, or reports at leave, is not activity
  session(t, !/^\$(?:pageleave|error|request|form_fields)$/.test(event))
  if (tally.n) properties = { ...properties, $d: tally.n }
  const j = JSON.stringify([
    uuid(t),
    event,
    t,
    anon,
    user,
    account,
    sid,
    pageId || null,
    seq++,
    +(state === 'granted'),
    +cookies,
    page?.url,
    vp,
    properties,
    context,
  ])
  const n = enc.encode(j).length
  // 32 KB per event, checked by capture on the expanded event: 31,000 compact bytes leaves
  // room for the field names and the path it adds. An over-size event is dropped whole and counted.
  if (n > 31e3) {
    lost++
    return
  }
  tally.n = 0
  queue.push([j, n])
  cap()
  schedule(urgent)
}

function track(name: string, props?: Properties) {
  if (!anon || typeof name !== 'string') return
  const n = eventName(name)
  if (!n) return warn('bad name')
  emit(
    n,
    (props && typeof props === 'object' && !Array.isArray(props) && (clean(props) as Ev)) || {},
  )
}

// ---- pages

// visibleFrom is 0 while the page is hidden, so only foreground time counts.
function visible(t = now()) {
  if (visibleFrom) visibleMs += t - visibleFrom
  visibleFrom = d.visibilityState === 'visible' ? t : 0
}

// Window sizes are read only here (start, pageviews, page scroll, resize), never inside an event:
// on mobile Chromium innerWidth forces a layout when the page has pending changes.
const scrolled = () => {
  vw = innerWidth
  vh = innerHeight
  vp = vw < 360 ? 'xs' : vw < 480 ? 's' : vw < 768 ? 'm' : vw < 1280 ? 'l' : 'xl'
  maxBottom = Math.max(maxBottom, scrollY + vh)
}

// A per-page budget: true while fewer than max of kind k were sent on this page.
function fits(k: string, max: number) {
  room[k] = (room[k] || 0) + 1
  return room[k] <= max
}

// First hide, route change or close. A page shown again and hidden later sends another $pageleave
// with only the new visible time ($returned), so time after coming back to a tab is not lost.
function leave() {
  if (!pageId) return
  visible()
  const v = visibleMs - sentMs
  if (left && v < 1) return
  const h = d.documentElement.scrollHeight
  // capture copies page_id into $closes_page_id
  const p: Ev = {
    $v: v,
    // deepest point reached as a share of the document height; capture rounds it to 10% steps
    $s: h ? maxBottom / h : null,
  }
  if (left) p.$e = true
  if (errN) p.$ec = errN
  if (rqN) p.$rq = rqN
  if (rfN) p.$rf = rfN
  errN = rqN = rfN = 0
  try {
    Object.assign(p, hook.l?.())
  } catch {}
  left = true
  sentMs = visibleMs
  emit('$pageleave', p)
}

function pageview(restored?: boolean, initial?: boolean) {
  if (!anon) return
  // Routers often call pushState or replaceState without a real route change: dedupe on the raw path
  // (kept in memory, never sent), so /product/1 to /product/2 still counts though both clean the same.
  const r = location.pathname + (hashRouting ? location.hash.split('?')[0] : '')
  if (!restored && r === raw) return
  const next = cleanUrl(location.href, hashRouting, opt.query !== false)
  if (!next) return
  raw = r
  leave()
  const props: Ev = {}
  if (page) props.$p = page.path
  if (restored && !initial) props.$b = true
  // how the visit got here: the navigation entry's type at load, the History call after
  props.$N = initial
    ? (performance.getEntriesByType?.('navigation')[0] as { type?: string } | undefined)?.type
    : restored
      ? 'back_forward'
      : navK
  if (next.q) props.$q = next.q
  if (opt.title !== false && d.title) props.$T = label(d.title, 200)
  page = next
  pageId = uuid(now())
  left = false
  visibleMs = maxBottom = visibleFrom = sentMs = 0
  room = {}
  seen.clear()
  visible()
  scrolled()
  props.$vw = vw
  props.$vh = vh
  // the referrer host and path, only on the initial pageview
  let ref: string | null = null
  if (initial)
    try {
      const u = new URL(d.referrer)
      ref = u.hostname
      props.$R = cleanUrl(u.href)?.path
    } catch {}
  emit('$pageview', props, [next.utm, next.click_id_type, ref], initial)
}

const route = (k: string) => () => {
  // routers often replaceState right after pushState: the visit still got there by a push
  if (!(routeTimer && k === 'replace' && navK === 'push')) navK = k
  dead?.()
  clearTimeout(routeTimer)
  // Let the router finish updating the URL first.
  routeTimer = setTimeout(
    guard(() => {
      routeTimer = undefined
      pageview()
    }),
    100,
  )
}

// ---- autocapture: an allowlist; never text, values or other attributes

const named = (el: Element) => {
  const v = el.closest('[data-datacub-name]')?.getAttribute('data-datacub-name')
  return v ? text(v, 100) : null
}

// Rage click: the browser's own click count (MouseEvent.detail) reaching 3 is the burst,
// so one event per burst, no state per click and no layout read. Keyboard and script clicks have detail 0.
let rage = true

// Element chain, root first, up to 10 levels: tag, a stable id, nth-of-type and
// data-datacub-name. Generated ids (digit or hex runs, framework prefixes) are left out.
function sig(n: Element | null) {
  let s = ''
  for (let i = 0; n && i < 10 && n !== d.body; i++, n = n.parentElement) {
    let j = 1
    for (let m = n.previousElementSibling; m; m = m.previousElementSibling)
      if (m.localName === n.localName) j++
    const id = n.id
    const nm = n.getAttribute('data-datacub-name')
    s = `${n.localName}${id && !/\d{4}|[\da-f]{8}|^:|radix-|headlessui-|mui-|ember\d|react-select/i.test(id) ? `#${label(id, 64)}` : ''}${j > 1 ? `:${j}` : ''}${nm ? `[${label(nm, 64)}]` : ''}${s && '>'}${s}`
  }
  return s.slice(-512)
}

// A label is short: an element whose text is over 100 characters is a container (a card, a list
// row), so its aria-label, title or image alt is used instead of what it shows.
// An element that holds a field, an editable area or a no-capture region gives only its labels:
// its text would carry what someone typed (a controlled textarea) or what the site masked.
function said(el: Element) {
  const s = el.querySelector(`input,textarea,select,[contenteditable],${NO_CAPTURE}`)
    ? ''
    : (el.textContent || '').replace(/\s+/g, ' ').trim()
  return (
    label(
      s && s.length < 101
        ? s
        : el.getAttribute('aria-label') ||
            el.getAttribute('title') ||
            el.querySelector('img')?.getAttribute('alt') ||
            '',
      100,
    ) || undefined
  )
}

// Dead click: nothing reacted within 1 s (no DOM change, focus move, scroll or route change, no
// link or form navigation started). A newer click replaces the pending check.
function arm(p: Ev, e: Event) {
  dead?.()
  sub = undefined
  const a = d.activeElement
  const o = new MutationObserver(() => dead?.())
  const tm = setTimeout(
    guard(() => {
      dead?.()
      const link = (e.target as Element).closest(
        'a[href]:not([href^="javascript:"]):not([href^="#"])',
      )
      if (
        d.activeElement === a &&
        !(link && !e.defaultPrevented) &&
        !(sub && !sub.defaultPrevented)
      )
        emit('$deadclick', p)
    }),
    1000,
  )
  dead = () => {
    o.disconnect()
    clearTimeout(tm)
    dead = undefined
  }
  o.observe(d, { subtree: true, childList: true, attributes: true, characterData: true })
}

function onClick(e: Event) {
  const t = e.target
  const m = e as MouseEvent
  if (
    !anon ||
    !(t instanceof Element) ||
    t.closest(
      `${NO_CAPTURE},input:not([type=submit]):not([type=button]),textarea,select,[contenteditable]:not([contenteditable=false])`,
    )
  )
    return
  const el = t.closest(
    'a,button,summary,input,[data-datacub-name],[role=button],[role=link],[role=menuitem],[role=tab]',
  )
  // something that looks clickable without being a control: dead and rage clicks only
  const ptr =
    !el && !/^(?:canvas|video)$/.test(t.localName) && getComputedStyle(t).cursor === 'pointer'
  const at = el || t
  const p: Ev = { $t: at.localName, $n: named(t), $g: sig(at) }
  if (at.closest('form')) p.$o = true
  // where, as a share of the window; keyboard and script clicks (detail 0) have no position
  if (m.detail) {
    p.$cx = Math.round((m.clientX / vw) * 100)
    p.$cy = Math.round((m.clientY / vh) * 100)
  }
  if ((el || ptr) && opt.text !== false) p.$l = said(at)
  if (el) {
    const role = el.getAttribute('role')
    if (role && /^(?:button|link|menuitem|tab)$/.test(role)) p.$r = role
    if (el.localName === 'input') p.$y = (el as HTMLInputElement).type
    // Link target: the clean URL; capture keeps the path for same-site links, host and path for
    // others, the scheme only for tel: and mailto:.
    if (el.localName === 'a' && el.hasAttribute('href'))
      p.$h = cleanUrl((el as HTMLAnchorElement).href)?.url
    emit('$click', p)
  }
  // a triple click that selected the element's own text is reading, not rage (on an empty element
  // the browser may select the text next to it, which says nothing)
  if (rage && m.detail === 3 && !(at.textContent?.trim() && getSelection()?.isCollapsed === false))
    emit('$rageclick', { ...p })
  if (
    (el || ptr) &&
    !m.metaKey &&
    !m.ctrlKey &&
    !m.shiftKey &&
    !at.closest('[target=_blank],[download]')
  )
    arm(p, e)
}

// A form's name, action and size: never a field name or value. getAttribute, not f.action: a field
// named "action" shadows the property.
const fp = (f: Element): Ev => ({
  $f: named(f),
  $a: cleanUrl(new URL(f.getAttribute('action') || '', location.href).href)?.url,
  $i: f.querySelectorAll('input,select,textarea').length,
})

// A submit attempt, never proof that the action succeeded.
function onSubmit(e: Event) {
  const f = e.target as Element
  sub = e
  if (!anon || f.localName !== 'form' || f.closest(NO_CAPTURE)) return
  emit('$form_submit', fp(f))
}

// The form a field event belongs to, when forms are captured.
const form = (e: Event) => {
  const f = (e.target as HTMLInputElement).form
  return anon && f && opt.forms !== false && !f.closest(NO_CAPTURE) ? f : null
}

// The first input into a form starts it; abandonment is a start without a submit (server side).
const begun = new WeakSet<Element>()
function onInput(e: Event) {
  dead?.() // a field changed: the click before it was not dead (a label that toggles a checkbox)
  const f = form(e)
  if (f && !begun.has(f)) {
    begun.add(f)
    emit('$form_start', fp(f))
  }
}

// The browser's own validation stopped a submit: one event per form per attempt with the number of
// invalid fields, never which ones. At most 10 a page (some code calls checkValidity() often).
const bad = new Map<Element, number>()
function onInvalid(e: Event) {
  // the browser's validation message is a reaction: the click on submit was not dead
  dead?.()
  const f = form(e)
  if (!f) return
  const n = bad.get(f) || 0
  bad.set(f, n + 1)
  if (!n)
    setTimeout(
      guard(() => {
        if (fits('i', 10)) emit('$form_invalid', { ...fp(f), $iv: bad.get(f) })
        bad.delete(f)
      }),
    )
}

// ---- errors and requests: what failed on the page, never what was typed or returned

// URLs inside a message or stack: origin and path only (query and fragment cut), :line:col kept.
const urls = (s: string) =>
  s.replace(/https?:\/\/[^\s'"<>()]+/g, (v) => {
    const lc = /(?::\d+){1,2}$/.exec(v)?.[0] || ''
    return (cleanUrl(v.slice(0, v.length - lc.length))?.url ?? '') + lc
  })

// One event per distinct error per page (at most 20); every occurrence counts in $error_count.
function err(k: string, x: unknown, m?: unknown, u?: unknown, tag?: string) {
  const own = `${u}`.startsWith(endpoint.slice(0, -5))
  if (!anon || opt.errors === false || (k === 'resource' && (!tag || own))) return
  errN++
  const o = (x && typeof x === 'object' ? x : {}) as {
    name?: unknown
    message?: unknown
    stack?: unknown
  }
  const msg = label(
    // double-quoted text in a message is usually echoed input (JSON.parse, new URL)
    urls(`${o.message ?? m ?? (x && x !== o ? x : '')}`).replace(
      /(["'“”«»‘’])[^"'“”«»‘’]*["'“”«»‘’]/g,
      '"…"',
    ),
    200,
  )
  const st =
    typeof o.stack === 'string'
      ? label(
          urls(
            o.stack
              .split('\n')
              .filter((l) => /:\d+:\d+/.test(l))
              .slice(0, 5)
              // Firefox and Safari write frames as fn@url, which reads as an email address
              .map((l) => l.trim().replace(/@(?=https?:)/, ' '))
              .join('\n'),
          ),
          1000,
        )
      : undefined
  const id = `${k}${o.name}${msg}${st?.split('\n')[0]}${u}`
  if (seen.has(id) || !fits('e', 20)) return
  seen.add(id)
  emit('$error', {
    $ek: k,
    $en: typeof o.name === 'string' ? label(o.name, 64) : undefined,
    $em: msg || undefined,
    $es: st || undefined,
    $eu: u ? cleanUrl(`${u}`)?.url : undefined, // http(s) only: a data: URL never leaves
    $et: tag,
  })
}

// A fetch or XHR finished: counted; sent when it failed, was aborted or took 3 s or more (at most
// 30 a page). datacub's own requests are left out. The URL keeps origin and path, never the query.
function net(m: unknown, u: string, s: number, t: number, n?: string) {
  if (!anon || opt.network === false) return
  const url = new URL(u, location.href).href
  if (url.startsWith(endpoint.slice(0, -5))) return
  rqN++
  const ms = now() - t
  const k =
    n === 'AbortError'
      ? 'abort'
      : n
        ? 'network_error'
        : s > 399
          ? 'http_error'
          : ms > 2999 && 'slow'
  if (!k) return
  if (k !== 'slow' && k !== 'abort') rfN++
  if (fits('r', 30))
    emit('$request', {
      $nm: `${m}`.toUpperCase().slice(0, 10),
      $nu: cleanUrl(url)?.url,
      $ns: s,
      $nd: ms,
      $nk: k,
    })
}
const nt = guard(net)

// ---- delivery: batched, bounded, at least once, idempotent by event uuid

// Bounded memory: past 1,000 queued events the oldest go, and are counted.
function cap() {
  const over = queue.length - 1000
  if (over > 0) lost += queue.splice(0, over).length
}

// The events are already JSON. 0 dropped is sent as 0.
// The device, once per batch: screen, pixel ratio, time zone, cores, memory,
// touch, pointer, colour scheme, reduced motion; then the connection, read each time, the device
// model and OS version (from the insights module), and the offset from UTC. Read at the first send,
// never during init. The IANA zone is left to the server (from the IP's location): reading it here
// costs about 50 ms of Intl on a slow phone, a long task on every page load.
// undefined and NaN are sent as null: the browser does not say.
function env() {
  if (!envS)
    try {
      const mm = (q: string) => +matchMedia(`(${q})`).matches
      const n = navigator as Navigator & { deviceMemory?: number }
      envS = [
        screen.width,
        screen.height,
        Math.round(devicePixelRatio * 100) / 100,
        null, // the IANA zone: the server's, from the IP's location
        n.hardwareConcurrency,
        n.deviceMemory,
        n.maxTouchPoints,
        mm('pointer:coarse') ? 'c' : 'f',
        mm('prefers-color-scheme:dark') ? 'd' : 'l',
        mm('prefers-reduced-motion:reduce'),
      ]
    } catch {
      // keep the positions: the connection and model fields after it must not shift
      envS = Array(10)
    }
  const c = (navigator as { connection?: Record<string, never> }).connection || {}
  const h = hook.h || []
  const e = [
    ...envS,
    c.effectiveType,
    c.rtt,
    c.downlink,
    +(c.saveData as unknown as number),
    h[0],
    h[1],
    -new Date().getTimezoneOffset(),
  ]
  return e
}

const body = (events: [string, number][], dropped: number) =>
  `${JSON.stringify([3, key, now(), VERSION, dropped, release, navigator.language, !!navigator.webdriver, env()]).slice(0, -1)},${events.map((e) => e[0])}]`

// Takes events from the front of the queue while the body stays under max bytes (at least one).
function take(max: number) {
  let n = 0
  let bytes = 200
  while (n < queue.length && n < 100) {
    bytes += (queue[n] as [string, number])[1] + 1
    if (bytes > max) break
    n++
  }
  return queue.splice(0, n || 1)
}

// Never rejects: every path is inside the try.
// A send asked for while one is in flight (an urgent $identify, a full batch) goes as soon as it ends,
// not on the 5 s timer.
let again = false

async function send() {
  later()
  if (inflight) again = true
  if (inflight || stopped || !queue.length || !navigator.onLine) return
  inflight = true
  const batch = take(30720)
  const dropped = lost
  lost = 0
  let wait = 0
  try {
    const res = await F(endpoint, {
      method: 'POST',
      body: body(batch, dropped),
      keepalive: true,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
    const s = res.status
    // Bad key, origin not allowed, project suspended or in review: stop for this page, keep nothing.
    if (s === 401 || s === 403) {
      stopped = true
      queue = []
    } else if (s === 429 || s > 499)
      wait = Math.min(+(res.headers.get('Retry-After') || 0), 3600) * 1000 || -1
    else {
      attempts = 0
      // a 4xx a retry cannot fix: the events are gone, so they are counted
      if (s > 299) lost += batch.length + dropped
      // a deleted browser starts over, never linked to the deleted history
      else if (
        ((await res.json().catch(() => 0)) as { directives?: string[] }).directives?.includes(
          'rotate_anon_id',
        )
      )
        reset()
    }
  } catch {
    wait = -1 // network failure
  }
  inflight = false
  try {
    // Never re-queue after a revoke: those events must not leave later.
    if (wait && anon) {
      // Same events, same uuids: the server deduplicates. Full-jitter backoff from 1 s to 5 minutes;
      // after 10 failures in a row, retry only when new events arrive.
      queue = batch.concat(queue)
      lost += dropped
      cap()
      if (++attempts < 11)
        later(wait > 0 ? wait : Math.random() * Math.min(1000 * 2 ** attempts, 3e5))
    } else if (queue.length) schedule(again)
    again = false
  } catch {}
}

// Page hidden or leaving: queued events go out in keepalive fetches, in chunks. Not sendBeacon where
// keepalive works: a beacon always carries the site's cookies and its full page URL as Referer, which a
// same-origin proxy would pass on. Beacons and keepalive requests share one 64 KiB in-flight quota per
// page; what does not fit stays queued and retries through send(). A page that is killed at that
// moment loses it: a browser limit.
function exit() {
  dead?.()
  leave()
  later()
  if (typeof Request === 'function' && 'keepalive' in Request.prototype) {
    // While a send() is in flight it keeps going after the page closes, and WebKit refuses a second
    // keepalive request beside it: the rest waits for it and leaves in the next batch.
    let room = inflight ? 0 : 61440
    while (queue.length && !stopped && room > 2048) {
      const batch = take(room)
      const dropped = lost
      const b = body(batch, dropped)
      room -= b.length
      lost = 0
      // refused (quota full) or failed: back in the queue with its drop count; the server
      // deduplicates a repeat
      const back = () => {
        queue = batch.concat(queue)
        lost += dropped
        later(1000)
      }
      try {
        F(endpoint, {
          method: 'POST',
          body: b,
          keepalive: true,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        }).catch(back)
      } catch {
        back()
        break
      }
    }
  } else {
    let max = 61440
    while (queue.length && !stopped && navigator.sendBeacon) {
      const batch = take(max)
      if (navigator.sendBeacon(endpoint, body(batch, lost))) lost = 0
      else {
        // Refused: the quota left after an in-flight send is smaller. Halve until one event is refused.
        queue = batch.concat(queue)
        if (batch.length < 2) break
        max /= 2
      }
    }
  }
  if (queue.length) later(1000)
}

// ---- consent: tracking starts at init unless requireConsent; then nothing is
// captured or buffered before grant. A revoke is remembered on the device (datacub_optout) either way.

// o: the options of a grant; none when tracking starts at init
function begin(o?: GrantOptions) {
  state = o ? 'granted' : 'not_required'
  for (const dom of domains().reverse()) {
    setCookie('datacub_tld', '1', dom, 9)
    if (jar().datacub_tld) {
      setCookie('datacub_tld', '', dom)
      domain = dom
      break
    }
  }
  const stored = jar().datacub_id
  anon = stored && UUID.test(stored) ? stored : uuid()
  setCookie('datacub_id', anon)
  cookies = jar().datacub_id === anon
  if (o) {
    // an opt-out written at page load is host-only; one written later is on the site's domain
    for (const dom of ['', domain]) setCookie('datacub_optout', '', dom)
    // capture adds $state granted and the purposes
    emit('$consent', {
      $m: /^(?:banner|settings|api|cmp)$/.test(`${o.method}`) ? o.method : 'api',
      $P: typeof o.policyVersion === 'string' ? text(o.policyVersion, 64) : null,
    })
  }
  if (pendingUser) setUser(...pendingUser)
  pendingUser = null
  pageview(true, true)
  // the insights module, once, after tracking began: low priority, never blocking the page
  if (insights && !hook.v) {
    hook.v = VERSION
    // the module's field summaries obey capture.forms like the core's form events
    hook.e = (n, p) => n === '$form_fields' && opt.forms !== false && emit(n, p)
    hook.f = fp
    ;(window as { __datacub?: unknown }).__datacub = hook
    // on its own: a page whose CSP enforces Trusted Types refuses a plain script URL, and that must
    // not stop tracking (the module's signals are then simply absent)
    try {
      const s = d.createElement('script')
      s.src = `${endpoint.slice(0, -5)}sdk/insights-${VERSION}.min.js`
      s.async = true
      s.referrerPolicy = 'no-referrer'
      // the module must be the exact file published with this version, wherever it is served from
      if (__INSIGHTS_SRI__) {
        s.integrity = __INSIGHTS_SRI__
        s.crossOrigin = 'anonymous'
      }
      s.setAttribute('fetchpriority', 'low')
      ;(d.head || d.documentElement).append(s)
    } catch {}
  }
}

function grant(o: GrantOptions = {}) {
  if (!anon && (!gpc || o.overrideGPC)) begin(o)
}

function revoke() {
  state = 'denied'
  later()
  queue = []
  for (const n of COOKIES) for (const dom of ['', ...domains()]) setCookie(n, '', dom)
  anon = sid = pageId = ''
  user = account = pendingUser = page = null
  cookies = false
  // remembered on the device, so the next page load does not start tracking again
  setCookie('datacub_optout', '1')
}

// ---- identity

function setUser(id: string, acct: string | null, t: Ev) {
  sync()
  if (user && user !== id) reset() // user switch: never link two users
  if (acct !== account && cookies) setCookie('datacub_a', acct)
  account = acct
  // the same user: traits alone, as $set, never a second $identify. Not deduplicated:
  // pass traits when they change (login, profile edit), not on every page load
  if (user !== id) {
    user = id
    if (cookies) setCookie('datacub_u', id)
    t.$A = anon
  }
  for (const _ in t) return emit(t.$A ? '$identify' : '$set', t, 0, true)
}

// email, name and phone are what the customer's code passes on purpose: sent as given,
// normalised and checked on the server, never an identity key. Other traits get track()'s floor.
// identify(id, traits) or identify({ id, ...traits }), the id also as userId or user_id. Every other
// key is a trait on the person's profile; fullName and phoneNumber count as name and phone.
function identify(userId: unknown, o?: IdentifyOptions) {
  if (userId && typeof userId === 'object') {
    o = userId as IdentifyOptions
    userId = o.id ?? o.userId ?? o.user_id
  }
  const own = [anon, sid, pageId]
  const id = validId(userId, own)
  const acct = o?.account == null ? null : validId(o.account, own)
  if (!id || (o?.account != null && !acct)) return warn('bad id')
  const t = ((o && clean(o)) || {}) as Ev
  // the ids are not traits; the floor redacted email, name and phone (also fullName, phone_number)
  // in t, so their raw values go under $email, $name and $phone instead
  for (const k in t) {
    const m = /^(?:account|id|user_?id|(email)|(?:full_?)?(name)|(phone)(?:_?number)?)$/i.exec(k)
    if (m) {
      const n = m[1] || m[2] || m[3]
      if (n) t[`$${n.toLowerCase()}`] = (o as Ev)[k]
      delete t[k]
    }
  }
  if (anon) setUser(id, acct, t)
  else if (state === 'pending') pendingUser = [id, acct, t]
}

// Logout: new anon_id and session, user and account forgotten. The old identity's queued events keep
// the IDs they were stamped with.
function reset() {
  pendingUser = null
  if (!anon) return
  send()
  anon = uuid()
  user = account = null
  sid = ''
  if (cookies) {
    setCookie('datacub_id', anon)
    for (const n of COOKIES.slice(1)) setCookie(n, '')
  }
}

// ---- lifecycle

function start(publicKey: unknown, o: InitOptions = {}) {
  dev = /^(?:localhost|127\.0\.0\.1|\[::1\])$|\.(?:localhost|test)$/.test(location.hostname)
  if (started || typeof publicKey !== 'string') return
  // A secret key in a browser is a leaked credential: refused loudly, in every environment.
  // biome-ignore lint/suspicious/noConsole: the one message production ever prints
  if (/^sk_/.test(publicKey)) return console.error('[datacub] refused a secret key. Use a pk_ key.')
  // The default is datacub's hosted ingestion; a first-party proxy path or another origin goes in apiHost.
  // https, or http on localhost; a path such as /datacub is resolved against the page. No user info:
  // http://127.0.0.1@evil.example is evil.example.
  let u: URL | undefined
  try {
    u = new URL(o.apiHost || 'https://in.datacub.to', location.href)
  } catch {}
  if (!/^pk_(?:live|test)_[A-Za-z0-9]{24,48}$/.test(publicKey)) return warn('init: bad key')
  if (
    !u ||
    u.username ||
    u.password ||
    !(
      u.protocol === 'https:' ||
      (u.protocol === 'http:' && /^(?:localhost|127\.0\.0\.1)$/.test(u.hostname))
    )
  )
    return warn('init: bad apiHost')
  started = true
  key = publicKey
  ns = `_${publicKey.slice(8, 16)}`
  endpoint = `${u.origin}${u.pathname.replace(/\/+$/, '')}/v1/batch`
  hashRouting = o.hashRouting === true
  // developer config, not user data: a git SHA or deployment ID must not be scrubbed
  release = typeof o.release === 'string' && !badText(o.release) ? o.release.slice(0, 64) : null
  opt = (o.capture && typeof o.capture === 'object' && o.capture) || {}
  insights = o.insights !== false
  F = fetch
  // Global Privacy Control counts as a revoke, as does an earlier revoke.
  gpc = (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl === true
  if (gpc || jar().datacub_optout) revoke()
  else if (!o.requireConsent) begin()
  rage = o.rageClicks !== false
  if (o.autocapture !== false) {
    on(d, 'click', onClick)
    on(d, 'submit', onSubmit)
    on(d, 'input', onInput)
    on(d, 'invalid', onInvalid)
  }
  // Input keeps the session alive while the page is visible; it sends nothing.
  // pointerdown covers touch. Only a page scroll moves the scroll depth, so key and pointer input
  // never read layout.
  for (const type of ['pointerdown', 'keydown', 'scroll'])
    on(d, type, (e) => {
      const t = now()
      if (e.target === d) scrolled()
      if (type === 'scroll') dead?.()
      if (sid && d.visibilityState === 'visible' && t - lastActivity > 5000) {
        lastActivity = t
        sync()
        session(t, true)
      }
    })
  on(d, 'visibilitychange', () => {
    visible()
    if (d.visibilityState === 'hidden') exit()
  })
  scrolled()
  on(window, 'resize', scrolled)
  on(window, 'pagehide', exit)
  on(window, 'pageshow', (e) => (e as PageTransitionEvent).persisted && pageview(true))
  on(window, 'online', send)
  on(window, 'popstate', route('pop'))
  on(window, 'hashchange', route('hash'))
  // Wraps the History API; the original runs first and its result or error is untouched.
  for (const m of ['pushState', 'replaceState'] as const) {
    const original = history[m]
    history[m] = function (this: History, ...a: Parameters<History['pushState']>) {
      original.apply(this, a)
      route(m === 'pushState' ? 'push' : 'replace')()
    }
  }
  // Last, and on their own: an environment without one of these APIs must not stop the rest of init.
  try {
    // Errors: a script error, an unhandled rejection, or (capture phase only) a failed image, script
    // or style sheet, whose event has no message.
    on(window, 'error', (e) =>
      e instanceof ErrorEvent
        ? err('js', e.error, e.message, e.filename)
        : err(
            'resource',
            0,
            '',
            (e.target as { src?: string; href?: string }).src ||
              (e.target as { href?: string }).href,
            (e.target as Element).localName,
          ),
    )
    on(window, 'unhandledrejection', (e) => err('rejection', (e as PromiseRejectionEvent).reason))
    // Requests: fetch and XMLHttpRequest wrapped; the original runs first and its result, error and
    // timing are untouched. The SDK's own sends use the original fetch.
    window.fetch = function (this: unknown, ...a: Parameters<typeof fetch>) {
      const p = F.apply(this, a)
      try {
        const t = now()
        const i = a[0] as Request
        const u = `${i.url || i}`
        const m = a[1]?.method || i.method || 'GET'
        // the observed chain is returned, so a failure nobody handles still reaches the page's own
        // unhandledrejection listeners (its error tracker) exactly as without the SDK
        return p.then(
          (r) => {
            // a polyfill or test double may resolve to something that is not a Response
            try {
              nt(m, r.url || u, r.type === 'opaque' ? 200 : r.status, t)
            } catch {}
            return r
          },
          (x) => {
            nt(m, u, 0, t, (x as Error)?.name || 'Error')
            throw x
          },
        )
      } catch {}
      return p
    } as typeof fetch
    const X = XMLHttpRequest.prototype as XMLHttpRequest & { _x?: unknown[]; _t?: number }
    const xo = X.open
    const xs = X.send
    X.open = function (this: typeof X, ...a: unknown[]) {
      this._x = a
      return (xo as Fn).apply(this, a as never[])
    } as typeof X.open
    X.send = function (this: typeof X, ...a: unknown[]) {
      // once per object: a reused XHR (polling) must not count each request again
      if (this._x && !this._t)
        for (const ev of ['load', 'error', 'abort', 'timeout'])
          on(this, ev, () =>
            net(
              this._x?.[0],
              `${this._x?.[1]}`,
              this.status,
              this._t as number,
              ev === 'load' ? '' : ev === 'abort' ? 'AbortError' : 'TypeError',
            ),
          )
      this._t = now()
      return (xs as Fn).apply(this, a as never[])
    }
  } catch {}
}

// Calls before init wait (up to 100). On a server (SSR) every call is a no-op and nothing is kept.
// Arguments are untrusted at runtime whatever the types say; each method validates its own.
const api = (f: Fn) =>
  guard((...a: unknown[]) => {
    if (typeof window === 'undefined') return
    if (started) f(...(a as never[]))
    else if (early.length < 100) early.push([f, a])
  })

const datacub: DatacubClient = {
  init: guard((publicKey: string, o?: InitOptions) => {
    if (typeof window === 'undefined' || !globalThis.crypto?.getRandomValues) return
    d = document
    const go = guard(() => {
      start(publicKey, o)
      for (const [f, a] of early.splice(0)) if (started) f(...(a as never[]))
    })
    // A prerendered page is not a visit until it is shown. The start stays synchronous: a router
    // that rewrites the URL right after init (dropping utm_ parameters) must not change the landing
    // pageview.
    if ((d as { prerendering?: boolean }).prerendering) on(d, 'prerenderingchange', go)
    else go()
  }),
  track: api(track),
  identify: api(identify),
  reset: api(reset),
  consent: {
    grant: api(grant),
    revoke: api(revoke),
  },
  // the feedback module's way in (src/feedback.ts): who is here and how to send. The ids are
  // empty until grant() and again after revoke()
  _fb: () => [state, cookies, key, endpoint, anon, user, sid, emit],
}

export default datacub
