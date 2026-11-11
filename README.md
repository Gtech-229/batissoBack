# Bâtisso API

Backend for Bâtisso, a savings-for-construction platform for hardware stores:
customers save step by step at their store, follow their construction goals, and
buy materials with every movement recorded in a trustworthy register.

Built with NestJS 12, PostgreSQL 18 (Docker), Prisma 7, and Swagger.

## Requirements

- Node.js 22+
- Docker Desktop (PostgreSQL runs in Docker Compose)

## Setup

```bash
npm install
cp .env.example .env        # then set JWT_ACCESS_SECRET, PIN_PEPPER and SUPER_ADMIN_PASSWORD (see below)
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
3. The super admin creates the other admins (`POST /api/v1/admin/admins`) with a
   role and no password. Each admin then chooses their own (see "Admin passwords
   by email").

### Admin passwords by email

Nobody but the admin ever knows their password:

- `POST /api/v1/admin/auth/forgot-password?mode=set` with `{ "email" }` emails a
  link to choose a first password; `mode=reset` replaces a forgotten one. The
  answer is always the same 202, whether the email has an account or not, and
  at most one email a minute is sent per admin.
- The link is `<ADMIN_WEB_URL>/password?mode=...&token=...`, valid 3 days and
  once. `POST /api/v1/admin/auth/reset-password` with `{ "token", "password" }`
  sets the password, ends every session of the admin, and clears the lockout.
  An expired or used link answers `INVALID_PASSWORD_TOKEN`: ask for another.
- A mistyped email: the super admin corrects it with
  `PATCH /api/v1/admin/admins/:id` (`email`, `firstName`, `lastName`); the links
  sent to the old address stop working, and the admin asks again.
- No email provider exists yet: outside production, the console sender prints
  each email in the API log (`[Email] To <address>: ...`), link included. In
  production it only warns that nothing was sent.

**Super admin who cannot receive email.** On the server, run `npm run build`,
then `npm run admin:password-link -- <email>`. It prints a link for that super
admin and nothing else (`set` without a password, `reset` otherwise) and exits
with code 1 for any other email. Treat the link like a password.

Security settings (max login attempts before a 15-minute lock, max sessions per
admin, max wrong PINs before a mobile user is locked, where 0 means no limit) are
editable at `PATCH /api/v1/admin/settings`, by the super admin or an admin whose
role holds `settings.manage`.

### Roles and permissions

The super admin decides what each admin may do. A role holds permissions, and each
admin has one role:

- `GET /api/v1/admin/permissions` lists them: `countries.read`, `countries.manage`,
  `stores.read`, `stores.manage`, `store-settings.manage`, `settings.read`,
  `settings.manage`, `subscriptions.read`, `subscriptions.manage`,
  `accounts.read`, `accounts.manage`, `disputes.read`, `activity.read`,
  `stats.read`
- `POST`, `GET`, `PATCH`, `DELETE` on `/api/v1/admin/roles` manage the roles
- `PATCH /api/v1/admin/admins/:id/role` gives an admin a role

A change counts from the admin's next request. The super admin has every
permission and no role; managing admins and roles stays theirs alone. The
`Administrateur` role, created by the migration, holds what an admin could do
before roles existed; the subscription, account, dispute, activity and
statistics permissions came later and are granted by the super admin.

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
   `deliveryDelayDays` (optional, 1 to 365, default 30) is how many days after
   confirming a paid order a customer may ask to cancel it while it is still
   undelivered; `PATCH /api/v1/admin/stores/:id/settings` changes it.
4. After checking its papers, verify it: `PATCH /api/v1/admin/stores/:id/verify`.
   A store can then be suspended, reactivated, or closed (final).

Lists are paginated: `?page=1&pageSize=20` returns `{ items, total, page, pageSize }`.

### Subscriptions

An admin with `subscriptions.manage` records each store's subscriptions by hand,
the trial included; registering a store creates none. V1 only records them: no
billing, no limit per plan, nothing automatic when one ends.

- `POST /api/v1/admin/stores/:id/subscriptions` with
  `{ "plan": "TRIAL" | "STANDARD" | "PRO", "startsOn": "2026-11-01", "endsOn": "2026-11-30" }`:
  both days included, UTC. Two subscriptions of a store never overlap
  (`SUBSCRIPTION_OVERLAP`); a closed store gets no new one (`STORE_CLOSED`).
- `GET` on the same path lists them, newest first, each with its status of the
  day: `UPCOMING`, `ACTIVE`, or `EXPIRED` (`subscriptions.read`).
- `PATCH /api/v1/admin/subscriptions/:subscriptionId` corrects the plan or the
  dates; to stop one early, move `endsOn` earlier. There is no delete.
- The store list and detail show `subscriptionState` (`ACTIVE`, `UPCOMING`,
  `EXPIRED`, `NONE`) and `currentSubscription`; filter the list with
  `?subscriptionState=EXPIRED` to find the stores to follow up, and suspend one
  with `PATCH /api/v1/admin/stores/:id/suspend` if needed.

## First mobile sign-in

Mobile users (store staff and customers) sign in to the app with their phone.
A phone already known as a user (a store's first manager, registered above, or a
customer whose account was opened at a counter) activates; a new phone signs up
in the same steps. There is no real SMS provider yet: in development, each code
is printed in the API log (`[SMS] To +223...: ...`). Codes go to any number of
the active country, limited per phone only (1 a minute, 5 an hour, 10 a day):
before connecting a paid SMS provider, add a global or per-IP limit, or the
provider's fraud controls, so no client can make the platform pay for SMS
across a whole number range.

1. `POST /api/v1/auth/code` `{ "phone": "76 00 00 00" }`: sends a 6-digit code
   (valid 10 minutes), to a known phone or a new one. The answer is always the
   same, so it never tells which phones have an account.
2. `POST /api/v1/auth/code/verify` `{ "phone", "code", "deviceId" }`: returns a
   single-use `verificationToken`, `registered` (does the phone have a user?)
   and `pinSet` (has the user chosen a PIN yet?).
   `deviceId` is a random id the app creates once per installation.
3. `POST /api/v1/auth/pin` `{ "verificationToken", "pin", "publicKey" }`: the
   first time, `pin` becomes the user's 6-digit PIN; on a new phone it must be
   the current one. `publicKey` belongs to a key pair the app creates in the
   phone's secure hardware (see below). Returns `accessToken`, `refreshToken`,
   and the user. **Sign-up:** when `registered` was `false`, also send
   `firstName` and `lastName`; the user is created with that PIN, with no store
   and no account yet (names sent for an existing user are ignored).
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

## Registering a store from the app

A signed-in user (Bearer session, see "First mobile sign-in") registers their own
store; they become its manager and it waits for an admin's verification.

1. Register: `POST /api/v1/stores` with `name`, `address`, `city`, `phone`,
   `tradeRegister`, `settings` (the same money rules as the admin form) and
   `requestedPlan` (`TRIAL`, `STANDARD` or `PRO`). The store is `PENDING`
   in the active country; no subscription is created (admins record it). A user
   registers one store, ever (`409 STORE_ALREADY_REGISTERED`).
2. Send the two photos (multipart, one JPEG or PNG of at most 5 MB in the field
   `photo`, replaceable until the verification):
   `PUT /api/v1/stores/:storeId/documents/identity` and
   `PUT /api/v1/stores/:storeId/documents/trade-register`.
3. An admin reads the store (`GET /api/v1/admin/stores/:id`: `requestedPlan`,
   `selfRegistered`, `documents`), views the photos
   (`GET /api/v1/admin/stores/:id/documents/identity` or `/trade-register`),
   then verifies it. Verification answers `409 STORE_DOCUMENTS_MISSING` until
   both photos are sent. No account and no deposit before that.

Files live in the private `STORE_DOCUMENT_DIR`, which belongs in the backups next
to `ID_PHOTO_DIR`.

## First seller

Once a store is **verified**, its manager builds the team from the app (Bearer
session). Every route under `/api/v1/stores/:storeId` checks that the caller is an
active member of that store with the right role; a store they do not belong to
answers 404.

1. Add a seller: `POST /api/v1/stores/:storeId/sellers`
   `{ "phone": "76 11 22 33", "firstName": "Moussa", "lastName": "Traoré" }`. A new
   phone becomes a user without PIN: the seller then signs in with the steps of
   "First mobile sign-in". An existing user keeps their names.
2. See the team: `GET /api/v1/stores/:storeId/members` (managers first; inactive
   sellers included).
3. Deactivate or reactivate a seller:
   `PATCH /api/v1/stores/:storeId/sellers/:userId/deactivate` (or `/reactivate`).
   A deactivated seller keeps their account but loses access to the store at once.
4. Read who did what: `GET /api/v1/stores/:storeId/activity` (paginated, newest
   first).

Managers manage sellers only; managers are registered by admins.

## First customer account

In a **verified** store, a seller or a manager opens a customer's savings account
at the counter (Bearer session):

1. Open the account: `POST /api/v1/stores/:storeId/accounts`

   ```json
   {
     "customer": { "phone": "76 44 55 66", "firstName": "Fanta", "lastName": "Keita" },
     "beneficiary": { "name": "Ali Keita", "phone": "76 77 88 99" },
     "termsAccepted": true
   }
   ```

   The beneficiary is optional (its phone too). The answer gives the account
   number (`C-000123`), balance `"0"`, the country's currency, and the
   **Non affecté** (Unassigned) goal. A new phone becomes a user without PIN; an
   existing user keeps their names. One account per customer and store; staff
   cannot open one in their own name.
2. Find accounts: `GET /api/v1/stores/:storeId/accounts?q=keita` (account
   number, phone in local or international format, or name; paginated, newest
   first). Detail: `GET /api/v1/stores/:storeId/accounts/:accountId`.
3. The customer activates the app with the steps of "First mobile sign-in", then
   sees their accounts in every store: `GET /api/v1/me/accounts`.

### Account suspension

An admin can suspend one savings account (one customer at one store); the
customer's other accounts and their sign-in stay untouched.

- `GET /api/v1/admin/accounts?q=keita&storeId=...&status=SUSPENDED`
  (`accounts.read`) searches every store's accounts by number, name, or phone
  digits, newest first. It never shows a balance, an operation, or the photo.
- `PATCH /api/v1/admin/accounts/:id/suspend` with `{ "reason": "..." }` (3 to 500
  characters) and `PATCH /api/v1/admin/accounts/:id/reactivate`
  (`accounts.manage`). A closed store's accounts cannot change.
- A suspended account refuses deposits, goal moves, and goal closes
  (`ACCOUNT_SUSPENDED`).
  Purchases, deliveries, cancellations with their re-credit, corrections, and
  every read still work.
- Staff see `status` and `statusReason` on the account, except a staff member on
  their own account, who never sees the reason; the customer sees the
  status only and gets a notice (app and SMS) on each change, without the reason.

## Joining a store from the app

A signed-in user (see "First mobile sign-in") opens their own account in a
**verified** store by scanning its QR code (the code a staff member reads with
`GET /api/v1/stores/:storeId/qr-code`):

1. Preview the store and its terms: `POST /api/v1/me/accounts/join/preview`
   `{ "code": "<scanned code>" }` (name, city, terms, currency, minimum deposit,
   maximum balance, delivery delay; nothing is written).
2. Accept and join: `POST /api/v1/me/accounts/join`
   `{ "code": "<scanned code>", "termsAccepted": true }`, with an optional
   `beneficiary` as at the counter. The account opens at once (201), with the
   customer as its opener; one account per customer and store
   (`409 ACCOUNT_EXISTS`). The customer's phone must be a number of the store's
   country (`409 PHONE_NOT_OF_STORE_COUNTRY`).

The identity photo is taken later at the counter (next section). Deposits do not
need it.

## Customer identity photo

A seller or a manager attaches the photo of the customer's identity document to
their account (Bearer session):

1. Upload or replace it: `PUT /api/v1/stores/:storeId/accounts/:accountId/id-photo`,
   `multipart/form-data` with one file in the field `photo` (JPEG or PNG, checked
   from its content, at most 5 MB). The store must be **verified**. The answer is
   the account detail with `"hasIdPhoto": true`; a replaced photo is deleted.
2. View it: `GET /api/v1/stores/:storeId/accounts/:accountId/id-photo` returns the
   image itself (never cached). In Swagger, the upload route shows a file picker.

Photos are stored privately in `ID_PHOTO_DIR` (default `storage/id-photos`,
created at startup, ignored by git), never in a public folder or a JSON answer.
Back this directory up with the database.

## First deposit

A seller or a manager records the cash a customer hands over (Bearer session,
**verified** store):

1. Record it: `POST /api/v1/stores/:storeId/accounts/:accountId/deposits` with
   `{ "amount": "5000" }` and an `Idempotency-Key` header holding a UUID the app
   generates for this deposit (in Swagger, any UUID). The answer (201) is the
   receipt: reference (`D-00482`), amount, balance before and after, account,
   customer, store, who recorded it.
2. Retrying the **same** request with the **same** key returns the same receipt
   (200) and records nothing new; a new deposit needs a new key.
3. The amount must reach the store's minimum deposit, and the balance must stay
   under its maximum (409 otherwise). Staff cannot record a deposit on their own
   account.
4. Read the history: `GET /api/v1/stores/:storeId/accounts/:accountId/operations`
   (staff) or `GET /api/v1/me/accounts/:accountId/operations` (the customer), and
   one receipt with `/operations/:operationId`.

Operations can never be changed or deleted: the database refuses it.

### Correcting a deposit

A deposit recorded too high (a typing error, cash not handed over) is fixed by
the store's **manager** with a correction, never by changing the deposit:
`POST /api/v1/stores/:storeId/accounts/:accountId/operations/:operationId/corrections`
with `{ "amount": "4500", "reason": "Erreur de saisie" }` and an
`Idempotency-Key` header. The answer (201) is the correction's receipt
(`R-00001`, type `CORRECTION`, the reason, and `correctedReference`: the
deposit's `D-…`). The amount is taken from the deposit's goal, then from Non
affecté; the corrections of a deposit never add up to more than it. The
customer is told in the app, by push, and by SMS, with the reason. Not in a
closed store; never on the manager's own account.

## Notifications

Every deposit notifies the customer three ways: an item in the app's list, a
push to each of their phones that registered a token, and an SMS. No real SMS or
push provider is configured yet: in development the API log shows each message
(`[SMS] To +223...: Dépôt de ...` and `[Push] Dépôt reçu: ...`); in production
it warns that nothing was sent, and the SMS and push rows end `FAILED` with
`lastError` `NoProviderConfiguredError`. Each send is recorded in the
`notifications` table with its status (`PENDING`, `SENT`, `FAILED`).

1. Register the phone for push (as the customer, Bearer session):
   `PUT /api/v1/me/devices/push-token` with `{ "token": "<FCM token>" }`
   (`{ "token": null }` turns push off on this phone).
2. Read the list: `GET /api/v1/me/notifications` (newest first, with
   `unreadCount`), and mark one read: `PATCH /api/v1/me/notifications/:id/read`.

## Goals

An account's balance is split into goals: the **Non affecté** (Unassigned) goal
every account has, and the customer's own goals, optionally grouped in projects.
The goals always add up to the balance. As the customer (Bearer session):

1. Create a project and a goal: `POST /api/v1/me/accounts/:accountId/projects`
   `{ "name": "Ma maison" }`, then `POST /api/v1/me/accounts/:accountId/goals`
   `{ "label": "Ciment", "targetAmount": "150000", "projectId": "<id>" }`
   (`projectId` is optional).
2. The seller deposits straight into it: add `"goalId": "<goal id>"` to the
   deposit body (without it, the money goes to Non affecté).
3. Move money between goals: `POST /api/v1/me/accounts/:accountId/goal-movements`
   with an `Idempotency-Key` header and `{ "sourceGoalId": "...",
   "targetGoalId": "...", "amount": "20000" }`. The balance does not change.
   History: `GET /api/v1/me/accounts/:accountId/goal-movements`.
4. Rename or retarget a goal: `PATCH .../goals/:goalId`; close it:
   `POST .../goals/:goalId/close` (what it holds goes back to Non affecté).

When a goal's balance reaches its target, the goal becomes `REACHED` and the
customer gets an "Objectif atteint" notification (in the app and by push).

## Catalogue

Each store has its own catalogue. A new store starts with 11 default
categories (Ciment, Fer et acier, ...). As a manager (Bearer session):

1. Categories: `GET` / `POST /api/v1/stores/:storeId/article-categories`
   `{ "name": "Carrelage" }`, rename with `PATCH .../article-categories/:categoryId`.
2. Articles: `POST /api/v1/stores/:storeId/articles` `{ "name": "Ciment CPA 45",
   "categoryId": "<id>", "unit": "sac de 50 kg", "price": "5000" }`; list with
   `GET .../articles?categoryId=&available=true&q=ciment`; change the name,
   category, unit, or `available` with `PATCH .../articles/:articleId`.
3. Prices: `POST .../articles/:articleId/prices` `{ "price": "5500" }` applies
   at once; `GET .../articles/:articleId/prices` is the history, newest first.

Sellers read everything; only managers change it (never in a closed store).
Names are unique per store, ignoring case. Nothing is deleted: an article no
longer sold gets `available: false`.

As the customer, savings show as material:

- Link a goal to an article: `"articleId": "<id>"` when creating the goal, or
  `PATCH .../goals/:goalId` (`null` unlinks). The goal's `equivalence` then
  gives how many units its balance and its target buy at today's price.
- `GET /api/v1/me/accounts/:accountId/articles` lists the articles on sale with
  the units the account balance buys (`?goalId=` for one goal's balance);
  `GET .../article-categories` lists the categories.

## QR codes

Customers and stores reach an account by scanning each other's QR code. A code
is random and opaque (32 characters, no data inside), created on first read,
and valid until it is regenerated. The app draws the QR from `code`.

- The customer's code: `GET /api/v1/me/qr-code`; replace it with
  `POST /api/v1/me/qr-code/regenerate`.
- The store's code (managers and sellers, to show or print at the counter):
  `GET /api/v1/stores/:storeId/qr-code`; a manager replaces it with
  `POST .../qr-code/regenerate` (not in a closed store).
- Staff scan a customer: `POST /api/v1/stores/:storeId/accounts/scan`
  `{ "code": "..." }` gives that customer's account in this store.
- A customer scans a store: `POST /api/v1/me/accounts/scan` `{ "code": "..." }`
  gives their account there.

An unknown or replaced code and a person with no account in that store give the
same 404 `Compte introuvable`; a scan never opens or joins an account.

## Material orders

A material order ("bon de sortie", `B-00001`) lists the articles a customer takes
from the store, paid from one goal of their account, then from Non affecté. No
money moves until the customer confirms. As a seller or the manager (Bearer
session):

1. Prepare: `POST /api/v1/stores/:storeId/accounts/:accountId/orders`
   `{ "goalId": "<optional, default Non affecté>", "lines": [{ "articleId": "...",
   "quantity": 10 }] }`. Each line freezes the price of the day, the name, and
   the unit. The total must fit in the goal plus Non affecté.
2. Above the store's validation threshold, a seller's order waits
   (`AWAITING_VALIDATION`): the manager validates it with
   `POST .../orders/:orderId/validate` or refuses it with `.../refuse`
   `{ "reason": "..." }`. The manager's own order is validated by preparing it.
3. Before the customer confirms, `POST .../orders/:orderId/cancel`
   `{ "reason": "<optional>" }` cancels it (a seller only their own orders).
4. Lists: `GET /api/v1/stores/:storeId/orders?status=&accountId=` for staff,
   `GET /api/v1/me/accounts/:accountId/orders` and `.../orders/:orderId` for
   the customer (no staff identity in their view).

The customer is told in the app and by push when an order awaits them. They
then confirm it (the account is debited once, `A-00001`) or refuse it:

- **With the app:** `POST /api/v1/me/accounts/:accountId/orders/:orderId/confirm`
  `{ "pin": "..." }` with an `Idempotency-Key` header; a wrong PIN counts
  toward the sign-in lockout. `.../refuse` `{ "reason": "<optional>" }`
  refuses it and alerts the manager.
- **Without the app (at the counter):** staff call
  `POST /api/v1/stores/:storeId/orders/:orderId/confirmation-code`; the customer
  receives a 6-digit code by SMS (the console sender prints it in the API log),
  reads it out, and staff enter it with `POST .../orders/:orderId/confirm`
  `{ "code": "..." }` and an `Idempotency-Key` header. A code is valid 10
  minutes for this order only.

The debit re-checks the balance; when the order's goal holds less than the
total, Non affecté tops it up first. The customer is told of the debit in the
app, by push, and by SMS.

When the store hands the material over (always the whole order), any seller or
the manager calls `POST /api/v1/stores/:storeId/orders/:orderId/deliver`: the
order goes from `CONFIRMED` to `DELIVERED`, with the date and who delivered
it, and the customer is told in the app and by push. A closed store can still
deliver, since the customer has already paid.

When a paid order will not be delivered, the **manager** cancels it with
`POST /api/v1/stores/:storeId/orders/:orderId/cancel-after-debit`
`{ "reason": "Rupture de stock" }` and an `Idempotency-Key` header: the order
goes from `CONFIRMED` to `CANCELLED_AFTER_DEBIT` and its total is re-credited
once by a correction (`R-00002`) linked to the purchase debit. The money goes
back where it came from: the order's goal regains what it paid, Non affecté
what it covered (all to Non affecté if the goal was closed since). Possible
even in a closed store; the customer is told in the app, by push, and by SMS.

Once the store's delivery delay has passed since they confirmed (30 days by
default), a customer whose paid order is still not delivered can ask to cancel
it: `POST /api/v1/me/accounts/:accountId/orders/:orderId/cancellation-request`
`{ "reason": "<optional>" }`. The order records the request and stays
`CONFIRMED`; the store's managers are told in the app and by push, and the
manager then delivers it or cancels it with re-credit. Too early, the answer is
409 with the date from which the customer can ask; one request per order.

## Disputes

A customer who disagrees with an operation of their account (a deposit, a
purchase, or a correction) disputes it from the app, and talks it through with
the store's manager in one thread (Bearer sessions):

1. The customer opens it with a first message:
   `POST /api/v1/me/accounts/:accountId/operations/:operationId/disputes`
   `{ "message": "..." }`. It is `OPEN` (awaiting the store); the managers are
   told in the app and by push. One open dispute per operation.
2. The manager reads them (`GET /api/v1/stores/:storeId/disputes?status=OPEN`)
   and replies: `POST /api/v1/stores/:storeId/disputes/:disputeId/messages`.
   It is `ANSWERED` (awaiting the customer), who is told, under the store's
   name only.
3. The customer writes again (`POST /api/v1/me/accounts/:accountId/disputes/:disputeId/messages`,
   back to `OPEN`) or closes it (`.../close`: `CLOSED`, final; a later
   disagreement is a new dispute). They read theirs at
   `GET /api/v1/me/accounts/:accountId/disputes`.

A dispute never changes an operation: a fix is a correction or a cancellation
with re-credit. Messages can never be changed or deleted.

### Admin oversight

Admins read, across every store, without acting in them:

- `GET /api/v1/admin/disputes?status=OPEN&storeId=...` (`disputes.read`): the
  disputes still waiting for an answer, `OPEN` or `ANSWERED`, newest first, with
  their threads, as the store's staff see them (names, no phone).
  `GET /api/v1/admin/disputes/:disputeId` gives one; a closed one is a 404.
- `GET /api/v1/admin/activity?storeId=...&action=...&from=2026-11-01&to=2026-11-30`
  (`activity.read`): every store's activity log, newest first, each entry with
  its store; the days are UTC and both included.
- `GET /api/v1/admin/stats?from=2026-11-01&to=2026-11-30` (`stats.read`): the
  platform's figures, in total and per country (each country with a store).
  Counts only, never amounts: stores by status and by subscription state, and
  accounts in total and suspended, as of now; stores registered, accounts
  opened, and accounts with a confirmed deposit in the period; and the trust
  signals: disputes opened in the period and unresolved now, corrections,
  refused orders, and cash closings with a discrepancy in the period. The
  period follows the store reports' rule: both days required, 366 at most.

## Cash closing

At the end of the day the store's **manager** counts the cash in the drawer
(Bearer session):

1. See what should be there:
   `GET /api/v1/stores/:storeId/cash-closings/pending` gives the deposits and
   corrections since the last closing, and the expected amount (deposits minus
   corrections; purchases and re-credits move savings, not cash).
2. Close it: `POST /api/v1/stores/:storeId/cash-closings` with
   `{ "countedTotal": "48500", "justification": "<if it differs>" }` and an
   `Idempotency-Key` header. A count that differs needs a justification
   (409 `JUSTIFICATION_REQUIRED` otherwise).
3. Read the history: `GET /api/v1/stores/:storeId/cash-closings` and
   `.../cash-closings/:closingId`.

A closing covers everything since the previous one, so a skipped day rolls into
the next. It moves no money and is final: a counting mistake is explained in the
next closing.

## Lost phone and PIN change

A customer or seller who lost their phone, or forgot their PIN, goes to their
store's **manager**, who checks their identity at the counter (Bearer session):

- Customer: `POST /api/v1/stores/:storeId/accounts/:accountId/access-reset`
- Seller: `POST /api/v1/stores/:storeId/sellers/:userId/access-reset`

The PIN is wiped, every session is closed, and no device is trusted any more, in
every store. The person then signs in as at activation: `POST /api/v1/auth/code`,
`/auth/code/verify` (`pinSet: false`), and `/auth/pin` with a new PIN. They keep
their phone number. A store manager cannot be reset this way.

A signed-in user changes their own PIN with `PUT /api/v1/me/pin`
(`{ "currentPin": "...", "newPin": "..." }`). Their sessions on other devices
close; those devices stay trusted and sign in with the new PIN.

## Security questions

The list of 10 questions is set by migrations. A user picks 3 to 5 of them and
answers with `PUT /api/v1/me/security-questions`, with their current PIN. This is
optional.

To recover with no manager: `POST /api/v1/auth/code`, `/auth/code/verify`, then
`/auth/recovery/questions` with the token, then `/auth/recovery` with an answer to
each question the user picked, a new PIN, and the device's public key. All must be
right; three wrong tries lock recovery for 24 hours. Every old session and device
loses access.

After a manager reset, someone with questions must also answer them
(`securityQuestionsRequired: true`). If they forgot their answers, the manager
sends `{ "clearSecurityQuestions": true }` with the reset, after checking their
identity.

## Transaction proofs

A photo of a receipt, or of a contract signed by hand, can be attached to a deposit
or a material order (Bearer session, multipart, one JPEG or PNG of at most 5 MB in
the field `photo`, 5 proofs at most on each):

- Staff: `POST /api/v1/stores/:storeId/accounts/:accountId/operations/:operationId/proofs`
  and `POST /api/v1/stores/:storeId/orders/:orderId/proofs`
- The account holder: the same under `/api/v1/me/accounts/:accountId/...`

`GET` on those paths lists the proofs, and `.../proofs/:proofId/file` gives the
image. A manager removes a proof with `DELETE /api/v1/stores/:storeId/proofs/:proofId`
and a `reason`: the file is deleted, and the record and the reason stay. A proof
never changes the operation or the order. Files live in the private `PROOF_DIR`,
which belongs in the backups next to `ID_PHOTO_DIR`.

## Store reports

The store's **manager** reads three reports (Bearer session), in any store status:

- `GET /api/v1/stores/:storeId/reports/totals?from=2026-10-01&to=2026-10-31`:
  deposits, corrections, purchases, and re-credits, with the cash received
- `GET /api/v1/stores/:storeId/reports/customers?status=INACTIVE`: customers, the
  quietest first. Active means a deposit in the last 30 days, or an account opened
  in the last 30 days
- `GET /api/v1/stores/:storeId/reports/sellers?from=2026-10-01&to=2026-10-31`: what
  each staff member recorded

`from` and `to` are whole days in UTC, `to` included, one year at most.

Each report downloads as a file: add `/export` to the path and `format=pdf` or
`format=xlsx` to the query, for example
`GET /api/v1/stores/:storeId/reports/totals/export?from=2026-10-01&to=2026-10-31&format=pdf`.
The customers file holds every customer of the filter, 5,000 rows at most. Each
export is written to the store's activity log.

## Nightly balance check and admin alerts

Every night at 02:00 UTC the API recomputes each account's balance, and each
goal's balance, from the ledger. A gap becomes an **admin alert**; the check never
changes a balance (a manager fixes it with a correction). The run logs one line:
`Balance check: N accounts checked, M alerts created`.

- `GET /api/v1/admin/alerts` (`alerts.read`): `status=open` (default),
  `resolved` or `all`, `type`, paginated. Each alert names the store, the
  account and the gap (stored minus computed), never a balance.
- `PATCH /api/v1/admin/alerts/:id/resolve` (`alerts.manage`): records who and
  when. A gap still there the next night creates a new alert.

The two permissions are not in the `Administrateur` role: the super admin grants
them. There is no route to start a run by hand; to see one locally, keep the API
running past 02:00 UTC.

## Delivery alerts

Every hour (minute 0, UTC) the API checks paid orders:

- A confirmed order still undelivered after `deliveryAlertDays` (default 7)
  alerts the store's active managers once, in the app and by push (no SMS). A
  closed store is skipped.
- A customer's cancellation request (11c) still unanswered after
  `cancellationEscalationHours` (default 48), the order neither delivered nor
  cancelled, becomes one `ORDER_CANCELLATION_UNANSWERED` admin alert, listed by
  `GET /api/v1/admin/alerts` with its order.

Both delays are platform settings: `GET` / `PATCH /api/v1/admin/settings`
(`settings.read` / `settings.manage`; 1 to 365 days, 1 to 720 hours). The run
logs one line: `Delivery alerts: N orders alerted, M cancellation requests
escalated`.

## Inactivity reminders

Every day at 09:00 UTC the API reminds customers whose account had no deposit
for `inactivityReminderDays` (default 30, a platform setting, 1 to 365): one
reminder per quiet period, by app, push and SMS, naming the account and the
store and never an amount. The quiet period starts at the last deposit (or the
opening); corrections and purchases do not restart it. Only active accounts in
verified stores. Balances never change. The run logs
`Inactivity reminders: N accounts reminded`.

## Production on a VPS

The API and PostgreSQL run from `docker-compose.prod.yml`; the dev
`docker-compose.yml` is separate. HTTPS comes one of two ways:

- **Our own Nginx and certbot** (the steps below): on a VPS where ports 80 and
  443 are free.
- **The VPS's existing web server**, when another one already serves those
  ports (a hosting panel like ISPConfig, other sites): see "Behind an existing
  web server (ISPConfig)" below. Our Nginx and certbot then stay off.

Before you start: Docker with Compose on the VPS, ports 80 and 443 open, and a
DNS A record for the API's domain (e.g. `api.example.com`) pointing at the VPS.

1. Write the four env files (all git-ignored), plus a fifth, `.env`, holding
   just `COMPOSE_PROFILES=proxy`: it turns on our Nginx and certbot, which are
   off otherwise. Compose reads `.env` by itself, for every command and for the
   GitHub deploys; it never reaches the image.
   - `.env.db.production` from `.env.db.production.example`: set
     `POSTGRES_PASSWORD` to a long random password (letters and digits). Do it
     **before the first start**: PostgreSQL reads the password only when it
     creates the `pgdata-prod` volume, so a later edit does not change it. Left
     empty, the database refuses to start.
   - `.env.production` from `.env.production.example`: the same password in
     `DATABASE_URL`, then `JWT_ACCESS_SECRET`, `PIN_PEPPER`, `CORS_ORIGINS`,
     `ADMIN_WEB_URL`, `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD`. The
     placeholders fail the startup validation on purpose.
   - `.env.proxy.production` from `.env.proxy.production.example`:
     `API_DOMAIN` (the domain above) and `LETSENCRYPT_EMAIL` (the Let's Encrypt
     account contact).
   - `.env.backup.production` from `.env.backup.production.example`:
     `BACKUP_PASSPHRASE`, 20+ random characters. Every backup is encrypted with
     it: store a copy in a password manager, **not** with the backups, or they
     cannot be restored.
2. Start the database and the API, get the first certificate (once, while
   Nginx is not running, so port 80 is free), then start everything:

   ```
   docker compose -f docker-compose.prod.yml up -d --build db api
   docker compose -f docker-compose.prod.yml run --rm -p 80:80 --entrypoint sh certbot \
     -c 'certbot certonly --standalone -d "$API_DOMAIN" -m "$LETSENCRYPT_EMAIL" --agree-tos --no-eff-email'
   docker compose -f docker-compose.prod.yml up -d
   ```

   The two variables are read inside the container, from
   `.env.proxy.production`. The API
   applies pending migrations (`prisma migrate deploy`) before it serves; if a
   migration fails, it does not start and the data stays as it was. The first
   start creates the super admin (`Super admin created` in the log); remove the
   two `SUPER_ADMIN_*` lines afterwards.
3. Check: `curl https://<API_DOMAIN>/api/v1/health` answers
   `{"status":"ok","database":"up"}`, `http://` redirects to `https://`, and
   `docker compose -f docker-compose.prod.yml run --rm --entrypoint certbot certbot renew --dry-run --webroot -w /var/www/certbot`
   simulates a renewal. Swagger is off in production. On the VPS itself the
   API is also on `http://127.0.0.1:3000`.

