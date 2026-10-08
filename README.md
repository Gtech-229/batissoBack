# Bâtisso API

Backend for Bâtisso, a savings-for-construction platform for hardware stores:
customers save step by step at their store, follow their construction goals, and
buy materials with every movement recorded in a trustworthy register.

Built with NestJS 12, PostgreSQL 17 (Docker), Prisma 7, and Swagger.

## Requirements

- Node.js 22+
- Docker Desktop (PostgreSQL runs in Docker Compose)

## Setup

```bash
npm install
cp .env.example .env        # then set JWT_ACCESS_SECRET, PIN_PEPPER (see below) and the super admin password
npm run db:up               # PostgreSQL on localhost:5433 (dev + test databases)
npm run prisma:generate     # generates the Prisma client into src/generated/
npm run prisma:migrate      # creates the tables
npm run start:dev           # http://localhost:3000
```

Check it works:

- Health: http://localhost:3000/api/v1/health returns `{"status":"ok","database":"up",...}`
- API docs (French): http://localhost:3000/docs

## First admin login

1. On the first start, the API creates the **super admin** from `SUPER_ADMIN_EMAIL`
   and `SUPER_ADMIN_PASSWORD` (the log shows `Super admin created: <email>`). It
   never overwrites an existing super admin, so these values are only used once.
2. Log in with `POST /api/v1/admin/auth/login` (`{ "email", "password" }`), for
   example from Swagger UI. The session lives in httpOnly cookies, which the
   browser sends automatically.
3. The super admin creates the other admins (`POST /api/v1/admin/admins`) with an
   initial password. A new admin must change it (`PATCH /api/v1/admin/auth/password`)
   before using anything else.

Security settings (max login attempts before a 15-minute lock, max sessions per
admin, max wrong PINs before a mobile user is locked, where 0 means no limit) are
editable by the super admin at `PATCH /api/v1/admin/settings`.

## First country and store

There is no seed data, so a fresh database has no country. As an admin:

1. Create the country: `POST /api/v1/admin/countries`
   (`{ "code": "ML", "name": "Mali", "currencyCode": "XOF", "currencySymbol": "F CFA", "decimals": 0 }`).
   The phone prefix is derived from the code. Countries start inactive.
2. Activate it: `PATCH /api/v1/admin/countries/ML/activate` (a single active
   country in V1).
3. Register a store with its money settings and first manager:
   `POST /api/v1/admin/stores`. Amounts are strings in the currency's smallest unit
   (`"200000"` = 200 000 F); phone numbers must belong to the store's country.
4. After checking its papers, verify it: `PATCH /api/v1/admin/stores/:id/verify`.
   A store can then be suspended, reactivated, or closed (final).

Lists are paginated: `?page=1&pageSize=20` returns `{ items, total, page, pageSize }`.

## First mobile sign-in

Mobile users (store staff now, customers later) sign in to the app with their
phone. Only phones already known as a user can activate: a store's first manager,
registered above, is the first one. There is no real SMS provider yet: in
development, each code is printed in the API log (`[SMS] To +223...: ...`).

1. `POST /api/v1/auth/code` `{ "phone": "76 00 00 00" }`: sends a 6-digit code
   (valid 10 minutes). The answer is the same for unknown phones.
2. `POST /api/v1/auth/code/verify` `{ "phone", "code", "deviceId" }`: returns a
   single-use `verificationToken` and `pinSet` (has the user chosen a PIN yet?).
   `deviceId` is a random id the app creates once per installation.
3. `POST /api/v1/auth/pin` `{ "verificationToken", "pin", "publicKey" }`: the
   first time, `pin` becomes the user's 6-digit PIN; on a new phone it must be
   the current one. `publicKey` belongs to a key pair the app creates in the
   phone's secure hardware (see below). Returns `accessToken`, `refreshToken`,
   and the user.
4. Afterwards, on that phone: `POST /api/v1/auth/challenge` `{ "phone", "deviceId" }`,
   sign the returned `challenge` with the private key, then `POST /api/v1/auth/login`
   `{ "phone", "pin", "deviceId", "challenge", "signature" }`. No SMS needed.

Then send `Authorization: Bearer <accessToken>` (15 minutes) to `GET /api/v1/me`
and the other mobile routes, renew with `POST /api/v1/auth/refresh`
`{ "refreshToken" }` (30 days, a new one each time), and end the session with
`POST /api/v1/auth/logout`. Too many wrong PINs lock the user for 15 minutes.

**Device keys for the app.** The key pair is EC P-256, the only curve both
Android Keystore and the iOS Secure Enclave support; the private key never leaves
the phone. Send the public key as **SPKI DER, base64**, and sign with **ECDSA
P-256 / SHA-256** over the challenge's UTF-8 bytes, the signature in DER, base64
(the platforms' default). Android exports SPKI directly. iOS
(`SecKeyCopyExternalRepresentation`) exports the raw 65-byte point (`04 || X ||
Y`): prefix it with these 26 bytes to get SPKI:
`3059301306072a8648ce3d020106082a8648ce3d030107034200`.

## Common commands

| Command | What it does |
|---|---|
| `npm run start:dev` | Start the API in watch mode |
| `npm run db:up` / `npm run db:down` | Start / stop PostgreSQL (data is kept in the `pgdata` volume) |
| `npm run prisma:migrate` | Create and apply a migration after a schema change |
| `npm run prisma:studio` | Browse the database |
| `npm test` | Unit tests |
| `npm run test:e2e` | End-to-end tests against the `batisso_test` database (needs `db:up`) |
| `npm run build` | Compile to `dist/` |
| `npm run lint` / `npm run format` | Lint / format the code |

## Conventions

- All routes live under `/api/v1`; web admin routes under `/api/v1/admin`.
- Every admin route requires an admin session (cookies) and every mobile route a
  mobile session (Bearer token), unless it is explicitly public (health, sign-in
  steps, refresh). One population's credentials never open the other's routes.
- Every error response has the same shape:
  `{ statusCode, error, message, details?, path, timestamp }`. `message` is in
  French and safe to show to users; `error` is a stable code for client apps.
- Swagger descriptions and API messages are in French; code is in English.

## Environment variables

| Name | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | | `postgresql://` URL |
| `PORT` | no | `3000` | |
| `NODE_ENV` | no | `development` | `development`, `test`, or `production` (Swagger is off and cookies are `Secure` in production) |
| `CORS_ORIGINS` | no | none | Comma-separated web admin origins allowed to send cookies, e.g. `http://localhost:5173` |
| `JWT_ACCESS_SECRET` | yes | | At least 32 random characters; signs admin access tokens. The `.env.example` placeholder is deliberately too short, so the API refuses to start until you set a real one: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `PIN_PEPPER` | yes | | At least 32 random characters, mixed into every PIN hash and never stored in the database, so a leaked database alone cannot reveal PINs. Generate it like `JWT_ACCESS_SECRET` (the `.env.example` placeholder is too short on purpose) and keep it safe: **changing it later invalidates every PIN** |
| `SUPER_ADMIN_EMAIL` | when no super admin exists | | Email of the super admin created at startup |
| `SUPER_ADMIN_PASSWORD` | when no super admin exists | | 8 to 128 characters with an uppercase letter, a lowercase letter, a digit, and a special character. **Wrap it in quotes**: an unquoted `#` starts a comment |

The app refuses to start if a variable is missing or invalid.
