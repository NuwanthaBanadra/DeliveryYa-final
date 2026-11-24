# Notifications: panel, wide modal and deep links

## 1. Where it lives

| Piece | File |
|---|---|
| Bell + dropdown + detail modal + wide modal | `src/page_comps/shared/NotificationsPanel.tsx` |
| Console top bar (uses the panel) | `src/page_comps/shared/TopBar.tsx` |
| Storefront navbar (uses the panel) | `src/page_comps/home/NavBar.tsx` |
| Path resolution for `navigate_to` | `src/util/NotificationNavigation.ts` |
| Admin sender (optional field) | `src/advance_panel/comps/admin_user/SendNotificationModal.tsx` |

Both bars pass the same props, so a change in the panel reaches the console and the storefront.

## 2. The two views

1. **Small dropdown** — the bell opens it; it lists the latest notifications (unread first in the
   backend order, `id` descending) and opens the detail modal when a notification without a link is
   clicked.
2. **Wide centered modal** — opened from **“View all”** (dropdown header) or
   **“View all notifications”** (dropdown footer). It shows the full, untruncated, multi-line message
   of every loaded notification, plus unread/read state and an “Opens page” chip on linked ones.
   It is read-only: clicking a linked notification navigates, clicking a plain one only marks it read.

## 3. Deep links (`navigate_to`)

- Backend column: `notifications.navigate_to` (`TINYTEXT`, nullable) on `entities/Notification.java`.
  `ddl-auto=update` adds it; no manual migration is needed.
- Send it with the notification: `navigateTo` on `NotificationTemplateDto`
  (`POST /api/v1/notifications/send-notification` and `…-sse`), or use the optional
  **Navigate to** field in the admin *Send Notification* modal. Blank = plain notification.
- It comes back as `navigateTo` on every item of `POST /api/v1/notifications/get-all-notifications`
  (see `NotificationDto`).
- The backend trims the value, drops blanks to `null` and prefixes a missing slash
  (`manage-users` → `/manage-users`).

### Resolution rules (`resolveNotificationPath`)

| Stored value | Current page | Navigates to |
|---|---|---|
| `/manage-users` | `/deliverYya-cloud-console/...` | `/deliverYya-cloud-console/manage-users` |
| `/manage-users` | storefront (`/`, `/store`, …) | `/manage-users` (unchanged) |
| `/deliverYya-cloud-console/manage-users` | console | unchanged (never double-prefixed) |
| `/store/all-products` | console | `/store/all-products` (storefront paths are not prefixed) |
| empty / `null` | any | no navigation — the notification opens as a normal message |

Console pages live under `/deliverYya-cloud-console`, so a stored `/manage-users` is prefixed when
the user is inside the console. The prefix is only added when the first path segment matches a real
console route (the list is in `NotificationNavigation.ts` — keep it in sync with the routes in
`App.tsx` / the hrefs in `SideBar.tsx`).

### Click behaviour

- Has a route → marked read (`PUT /notifications/mark-as-read?id=`) → dropdown/wide modal closed →
  `navigate(target)`.
- No route, clicked in the dropdown → detail modal (unchanged behaviour).
- No route, clicked in the wide modal → marked read only (the full message is already visible).

## 4. Access

The bell is still gated by `FRONTEND_ACCESS_IDS.NOTIFICATION_ACCESS` in both bars. There is no
separate access ID for the wide modal — it opens only from the bell, which is already gated.

## 4b. Notify by access (universal sender) + the "market created" notification

Backend, batch 5.

| Piece | File |
|---|---|
| Request DTO | `dto/user/AccessNotificationDto.java` |
| Response DTO | `dto/user/AccessNotificationResultDto.java` |
| Endpoint | `POST /api/v1/notifications/notify-by-access` (`NotificationController`) |
| Delivery | `NotificationServiceImpl#notifyByAccess` / `#notifyByAccessAsync` |
| Executor | `config/NotificationAsyncConfig.java` (bean `notificationTaskExecutor`) |
| SMS | the existing gateway, `SmsService#sendSingleSms` (smslenz.lk wiring in `SmsServiceImpl`) |
| Caller | `MarketServiceImpl#setMarkets` → `#notifyMarketCreated` |

**Who gets it:** every *active* user holding one of the requested `accessIds` — through the role
grant (`access_has_user_roles` → `users.user_role_id`) **or** a direct grant
(`user_has_access`, expired ones ignored). `excludeUserIds` removes users again (the market
notification excludes the user who created the market).

**Channels:** `MESSAGE` (default) writes one `notifications` row per user *and* sends the FCM push;
`EMAIL` sends through the existing `EmailService#sendEmail` (generated HTML card unless
`emailDesign` is supplied); `SMS` reuses the existing gateway —
`SmsService#sendSingleSms(SmsSingleDto)`, i.e. the number stored in `user_data.primary_mobile` and
`sms.api.*` from `application.properties`. Market creation asks for `MESSAGE` only; e-mail / SMS are
wired and can be switched on per call (`"channels": ["MESSAGE", "EMAIL", "SMS"]`).

**Asynchronous:** the audience is resolved in the request, delivery always runs on
`notificationTaskExecutor` and, when the caller is inside a transaction, only **after** that
transaction commits (`TransactionSynchronization#afterCommit`). `notifyByAccessAsync` never throws,
so a notification can never fail a market creation.

```json
POST /api/v1/notifications/notify-by-access
{
  "title": "New market waiting for approval",
  "message": "Market \"Sanka Stores\" was created by Nuwan Perera and is waiting for approval.",
  "accessIds": [56],
  "channels": ["MESSAGE"],
  "navigateTo": "/deliverYya-cloud-console/markets",
  "excludeUserIds": [42]
}
```

Response: `object = { accessIds, targetUserCount, channels, async: true, desc }` — a *queued* count,
not a delivery report (the payload is delivered on the executor).

**Market created:** `MarketServiceImpl#setMarkets` (the only place a market is inserted) queues the
notification with `accessIds = [56]` ("Market Requests", the people who review registrations) and
`navigateTo = /deliverYya-cloud-console/markets`, the page where the pending market is activated.
Both are constants at the top of `MarketServiceImpl` — change them to notify a different audience
or land on a different page.

## 5. Not done (deliberately)

- The FCM push payload (`data.type`) does not carry the route yet, so mobile deep links are
  untouched; only the in-app console/storefront behaviour uses `navigate_to`.
- The wide modal is read-only: no mark-all-read, no delete, no pagination (it shows the page that the
  bar already loaded).
