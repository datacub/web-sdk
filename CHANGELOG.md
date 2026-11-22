# Changelog

## 0.4.0

- `datacub.identify({ id, ...traits })` works: the id can be `id`, `userId` or `user_id`, and `fullName` and `phoneNumber` count as `name` and `phone`.
- Visitor cookies are per project key (`datacub_id_<key part>` and so on; `datacub_optout` stays shared), so existing visitors get a new anon_id once.

## 0.3.1

First release on npm.

- Install from npm with `npm install @datacub/web`, or keep using the script tag. Both are built from the same source, and the script-tag files at `https://in.datacub.to/v1/sdk/datacub-0.3.1.min.js` are the same bytes as `dist/datacub.js` in the package.
- The default ingestion host is now `https://in.datacub.to`. Sites that pass `apiHost` (or `data-api-host`) are unaffected.
- Entry points: `@datacub/web` (the SDK), `@datacub/web/flags` (feature flags and experiments) and `@datacub/web/feedback` (the feedback widget's renderer).
