---
"@datacub/web": minor
---

`datacub.identify({ id, ...traits })` now works: the id can be `id`, `userId` or `user_id`, and `fullName` and `phoneNumber` count as `name` and `phone`. Visitor cookies are now per project key (`datacub_id_<first 8 key characters>` and so on; `datacub_optout` stays shared), so existing visitors get a new anon_id once.
