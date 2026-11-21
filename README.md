<p align="center">
  <a href="https://datacub.to">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/datacub/web-sdk/main/.github/assets/wordmark-dark.svg">
      <img alt="datacub" src="https://raw.githubusercontent.com/datacub/web-sdk/main/.github/assets/wordmark.svg" height="48">
    </picture>
  </a>
</p>

<p align="center">
  The official datacub SDK for websites.<br>
  Product analytics with automatic capture, identity and consent, in one small script.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@datacub/web"><img alt="npm" src="https://img.shields.io/npm/v/@datacub/web?color=15181d&label=npm"></a>
  <a href="https://github.com/datacub/web-sdk/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/datacub/web-sdk/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://bundlephobia.com/package/@datacub/web"><img alt="gzip size" src="https://img.shields.io/bundlephobia/minzip/@datacub/web?label=gzip&color=15181d"></a>
  <a href="./LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-15181d"></a>
</p>

---

[datacub](https://datacub.to) answers product questions for websites and apps: where people come from, what they do, where they drop off and who comes back. This SDK runs in the browser. It records page views, sessions, clicks and the events you track, removes sensitive data before anything leaves the page, and sends small batches to datacub.

- **Automatic from the first page view.** Page views (single page app routes included), page leaves with time and scroll depth, clicks, rage and dead clicks, form starts and submits, errors and failed requests.
- **Private by construction.** Never form values, passwords, payment data or tokens. The visitor ID is random and device traits are never used to identify anyone. Sensitive values are scrubbed in the browser and again on the server.
- **Small and dependency free.** About 9 KB gzip for the core, no runtime dependencies, safe to import during server-side rendering.
- **Resilient.** Batching, retries with backoff, delivery on page hide, and it never throws into your page.

## Quick start

You need a datacub project. In the dashboard, open **Settings → Integrations** and copy your project key (`pk_live_…`, or `pk_test_…` for `localhost`). In **Settings → General**, add your site's domain to the sites allowed to send.

### Option 1: script tag

Paste this before `</head>`. Tracking starts when the file loads.

```html
<script src="https://in.datacub.to/v1/sdk/datacub-0.3.1.min.js" data-key="pk_live_YOUR_PROJECT_KEY" defer></script>
```

The **Settings → Integrations** page gives you this line with your key already in it.

### Option 2: npm

```sh
npm install @datacub/web
```

```ts
import datacub from '@datacub/web'

datacub.init('pk_live_YOUR_PROJECT_KEY')
```

Call `init` once, as early as possible in client code. Page views, clicks and the rest start at once.

### Send an event and see it

```ts
datacub.track('signup_completed', { plan: 'pro' })
```

Open your project's live view in datacub: the page view and `signup_completed` appear within seconds.

## Usage

### Track events

```ts
datacub.track('invoice_sent', { amount: 1200, currency: 'SAR', items: 3 })
```

Name events in `snake_case` after something that happened. Property values can be strings, numbers, booleans, `null`, dates, arrays and nested objects. In the browser, before anything is sent:

- properties whose **names** look sensitive (`password`, `token`, `cardnumber`, `iban`, `otp` and similar) are dropped;
- **values** that look sensitive become `"[redacted]"`: emails, phone, card, IBAN and ID numbers, tokens and keys, whole numbers of 9 or more digits, token-like runs of 32 or more characters, and strings over 256 characters or 11 words.

Pass times as `Date` objects, not millisecond numbers, which would be redacted.

### Identify signed-in users

```ts
// after login
datacub.identify('user_8412', { account: 'acct_77', email: 'sara@example.sa', name: 'Sara' })

// or with the id inside: datacub.identify({ id: 'user_8412', email: 'sara@example.sa', plan: 'pro' })

// at logout, so the next person on this browser starts fresh
datacub.reset()
```

`identify` links this browser's earlier anonymous activity to the user. `email`, `name` and `phone` are shown on the user's profile and are searchable; they are never used to link two people. `account` is an opaque organisation ID. Any other key becomes a user property. Calling `identify` again for the same user sends only the traits, so pass them at login or when they change.

### Consent

By default tracking starts at once. If your site asks visitors first, turn on **Ask for consent first** in the project settings and initialise with `requireConsent`. Nothing is stored or sent until you grant:

```ts
datacub.init('pk_live_YOUR_PROJECT_KEY', { requireConsent: true })

// in your consent banner's "accept" handler
datacub.consent.grant({ method: 'banner', policyVersion: '2026-11' })
```

With the script tag, add `data-require-consent` to the tag instead. `datacub.consent.revoke()` always works: it deletes the stored IDs and queued events and remembers the choice. Browsers that send [Global Privacy Control](https://globalprivacycontrol.org) are treated as revoked unless the visitor explicitly grants with `overrideGPC: true`.

### Feature flags and experiments

```ts
import { flag, experiment } from '@datacub/web/flags'

if (await flag('new_checkout')) showNewCheckout()

const variant = await experiment('pricing_page') // 'A' or 'B'
```

`flag` resolves to `false` and `experiment` to `'A'` when the flag is off, unknown or cannot be decided (before consent, or offline). Importing the module adds nothing to the core bundle. Script-tag sites load `https://in.datacub.to/v1/flags.js` after the SDK and call `datacub.flag()` and `datacub.experiment()`.

### Feedback widget

Collect in-product answers with the questions you set up in datacub. With npm:

```ts
import datacub from '@datacub/web'
import { start } from '@datacub/web/feedback'

datacub.init('pk_live_YOUR_PROJECT_KEY')
start(datacub)

datacub.feedback?.() // open the "Send feedback" card, for example from a help menu
```

Script-tag sites add `<script src="https://in.datacub.to/v1/feedback.js" async></script>` next to the SDK. The widget runs only while tracking is active, renders inside a shadow root, and sends the answer, the question, your visitor and session IDs and the cleaned page path. Free-text answers are sent as written, so tell people not to enter personal information in your question text.

### Keep a region out

Add `data-datacub-no-capture` (or the class `datacub-no-capture`) to any element. Nothing inside it is captured: no click text, no form details.

```html
<section data-datacub-no-capture>…</section>
```

## API reference

| Call | What it does |
|---|---|
| `datacub.init(publicKey, options?)` | Starts the SDK. Runs once; later calls are ignored |
| `datacub.track(event, properties?)` | Records a custom event |
| `datacub.identify(userId, traits?)` or `datacub.identify({ id, ...traits })` | Links this browser to a signed-in user (the id may also be `userId` or `user_id`; `fullName` and `phoneNumber` count as `name` and `phone`); traits `account`, `email`, `name`, `phone` and custom properties |
| `datacub.reset()` | At logout: a new anonymous ID and session |
| `datacub.consent.grant(options?)` | Records consent (`method`, `policyVersion`, `overrideGPC`) and starts tracking when the project asks for consent |
| `datacub.consent.revoke()` | Stops tracking, deletes stored IDs and queued events, and remembers the choice |
| `flag(key)` from `@datacub/web/flags` | `Promise<boolean>`: is this feature flag on for this visitor |
| `experiment(key)` from `@datacub/web/flags` | `Promise<'A' \| 'B'>`: this visitor's variant; records the exposure |
| `start(datacub)` from `@datacub/web/feedback` | Starts the feedback widget; adds `datacub.feedback()` and `datacub.ask(questionId)` |

### Options

| Option | Default | What it does |
|---|---|---|
| `apiHost` | `https://in.datacub.to` | Where events go: datacub's ingestion host or your own [first-party proxy](#first-party-proxy), as a URL or a path on your site. Must be `https` (or `http://localhost`) |
| `requireConsent` | `false` | Store and send nothing until `datacub.consent.grant()` |
| `autocapture` | `true` | Clicks and form submits. Page views and page leaves are always on |
| `rageClicks` | `true` | Three quick clicks in a row on the same element. Needs `autocapture` |
| `hashRouting` | `false` | Treat `#/route` fragments as pages, for hash routers |
| `release` | none | Your app version or deployment ID, sent with every event |
| `insights` | `true` | Loads the insights module after tracking starts: Web Vitals, long tasks, resource totals, form field details and device model |
| `capture` | all `true` | Turn kinds of capture off on this site: `{ text, title, query, errors, network, forms }` |

TypeScript types ship with the package. For the script tag, download the types for the global `datacub` from `https://in.datacub.to/v1/sdk/datacub-0.3.1.d.ts`, or copy `types/datacub.d.ts` from this package.

## What the SDK collects

Automatically, after `init` (and after `grant` when the project asks for consent):

| Kind | Details |
|---|---|
| Page views and leaves | URL path, templated so IDs become `:id`; page title (scrubbed, up to 200 characters); referrer origin and path; navigation type; viewport size; time on page and scroll depth |
| Clicks | The element's own short visible text (up to 100 characters, scrubbed), a structural signature, the input type for buttons inside forms, the cleaned target URL of links, and the click position as a share of the viewport. Rage clicks and dead clicks |
| URL query values | Only values that look like codes your site put in a link (`?sort=price_desc`). Searches, free text, long values and sensitive keys (`token`, `code`, `password`, `otp`, `session` and others) keep the key with an empty value |
| Forms | Form start, submit attempts, invalid submits, and per field: type, `name` (or `id`) attribute, `autocomplete` token, whether it is required, whether it was touched, time in field, edit count and the invalid reason. **Never values, lengths or keystrokes** |
| Errors | JavaScript errors and unhandled rejections: scrubbed message and the top 5 stack frames; failed images, scripts and stylesheets |
| Network | Failed and slow (3 s or more) `fetch` and XHR calls: method, origin, templated path, status and duration. **Never the query, headers or bodies** |
| Device context | Once per batch: screen size, pixel ratio, time zone, language, CPU cores, device memory, touch, pointer, colour scheme, reduced motion, connection type, and whether the browser is automated (to filter bots); on Chromium the device model and OS version |
| Performance | Through the insights module: LCP, INP, CLS, FCP, TTFB, long tasks and resource totals |

**Never collected:** values typed into forms, passwords, payment card data, national or Iqama ID numbers, credentials and tokens, or the text of inputs, text areas, selects and editable regions. Device traits are never used to identify anyone. Raw IP addresses are used at the ingestion edge and never stored.

### Cookies

The SDK keeps its state in first-party cookies on your site's registrable domain (so `www.example.sa` and `app.example.sa` share one visitor). It uses no `localStorage`; when the browser refuses cookies it keeps the IDs in memory for the current page only.

Cookie names end with `_` and eight characters of your project key (for example `datacub_id_abcdefgh`), so two project keys on one site never share a visitor. `datacub_optout` has no suffix and applies to every key on the site.

| Cookie | Contents | Lifetime |
|---|---|---|
| `datacub_id` | Random visitor ID (UUID) | 400 days, refreshed once per session |
| `datacub_ss` | Session ID with its start and last-activity times | 30 minutes of inactivity |
| `datacub_u` | The user ID you passed to `identify` | 400 days, deleted by `reset` and `revoke` |
| `datacub_a` | The `account` you passed to `identify` | 400 days, deleted by `reset` and `revoke` |
| `datacub_optout` | `1` after `consent.revoke()` or under Global Privacy Control | 400 days, deleted by a later `grant` |
| `datacub_tld` | Empty probe that finds the registrable domain | Set and deleted at once |

All are `SameSite=Lax`, and `Secure` on HTTPS pages. Two datacub projects on subdomains of the same site share these cookies, as do sites on a shared hosting domain that is not on the [Public Suffix List](https://publicsuffix.org); give each its own domain if they must stay apart.

Each kind of optional capture can be switched off per site with the `capture` option, or per project in datacub's settings, which drops those fields on the server even from sites that still send them. Describe what you collect in your own privacy notice.

## First-party proxy

Some content blockers drop requests to analytics hosts. Forward these paths from a path on your domain to `https://in.datacub.to`, passing the body through unchanged and **without your site's `Cookie`, `Authorization` and `Referer` headers**:

- `POST /v1/batch`, events
- `GET /v1/sdk/*`, the SDK and the insights module it loads
- `GET /v1/flags`, if you use feature flags
- `POST /v1/feedback` and `POST /v1/feedback/answer`, if you use the feedback widget

Then point the SDK at it, with a full URL or a path on your own site:

```ts
datacub.init('pk_live_YOUR_PROJECT_KEY', { apiHost: 'https://www.example.sa/datacub' })
```

## Content Security Policy

Allow your ingestion host (`https://in.datacub.to`, or your proxy) in `script-src`, for the SDK and the insights module it loads from `/v1/sdk/insights-<version>.min.js`, and in `connect-src`. The insights module is loaded with a subresource integrity hash, so only the exact file published with your SDK version runs. The SDK uses no `eval`, no inline scripts after load and injects no styles into your page (the optional feedback widget styles itself inside its own shadow root).

## Supported environments

| Environment | Support |
|---|---|
| Chrome, Edge, Samsung Internet | 93 and later |
| Firefox | 92 and later |
| Safari, all iOS browsers | 15.4 and later |
| Bundlers | Any that understand ES modules and `package.json` `exports` (Vite, webpack 5, Rollup, esbuild, Bun, Parcel) |
| Frameworks | Any: React, Vue, Svelte, Angular, plain HTML. Single page app routing is detected through the History API |
| Server-side rendering | Safe to import on the server (Next.js, Nuxt, TanStack Start, Remix); every method does nothing when `window` is undefined |
| TypeScript | Types included; works with `moduleResolution` `bundler`, `node16` and `nodenext` |

The package is ESM only. Every change is tested in CI on current Chromium, Firefox and WebKit, desktop and mobile emulation. Some signals depend on browser APIs: device memory, connection details, CLS and long tasks are Chromium-only; LCP and INP arrive in Safari from 26.2.

## Versioning and releases

The package follows [semantic versioning](https://semver.org). Each version's changes are in the [changelog](./CHANGELOG.md) and on the [releases page](https://github.com/datacub/web-sdk/releases). Every npm version is published from GitHub Actions with an npm provenance attestation. The script-tag files at `https://in.datacub.to/v1/sdk/datacub-<version>.min.js` are the same builds as the npm package's `dist/datacub.js`, and a versioned URL never changes.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup and guidelines, and [RELEASING.md](./RELEASING.md) for how releases work. Please report security problems privately as described in [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE) © datacub
