# Access management – batch 4

Access work for this batch, in the order it has to be applied:

1. run `docs/sql/2026-11-24-access-additions.sql` (INSERT-only, see below),
2. run `docs/sql/2026-11-24-api-name-normalize.sql` — `apis.name` must be the
   bare request path or the interceptor can never match it (§3),
3. the additions script already grants **every** access to Super Admin (role 1)
   and Admin (role 2) — grant anything else you need from the console,
4. deploy the backend + frontend (both already wired to the new ids).

The source of truth for the ids is `src/util/FrontendAccess.ts`
(`FRONTEND_ACCESS_IDS`). `docs/access.sql` is an old full dump (it stops at
access 69) — do **not** rebuild the schema from it.

---

## 1. What the database gets

| Table | Rows | Why |
|---|---|---|
| `access_types` | 1 → id 33 `Third Party Senders` | one type per feature area, same as 28 Wallets / 30 Discounts / 32 Notifications |
| `access` | 2 → 122 `Third Party Senders` (Mid), 123 `Third Party Sender Delete` (Top) | the third party sender screen had no access id at all (§13.4 of `DELETE_CONFIRM_MODAL.md`) |
| `apis` | 12 → ids 232 … 243 | every controller mapping is now in the catalog |
| `access_has_apis` | 15 → ids 786 … 800 | links listed below |
| `access_has_user_roles` | all missing (access, role) pairs for roles 1 and 2 | "give all access to Super Admin and Admin" |

### The 12 missing API rows

`apis` had 231 rows while the controllers expose 243 mappings. The ones that were
missing are exactly the endpoints added after that dump was taken — they are
called by the current frontend and would have been rejected the day backend
access enforcement is switched on:

| API | Endpoint | Linked to access |
|---|---|---|
| 232 | `POST /api/v1/orders/set-third-party-sender` | 122 |
| 233 / 234 | `GET /api/v1/markets/preview-force-delete-market`, `DELETE /force-delete-market` | 103 Market Delete |
| 235 / 236 | `GET /api/v1/orders/preview-force-delete-order`, `DELETE /force-delete-order` | 64 Order Delete Or Drop |
| 237 / 238 | `GET /api/v1/stocks/preview-force-delete-stock`, `DELETE /force-delete-stock` | 61 Product Delete |
| 239 / 240 | `GET /api/v1/urgent-jobs/preview-force-delete-urgent-job`, `DELETE /force-delete-urgent-job` | 114 Urgent Job Delete |
| 241 / 242 | `GET /api/v1/branches/preview-force-delete-branch`, `DELETE /force-delete-branch` | 117 Branch Management |
| 243 | `POST /api/v1/notifications/notify-by-access` | 121 Send Notifications |

The 8 force-delete rows that did exist (user, product, category, brand) were
already linked to 106 / 104 / 61 / 63 / 62 — reuse those, no change.

### Access ↔ API links added

| Access | APIs |
|---|---|
| 122 Third Party Senders | 88 `get-third-party-senders` (list), 232 `set-third-party-sender` (create), 115 `update-third-party-sender` |
| 123 Third Party Sender Delete | 70 `delete-third-party-sender` |
| 103 Market Delete | 233, 234 |
| 64 Order Delete Or Drop | 235, 236 |
| 61 Product Delete | 237, 238 |
| 114 Urgent Job Delete | 239, 240 |
| 117 Branch Management | 241, 242 |
| 121 Send Notifications | 243 `notify-by-access` |

One row per (access, api) pair. Some older blocks in the database repeat the same
pair a dozen times — that is noise from a per-role insert loop, don't copy it.

---

### Super Admin and Admin get everything

Step 5 of the script grants **every row of `access`** (today 25 … 123) to role 1
(Super Admin) and role 2 (Admin) and skips the pairs that already exist, so it
can be run again after more accesses are added:

```sql
INSERT INTO `access_has_user_roles` (`access_id`, `user_roles_id`, `created_at`, `created_by`)
SELECT a.`id`, r.`id`, NOW(), 'system'
FROM `access` a
JOIN (SELECT 1 AS `id` UNION ALL SELECT 2) r
LEFT JOIN `access_has_user_roles` h
       ON h.`access_id` = a.`id` AND h.`user_roles_id` = r.`id`
WHERE h.`id` IS NULL;
```

That is also what makes the Third Party Senders screen (122) visible for them
right after the script runs — see the warning below.

