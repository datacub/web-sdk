<p align="center">
  <a href="https://datacub.to">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/datacub/web-sdk/main/.github/assets/wordmark-dark.svg">
      <img alt="datacub" src="https://raw.githubusercontent.com/datacub/web-sdk/main/.github/assets/wordmark.svg" height="48">
    </picture>
  </a>
</p>

<p align="center">Product analytics for your website. One line to install, private by default.</p>

## Install with AI

Paste this into Claude Code, Cursor, Codex or any coding agent:

```text
Add datacub analytics to this project. Follow https://raw.githubusercontent.com/datacub/web-sdk/main/skills/datacub/SKILL.md
My datacub project key: pk_live_YOUR_KEY
```

The agent finds your framework, installs the SDK, adds your key events and checks they arrive. It works for React Native too. To keep the skill installed: `npx skills add datacub/web-sdk`.

## Install by hand

```sh
npm install @datacub/web
```

```ts
import datacub from '@datacub/web'

datacub.init('pk_live_YOUR_KEY')
```

Or add one line to `<head>`. **Settings → Integrations** in datacub has it with your key filled in.

Page views, route changes, clicks, forms and errors are tracked automatically.

## API

```ts
datacub.track('signup_completed', { plan: 'pro' }) // a custom event
datacub.identify(user.id, { email, name })          // after login
datacub.reset()                                     // at logout

// only when the project asks for consent first: init(key, { requireConsent: true })
datacub.consent.grant()
datacub.consent.revoke()
```

Feature flags: `import { flag, experiment } from '@datacub/web/flags'`, then `await flag('new_checkout')`.

The SDK never collects form values, passwords, card numbers or IDs. It uses first-party cookies and no fingerprinting.

## Docs

[datacub.to/docs](https://datacub.to/docs): [install](https://datacub.to/docs/install-web), [frameworks](https://datacub.to/docs/frameworks), [consent](https://datacub.to/docs/consent) and the [full reference](https://datacub.to/docs/reference) (options, cookies, proxy, CSP).

[MIT](./LICENSE)
