---
name: datacub
description: Add datacub product analytics to a website, web app (React, Next.js, Vue, Nuxt, Svelte, Astro, plain HTML) or React Native / Expo app. Use when asked to integrate, install or set up datacub, or to track product events with it.
---

# Add datacub to this project

datacub is product analytics: page views, sessions, clicks and the events you track. Do the whole
integration yourself, from the code. Keep the change small and touch nothing unrelated.

Current versions: `@datacub/web` 0.4.0 <!-- x-release-please-version -->, `@datacub/react-native` beta (`@next`).

## 1. Get the project key

You need a public project key: `pk_live_…` (production) or `pk_test_…` (the only kind accepted from
`localhost`). Use the key from the prompt or the project's env. If there is none, ask for it: it is
in datacub under **Settings → Integrations**. Put it in a client-visible env var with the
framework's public prefix (`VITE_DATACUB_KEY`, `NEXT_PUBLIC_DATACUB_KEY`, `EXPO_PUBLIC_DATACUB_KEY`)
or straight in code. Public keys only send events, so they
are safe in client code. Never put any other datacub credential (`rk_…`, `datacub_mcp_…`, `sk_…`) in
code.

## 2. Look before you change anything

Read the package manifest, the entry point, the router and how login works. Check for existing
datacub calls so you never add a second `init`. Then pick the SDK:

- Website or web app: **Web** below.
- React Native or Expo: **React Native** below.
- Anything else (Swift, Kotlin, Flutter, backend only): datacub has no SDK for it yet. Say so and stop.

## 3a. Web

Install with the project's package manager: `npm install @datacub/web` (or pnpm, yarn, bun). Call
`init` once, in client code, as early as possible. Importing is safe during server rendering.

| Project | Where `init` goes |
|---|---|
| Vite, Create React App, any SPA | the entry file (`src/main.tsx`), before render |
| Next.js App Router | a client component rendered in `app/layout.tsx` (below) |
| Next.js Pages Router | `pages/_app.tsx`, in a `useEffect` |
| Nuxt | `plugins/datacub.client.ts` |
| SvelteKit | `src/hooks.client.ts` |
| Astro | a `<script>` in the base layout |

```ts
import datacub from '@datacub/web'

datacub.init('pk_live_YOUR_KEY')
```

Next.js App Router:

```tsx
// app/datacub.tsx
'use client'
import datacub from '@datacub/web'
import { useEffect } from 'react'

export function Datacub() {
  useEffect(() => {
    datacub.init(process.env.NEXT_PUBLIC_DATACUB_KEY!)
  }, [])
  return null
}
// app/layout.tsx: render <Datacub /> inside <body>
```

Plain HTML, or if the npm package cannot be installed: put the script tag in `<head>` instead
(replace `<version>` with the current `@datacub/web` version above).

```html
<script src="https://in.datacub.to/v1/sdk/datacub-<version>.min.js" data-key="pk_live_YOUR_KEY" defer></script>
```

Page views, route changes, clicks, form starts and errors are captured automatically. Do not add
page view or click tracking. The site's domain must be in the project's allowed websites (datacub,
**Settings → General**) or its events are refused.

## 3b. React Native and Expo (beta)

```sh
npx expo install @datacub/react-native@next @react-native-async-storage/async-storage expo-application
```

Bare React Native: install `@datacub/react-native@next` and `@react-native-async-storage/async-storage`.

Once at startup, at module scope (top level of `App.tsx`, or of Expo Router's root `app/_layout.tsx`):

```ts
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Application from 'expo-application'
import datacub from '@datacub/react-native'

datacub.init('pk_live_YOUR_KEY', { storage: AsyncStorage, app: Application })
```

Bare app without `expo-application`: `app: { applicationId: 'com.example.app', nativeApplicationVersion: '1.0.0' }`.

Screens are not automatic. React Navigation: `onReady={() => trackNavigation(ref)}` on the
`NavigationContainer`, with `trackNavigation` from `@datacub/react-native/navigation`. Expo Router,
in the root layout component: `const segments = useSegments()` and
`useEffect(() => { datacub.screen(segments.join('/') || 'index') }, [segments])`. Send route names,
never values a screen shows.

The app's bundle ID or package name must be in the project's allowed apps (datacub, **Settings → General**).

## 4. Consent

If the project already has a consent banner or consent manager, or the person asked for consent
first: init with `{ requireConsent: true }` (script tag: add `data-require-consent`) and call
`datacub.consent.grant({ method: 'banner' })` where the user accepts analytics, and
`datacub.consent.revoke()` where they decline or withdraw. Otherwise add nothing: datacub tracks
from the first page view and needs no banner of its own.

## 5. Identify signed-in users

After login succeeds: `datacub.identify(user.id, { email: user.email, name: user.name })` with the
app's own stable user ID (never an email or phone as the ID). On logout: `datacub.reset()`.

## 6. Track 3 to 5 business events

From the code, pick the actions that show the product working for someone: `signup_completed`,
`project_created`, `checkout_completed`, `subscription_started`, `teammate_invited`. Name them
`object_action` in snake case. If the app has no login or no such actions yet, skip that part and say so. Track them where the code knows the action succeeded (after the API
call resolves), once per outcome, never in code that re-runs on render:

```ts
datacub.track('project_created', { plan: 'pro' })
```

Properties are few, flat and low-cardinality. Never put passwords, tokens, card data, national or
Iqama IDs, emails, phone numbers, names or free text in events (the SDK redacts them anyway).

## 7. Verify

Run the type checker and the build (report errors that were there before you started; don't fix them). Then run the app, open a page or screen and do one tracked
action. Each must reach datacub:

- Web: each `POST …/v1/batch` request answers `200` with `"accepted"` of 1 or more (a batch can hold
  several events, the page view and your custom event together). A `403` names the
  reason: `origin_not_allowed` (add the domain in Settings) or `localhost_live_key` (use `pk_test_`
  on localhost). Wait 5 seconds before closing the page; events go in small batches. Headless
  browsers count as bots: their events are stored but left out of reports, so check the response.
- React Native: in a development build, a refused key or app prints `[datacub] ingestion refused
  this app (403)`. Call `await datacub.flush()` to send at once.
- Either: the event shows in the project's **Live** view in datacub within seconds, and the setup
  page turns green. If the datacub MCP server is connected, ask it whether the events arrived.

Report only what you actually saw: where `init` lives, each event and where it fires, what you
verified, and anything the person must do (allow a domain or app, add the key to production env).