## 2. What the frontend now gates

`hasAccess` / `hasAnyAccess` come from `src/util/AccessController.ts` and read
the ids cached for the signed-in user, so the checks are synchronous
(`useMemo(() => hasAccess(...), [])`, the pattern already used by
`PlacedOrders.tsx`).

| Screen | Option | Access |
|---|---|---|
| Menu → OPERATIONS → Third Party Senders | sidebar item | **122** |
| Route `third-party-senders` | whole screen (and with it Add / Edit) | **122** |
| Third Party Senders | row → trash icon | **123** (hidden without it; verified in `ThirdPartySenders.tsx`) |
| Ordercode Requests | row → delete request | **112** `ORDERCODE_REQUEST_DELETE` (hidden without it) |
| Receiving Orders | “Delete order” on the card **and** in the details panel | **108** `OWN_ORDER_CANCEL` (hidden without it) |

Notes

- **No new access for order-code delete.** 112 `Ordercode Request Delete` (Top)
  already existed and was already linked to `DELETE /orders/delete-order-code-request`,
  so it is reused instead of adding the `ORDER_CODE_REQUEST_DELETE_COMPANY` id
  that §13.2 of `DELETE_CONFIRM_MODAL.md` had pencilled in. The backend rule
  (“printed requests can only be deleted by the company side”) is unchanged —
  backend access enforcement is still paused.
- **Cancelling your own pending order** (`/orders/drop-order-by-id`) stays
  reachable for clients / market owners through 108, which is granted to every
  role today, so nothing disappears for them.
- **Nothing else changed.** Every other console route and destructive action was
  audited: all other sidebar items and routes already carry `allowedAccessIds`,
  and every other delete entry point is already gated (see the table in
  `DELETE_CONFIRM_MODAL.md` §12/§13).

### ⚠ Before you deploy

There is **no super-admin bypass** in the frontend — the menu item and the route
are hidden until access **122** is granted to the role(s) that should use the
screen. Step 5 of the script already does that for Super Admin and Admin; if you
drop that statement, grant 122 (and 123 where deletion is wanted) before or
together with the deployment, otherwise the screen is invisible for everybody.

| Access | Granted by the script | Add manually if needed |
|---|---|---|
| 122 Third Party Senders | roles 1 super admin, 2 admin | 3 owner, 4 manager, 15 markets manager … |
| 123 Third Party Sender Delete | roles 1 super admin, 2 admin | — |

---

## 3. Before you switch backend enforcement on

`ApiAccessControlInterceptor` is short-circuited today (`preHandle` returns
`true` unconditionally). When it is re-enabled:

1. **`apis.name` must be the bare request path.** The interceptor matches that
   column against the incoming path with `AntPathMatcher`
   (`ApiRepo#findAllApiRoutes` → `pathMatcher.match(route.getName(), path)`), so
   a row storing `Controller -> method -> /api/v1/...` can never match and its
   API stays *unenforced* (an unmatched API is allowed — the interceptor fails
   open). The rows added by this batch carry the path only, and
   **`docs/sql/2026-11-24-api-name-normalize.sql`** rewrites the pre-existing
   ones that still use the old format:

   ```
   Controller -> getThirdPartySenders -> /api/v1/orders/get-third-party-senders
   ↓
   /api/v1/orders/get-third-party-senders
   ```

   The same script links the four legacy delete endpoints that no access holds
   (`/stocks/drop-stock`, `/users/drop-address-by-id`,
   `/agent-jobs/pickup-requests/delete`, `/orders/user-delete-order`) — without
   that, those become a 403 for everyone the moment matching starts working.
   Order: additions script → normalise script → remove the short-circuit.
2. **Nothing falls back to role level.** An access that is not granted to a role
   is a hard "no"; there is no super-admin bypass (frontend or interceptor).
   That is why step 5 of the additions script grants everything to roles 1 and 2.

## 4. Deliberately not done

- **API features** (`api_features`, `access_has_apis.api_feature_ids`) stay
  untouched — only one feature (`createReturnPayment`) is in use and nothing in
  this batch needs a sub-permission. `api_feature_ids` is written as `NULL`.
- **Backend enforcement** is not switched on. The new `apis` rows exist so that
  it *can* be switched on without breaking the screens above.
- **No per-user grants.** The script grants all accesses to the two admin roles
  only (step 5); individual users and the remaining roles stay with you.