HTTPS details:

- **Renewal is automatic:** the `certbot` container tries every 12 hours and
  renews a certificate due within 30 days through port 80; Nginx reloads every
  6 hours to pick it up. Let's Encrypt **no longer emails** before a
  certificate expires, so check it yourself every week. This prints
  the end date of the certificate Nginx serves (a renewed one is about 90 days
  out):

  ```
  docker compose -f docker-compose.prod.yml run --rm --entrypoint sh certbot \
    -c 'openssl x509 -enddate -noout -in "/etc/letsencrypt/live/$API_DOMAIN/fullchain.pem"'
  ```

  Under 30 days left means renewal is failing: read
  `docker compose -f docker-compose.prod.yml logs certbot` and fix it before
  expiry, since with HSTS an expired certificate locks browsers out.
- **HSTS for 6 months:** every HTTPS answer tells browsers to use only HTTPS for
  this domain for 180 days. Once a browser has seen it, plain HTTP on that
  domain is refused there until it expires, so keep HTTPS working.
- Nginx accepts request bodies up to 6 MB (photo uploads are up to 5 MB) and
  forwards `Host`, `X-Forwarded-For` and `X-Forwarded-Proto` to the API.

Backups:

- **Every day at 01:00 UTC** the `backup` container writes two encrypted files
  to `./backups` (next to `docker-compose.prod.yml`, owner-only):
  `batisso-db-<YYYYMMDD-HHMM>.dump.enc` (the database) and
  `batisso-files-<YYYYMMDD-HHMM>.tar.gz.enc` (identity photos, proofs, store
  documents). It keeps 14 days and deletes older backup files; nothing else in
  the folder is touched. Its log: `docker compose -f docker-compose.prod.yml logs backup`.
