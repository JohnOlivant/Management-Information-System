# Shared sign-in

One sign-in page and one session for the four apps: Quoting, Scheduling, Timesheets and Management Information. Each app sends people here, the page shows that app's name and colour, and after sign-in they go straight back. Signing in to one app signs them in to all the apps their account opens; signing out signs them out of all of them.

Why and how it fits the apps: [docs/shared-sign-in.md](../docs/shared-sign-in.md).

![Sign-in page for Quoting](../docs/images/signin-quoting.png)

## Run it locally

```sh
cd signin
npm install
npm run demo        # http://localhost:3900, in-memory demo accounts, password demo-password-1
```

Try `http://localhost:3900/?app=quoting`, `?app=scheduling`, `?app=timesheets` or `?app=mis`. Without `?app` the page signs people in and then lists the apps they can open.

| Demo account | Opens |
| --- | --- |
| `owner@example.com` | Every app |
| `crew@example.com` | Timesheets only |
| `new@example.com` | Quoting, and must change the temporary password first |

## Tests

```sh
npm test                                                             # behaviour tests, in memory
TEST_DATABASE_URL=postgresql://postgres@localhost/signin_test npm run test:integration   # the same tests on PostgreSQL
```

The PostgreSQL run applies `db/001-identity.sql` to a fresh schema for each test and runs the service as the narrow `rule29_signin_app` role, so the grants are tested too.

## Pages

| Address | Screen |
| --- | --- |
| `/?app=<id>&return=<address>` | Sign in to that app, then back to `return` (only if it is one of that app's own addresses) or the app's home page |
| `/` | Sign in, then choose an app |
| `/password` | Change password (every app) |
| `/signout?app=<id>` | Sign out of every app |

A temporary password must be changed before any app opens. Forgotten passwords are reset by the firm's administrator, as on the live quoting system; there is no self-service reset email until an email provider is chosen.

## Settings

| Variable | Meaning |
| --- | --- |
| `SIGNIN_ORIGIN` | This service's own address, e.g. `https://signin.example.co.uk`. Browser posts from any other address are refused. Must be https in production |
| `COOKIE_DOMAIN` | The parent domain all four apps share, e.g. `example.co.uk`, so the session cookie reaches every app |
| `DATABASE_URL` | PostgreSQL, as `rule29_signin_app`. Without it the service runs the in-memory demo (refused when `NODE_ENV=production`) |
| `SIGNIN_KEY_QUOTING`, `SIGNIN_KEY_SCHEDULING`, `SIGNIN_KEY_TIMESHEETS`, `SIGNIN_KEY_MIS` | Each app's service key, 32+ random characters, used by that app to check sessions |
| `APPS_FILE` | The apps file; defaults to `apps.json`. Production lists each app's real `homeUrl` (and any other `origins` it serves from) |
| `TRUSTED_PROXY` | `loopback` behind a reverse proxy on the same machine, otherwise `none` |
| `PORT`, `HOST` | Default `3900`, `127.0.0.1` |

`apps.json` holds each app's name, tagline, mark (up to three letters), colour and home address. A new app is one more entry and one more key.

## Accounts

```sh
DATABASE_URL=... node scripts/add-account.js jo@firm.co.uk "Jo Bloggs" quoting:<company_id>:estimator timesheets:<client_id>:worker
```

prints a temporary password. Each grant is `app:tenantId[:role[:firm name]]`, where `tenantId` is the id that app already uses for the firm (`company_id` in quoting, `client_id` in the timesheet and scheduler). Roles stay with each app; the sign-in only passes them on.

## Using it from an app

`client/index.js` has no dependencies.

```js
const {createSignInClient} = require('rule29-signin');           // or copy client/index.js
const signin = createSignInClient({signinUrl: process.env.SIGNIN_URL, appId: 'quoting', serviceKey: process.env.SIGNIN_KEY});

const session = await signin.authenticate(req);
if (!session) return redirect(signin.signInUrl(currentAddress));  // API calls answer 401 and the page redirects
// session: {accountId, email, displayName, csrfToken, expiresAt, access: [{tenantId, tenantName, role}]}
// Check X-CSRF-Token on writes against session.csrfToken. Pick the firm from session.access.
```

`signin.signOutUrl()` and `signin.passwordUrl()` give the links for the app's menu. Answers are cached for 30 seconds, so a sign-out elsewhere reaches an app within 30 seconds.

Server to server, an app posts `{token}` (the `r29_signin` cookie value) to `/api/service/verify` or `/api/service/end-session` with `Authorization: Bearer <its key>`. Verify returns `{session: null}` or the session with only that app's access.

## Security

Same model as the three apps today: scrypt password hashes (and the same `scrypt:salt:hash` format, so existing hashes can be copied across), hashed 256-bit session tokens, 8-hour sessions, a CSRF token per session, 5 failed attempts per account and 30 per address in 15 minutes, one error message for unknown email and wrong password. Changing a password ends the account's other sessions. The cookie is `HttpOnly`, `Secure` on https, and `SameSite=Lax` so a link from an email into an app keeps the person signed in. Return addresses must belong to the app that asked, so the page can't be used to bounce people to another site. The page sends a strict Content Security Policy and can't be framed.