- **On demand:** `docker compose -f docker-compose.prod.yml run --rm backup backup.sh once` (for example before
  an update).
- **Copy them off-server** regularly, from another machine, for example
  `rsync -a root@<vps>:/path/to/backend/backups/ ./batisso-backups/`
  (the files are root-owned and readable by root only). Without `--delete`, on
  purpose: if the VPS folder is lost, the next copy must not empty yours too;
  prune old copies there yourself. They are encrypted, but keep the copy private
  anyway. The certificates and the env files are not in
  the backups: Let's Encrypt reissues certificates (step 2), and you keep the
  env files and the passphrase yourself.
- **Restore**, after copying the two files of one run back into `./backups`:

  ```
  docker compose -f docker-compose.prod.yml stop api nginx
  docker compose -f docker-compose.prod.yml run --rm backup backup.sh restore-db <stamp>
  docker compose -f docker-compose.prod.yml run --rm -v batisso-prod_app-storage:/restore backup sh -c 'openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in /backups/batisso-files-<stamp>.tar.gz.enc | tar -xzf - -C /restore'
  docker compose -f docker-compose.prod.yml up -d
  ```

  `<stamp>` is the `YYYYMMDD-HHMM` part of the file names. `restore-db`
  restores into a new database first; only when that has fully succeeded does
  it swap the two, so the backup comes back exactly, even onto a database that
  has migrated since. The previous database is kept as
  `batisso_before_<date>` (the log names it); once the API works again, drop
  it with
  `docker compose -f docker-compose.prod.yml exec db psql -U batisso -d postgres -c 'DROP DATABASE "batisso_before_<date>"'`.
  If the restore fails (a wrong `BACKUP_PASSPHRASE`, a damaged file) or the
  API is still running, nothing changes. The files restore adds the backup's
  files to the private folders (existing ones with the same name are
  overwritten).

PostgreSQL settings (the `db` service's `command:` in `docker-compose.prod.yml`;
dev and tests keep the defaults):

- **Sized for a 4 GB, 2-CPU VPS** that also runs the API, Nginx and other
  work: `shared_buffers=512MB`, `effective_cache_size=2GB`, `work_mem=8MB`,
  `maintenance_work_mem=128MB`, `max_connections=50` (the API's pool is 10),
  `max_parallel_workers_per_gather=1`, and `shm_size: 256mb`. On another
  machine, scale with its RAM: `shared_buffers` about 1/8 to 1/4 of it,
  `effective_cache_size` about half. Change the values, then
  `docker compose -f docker-compose.prod.yml up -d db` restarts the database
  with them (the API reconnects); `SHOW shared_buffers;` in `psql` confirms.
- **Slow queries:** every statement over 500 ms is logged, without its values
  (no phone or name reaches the log):
  `docker compose -f docker-compose.prod.yml logs db | grep duration`.
- **Where the time goes:** `pg_stat_statements` sums up every query. The ten
  costliest:

  ```
  docker compose -f docker-compose.prod.yml exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT calls, round(total_exec_time) AS total_ms, round(mean_exec_time, 1) AS mean_ms, left(query, 80) AS query FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10"'
  ```

  The view is created when the `pgdata-prod` volume is first created
  (`docker/postgres-prod/pg_stat_statements.sql`). On a volume made before it,
  create it once with
  `docker compose -f docker-compose.prod.yml exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements"'`.

Day to day:

- Logs: `docker compose -f docker-compose.prod.yml logs -f api`
- Update: `git pull`, then `docker compose -f docker-compose.prod.yml up -d --build`
  (or the Deploy button, see "Deploys from GitHub" below)
- Password link for a super admin who cannot receive email:
  `docker compose -f docker-compose.prod.yml exec api node dist/cli/password-link.js <email>`
- Stop: `docker compose -f docker-compose.prod.yml down` keeps the data
  (`pgdata-prod`, `app-storage` and the certificate volumes; the backups are in
  `./backups`). `down -v` deletes the volumes: never run it
  on the VPS except to wipe everything on purpose.

From outside, only the web server's ports 80 and 443 are open. Inside, the services sit
on two networks: `edge` (Nginx, certbot, the API) reaches the internet, and
`data` (the API, PostgreSQL, the backups) is internal, with no route out. Only
the API is on both, so Nginx cannot reach the database, and neither the
database nor the backups can reach the internet.

### Behind an existing web server (ISPConfig)

When the VPS already runs a web server on ports 80 and 443 (here ISPConfig's
Nginx, with other sites), that server does HTTPS and forwards to the API on
`127.0.0.1:3000`. Docker runs only `db`, `api` and `backup`: **no `.env` with
`COMPOSE_PROFILES=proxy`**, so our Nginx and certbot never start and never
touch the ports. Leave the host's web server, its other sites and its own
PostgreSQL alone; ours publishes no port.

1. **The site, in ISPConfig:** Sites > Websites > the API's domain (e.g.
   `apis.example.com`, with its DNS A record on the VPS). Domain tab: **SSL** and
   **Let's Encrypt SSL** ticked; ISPConfig gets and renews the certificate.
   Redirect tab: **Rewrite HTTP to HTTPS** ticked. ISPConfig serves ports 80
   and 443 from the same server block, so without it the directives below
   would also answer on plain HTTP, and passwords, PINs and tokens could cross
   the network unencrypted. Options tab, **nginx Directives**:

   ```nginx
   client_max_body_size 6m;
   add_header Strict-Transport-Security "max-age=15552000" always;

   location / {
       proxy_pass http://127.0.0.1:3000;
       proxy_http_version 1.1;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
   }
   ```

   The body limit is for the 5 MB photo uploads (Nginx allows 1 MB otherwise).
   The `add_header` line is the same 6-month HSTS as our own Nginx (HTTPS
   details above); leave it out only if the panel's own HSTS option is already
   on, or browsers get the header twice.
2. **The env files:** `.env.db.production`, `.env.production` and
   `.env.backup.production` as in step 1 above. `.env.proxy.production` and
   `.env` are not needed.
3. **Start:** `docker compose -f docker-compose.prod.yml up -d --build`
   (migrations and the super admin as in step 2 above).
4. **Check:** `docker compose -f docker-compose.prod.yml ps` lists `db`, `api`
   and `backup`, no `nginx`; on the VPS,
   `curl http://127.0.0.1:3000/api/v1/health` answers
   `{"status":"ok","database":"up"}`; then the same through HTTPS,
   `curl https://<domain>/api/v1/health`. A `502` there means the API is not
   running, or the directive points elsewhere. Then
   `curl -sI http://<domain>/api/v1/health` answers `301` with a
   `Location: https://...` (the redirect), and
   `curl -sI https://<domain>/api/v1/health | grep -i strict-transport`
   prints the HSTS header once.

Backups, PostgreSQL settings and day to day are as above, except the restore:
stop only the API, `docker compose -f docker-compose.prod.yml stop api`, then
the same commands.

### Deploys from GitHub

After the first deploy above, updates can start from GitHub: **Actions >
Deploy > Run workflow** on `main`. The workflow
(`.github/workflows/deploy.yml`) deploys that commit only once its CI run
passed: over SSH it checks the VPS checkout, takes a backup
(`backup.sh once`), fast-forwards the checkout to the commit, then runs
`up -d --build --wait`. That starts what the VPS's `.env` selects: all five
services with `COMPOSE_PROFILES=proxy`, otherwise `db`, `api` and `backup`
(behind an existing web server). It fails, and the job turns red, when:

- it was started from another branch, or CI has not passed for the commit;
- the VPS checkout is not on `main`, has local changes, or is already past
  the commit (deploying an older commit is refused);
- the checkout cannot fast-forward (a commit made on the VPS);
- the backup fails. Nothing has changed yet: the checkout and the running
  containers stay as they were. Read
  `docker compose -f docker-compose.prod.yml logs backup`, fix it, run again;
- a service is not healthy within 5 minutes. The new containers stay: read
  `docker compose -f docker-compose.prod.yml logs api`, then deploy a fix. A
  migration is not undone by redeploying: restore the backup the run took
  first (Restore above).

One-time setup (SSH on port 22; replace `<...>`):

1. **The deploy user** owns the checkout, at an absolute path made of letters,
   digits, `.`, `_`, `/` and `-`, and runs Docker without `sudo`:
   `sudo usermod -aG docker <user>`, then log in again. The `docker` group is
   as powerful as root on the VPS: give it to this user only.
2. **The VPS reads the private repo** with a read-only deploy key. On the VPS:
   `ssh-keygen -t ed25519 -f ~/.ssh/batisso_github -N ''`; add
   `~/.ssh/batisso_github.pub` in GitHub under the repo's **Settings > Deploy
   keys**, without write access; add to `~/.ssh/config`:

   ```
   Host github.com
     IdentityFile ~/.ssh/batisso_github
     IdentitiesOnly yes
   ```

   and clone (or set the remote) with
   `git@github.com:Gtech-229/batissoBack.git`.

   **ISPConfig shell users** (a site's jailed SSH login, sharing the site
   user's number, e.g. `web16`): `ssh` and `git` look for `~/.ssh` in that site
   user's home, not your login's, so they never read the key or config above.
   Write the config with absolute paths (`IdentityFile <your-home>/.ssh/...`,
   `UserKnownHostsFile <your-home>/.ssh/known_hosts`), clone with
   `GIT_SSH_COMMAND="ssh -F <your-home>/.ssh/config" git clone ...`, then
   `git config core.sshCommand "ssh -F <your-home>/.ssh/config"` in the
   checkout so every later `git fetch` (the deploys too) uses it.
3. **A key for Actions**, made on your own machine:
   `ssh-keygen -t ed25519 -f batisso_deploy -N '' -C github-actions-deploy`.
   Append `batisso_deploy.pub` to the deploy user's `~/.ssh/authorized_keys`
   on the VPS. The private file `batisso_deploy` becomes a secret (step 5);
   delete your local copy afterwards.
4. **The VPS's host key, pinned:** on your machine,
   `ssh-keyscan -t ed25519 <vps-host>` prints one line. Check that its key
   matches the VPS's own, from an SSH session you already trust:
   `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` there against
   `ssh-keyscan -t ed25519 <vps-host> | ssh-keygen -lf -` here (the same
   `SHA256:` fingerprint). The line is the `DEPLOY_KNOWN_HOSTS` secret. If the
   VPS is ever reinstalled, its key changes and deploys stop until you update
   it.
5. **In GitHub**, **Settings > Environments > New environment** `production`:
   - **Required: Deployment branches and tags > Selected branches and tags,
     with `main` only.** A run uses the workflow file of the branch it is
     started from, so a branch with an edited `deploy.yml` would skip the
     workflow's own "main only" check and still receive the SSH key, which
     is as powerful as root on the VPS. This rule is the one GitHub enforces:
     it gives the secrets to runs from `main` only.
   - Optional: yourself as required reviewer, so each run waits for your
     approval.
   - Five secrets: `DEPLOY_HOST` (the VPS's address), `DEPLOY_USER`,
     `DEPLOY_PATH` (the checkout), `DEPLOY_SSH_KEY` (the whole private file
     from step 3) and `DEPLOY_KNOWN_HOSTS` (step 4).

The project `.npmrc` sets `legacy-peer-deps=true`: the lockfile is written
without Prisma Studio's React peers, and every install (local or in the image)
must resolve it the same way.

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
| `ADMIN_WEB_URL` | yes | | The web admin's address, used in the password links emailed to admins, e.g. `http://localhost:5173` (`http` or `https`; trailing slashes are dropped) |
| `JWT_ACCESS_SECRET` | yes | | At least 32 random characters; signs admin access tokens. The `.env.example` placeholder is deliberately too short, so the API refuses to start until you set a real one: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `PIN_PEPPER` | yes | | At least 32 random characters, mixed into every PIN hash and never stored in the database, so a leaked database alone cannot reveal PINs. Generate it like `JWT_ACCESS_SECRET` (the `.env.example` placeholder is too short on purpose) and keep it safe: **changing it later invalidates every PIN** |
| `ID_PHOTO_DIR` | no | `storage/id-photos` | Private directory of the customers' identity photos, relative to the working directory or absolute; created at startup. Never served statically; back it up with the database |
| `STORE_DOCUMENT_DIR` | no | `storage/store-documents` | Private directory of the documents sent with a store registration from the app (manager's identity, trade register); created at startup. Never served statically; back it up with the database |
| `SUPER_ADMIN_EMAIL` | when no super admin exists | | Email of the super admin created at startup |
| `SUPER_ADMIN_PASSWORD` | when no super admin exists | | 8 to 128 characters with an uppercase letter, a lowercase letter, a digit, and a special character. **Wrap it in quotes**: an unquoted `#` starts a comment. The `.env.example` placeholder breaks the rule on purpose, so the API refuses to start until you choose a real password. Once the super admin exists, both `SUPER_ADMIN_*` variables can be removed |

The app refuses to start if a variable is missing or invalid.
