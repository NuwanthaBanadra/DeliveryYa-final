# Delete Endpoints — Backend Contract and Frontend Guide

This is the single reference for the delete flows updated in this work: **User,
Market, Complaint, and User Request**. Use the configured frontend API client so
its base URL, authentication token, and response handling remain consistent
with the application. Backend routes below are relative to `/api/v1`.

> **Compatibility:** existing delete routes remain available. The new Market
> force-delete routes are additive. User and Market force-delete previews
> should be used by the typed-confirmation modal. Complaint deletion is a
> simple hard delete. User Request deletion remains a soft delete.

## Common response and types

All routes return the backend `ResponseDto<T>` envelope. A preview DTO is in
`object`; successful deletes return a message in `desc`.

```ts
interface ApiResponse<T> {
  status: number | null;
  message: string;
  desc: string;
  object?: T;
  exData?: unknown;
}

interface ForceDeletePreview {
  entityName: string;
  entityId: number;
  entityIdentifier: string;
  canDelete: boolean;
  blockingReason: string | null;
  relatedRecordCounts: Record<string, number>;
  recordsToBeDeleted: string[];
  recordsToBeDetached: string[];
}

interface ForceDeleteConfirm {
  entityId: number;
  confirmed: boolean;
}
```

The force-delete request must be sent as the **DELETE request body** (Axios
`data`), not as query parameters. `confirmed` must be `true`; the backend
revalidates the preview rules in the delete transaction. A preview failure must
not open the modal. If the delete fails because data changed after preview,
show the backend error and refresh the list.

## User force delete

### Routes

```http
GET    /api/v1/users/preview-force-delete-user?userId=7
DELETE /api/v1/users/force-delete-user
       {"entityId": 7, "confirmed": true}
```

The preview displays the user's name and email. If allowed, the related rows
are removed: `user_data`, `user_requests`, `verification_data`, `notifications`,
`delivery_details`, `access_tokens`, `feedbacks`, and `user_has_access`.

Nullable references are detached (set to `NULL`) while retaining their
historical rows: `log.users_id`, `delivery_to.users_id`, and the sender/recipient
user references in `payment_records`.

Deletion is blocked while the user has employee, market, market-order, bank
account, agent/client wallet, discount, order-code/request, or pickup-request
records. The preview reports exact counts and a blocking reason. When blocked,
`canDelete` is false and both operation lists are empty.

### Frontend example: typed confirmation

```tsx
import { confirmDelete } from '../components/DeleteConfirmModal';

async function deleteUser(userId: number) {
  const previewResponse = await api.get<ApiResponse<ForceDeletePreview>>(
    '/users/preview-force-delete-user',
    { params: { userId } },
  );
  const preview = previewResponse.data.object;
  if (!preview) throw new Error('The delete preview was missing');

  const confirmed = await confirmDelete({
    title: 'Confirm Force Delete',
    itemName: preview.entityIdentifier,
    itemLabel: preview.entityName,
    message: 'This permanently deletes the user and the related records listed below.',
    confirmText: 'Yes, permanently delete!',
    details: preview,
  });
  if (!confirmed) return;

  await api.delete<ApiResponse<void>>('/users/force-delete-user', {
    data: { entityId: preview.entityId, confirmed: true } satisfies ForceDeleteConfirm,
  });
  // Show success and refresh the users list.
}
```

## Market force delete

### Routes

```http
GET    /api/v1/markets/preview-force-delete-market?marketId=12
DELETE /api/v1/markets/force-delete-market
       {"entityId": 12, "confirmed": true}
```

The market catalog includes products whose brand **or** category belongs to
that market. If allowed, the backend removes product images and stock first,
then products, brands, categories, sizes, and the market. Market logo, cover,
category, and product image files are cleaned up only after the transaction
commits. The owning user's `has_market` flag is cleared and their role is reset
to Customer (`user_roles.id = 6`).

The backend blocks the deletion if there is product feedback, market-order
history for affected stock, a product linked to catalog data from another
market, or another market's stock row using this market's sizes. `canDelete`
will be false and `blockingReason` explains what must be resolved. While
blocked, both operation lists are empty. Related counts include `brands`,
`categories`, `sizes`, `products`, `product_images`, `stock_rows`, `feedbacks`,
`market_order_items`, `products_linked_to_other_markets`, and
`stock_rows_linked_to_other_markets`.

```tsx
async function deleteMarket(marketId: number) {
  const previewResponse = await api.get<ApiResponse<ForceDeletePreview>>(
    '/markets/preview-force-delete-market',
    { params: { marketId } },
  );
  const preview = previewResponse.data.object;
  if (!preview) throw new Error('The delete preview was missing');

  const confirmed = await confirmDelete({
    title: 'Confirm Force Delete',
    itemName: preview.entityIdentifier,
    itemLabel: preview.entityName,
    message: 'This permanently deletes the market and its unused catalog records.',
    confirmText: 'Yes, permanently delete!',
    details: preview,
  });
  if (!confirmed) return;

  await api.delete<ApiResponse<void>>('/markets/force-delete-market', {
    data: { entityId: preview.entityId, confirmed: true } satisfies ForceDeleteConfirm,
  });
  // Show success and refresh the markets list.
}
```

### Existing Market delete route

`DELETE /api/v1/markets/delete-market?marketId=12` remains available for older
call sites. Its behavior is unchanged: it hard-deletes a market if no FK
references prevent that; otherwise it marks the market inactive/deleted. New
confirmation-modal call sites should use the preview/force-delete pair above.

## Catalog and stock deletion

### Product, Category, and Brand

The existing preview/force-delete endpoint pairs are:

| Entity | Preview | Permanent delete |
|---|---|---|
| Product | `GET /api/v1/products/preview-force-delete-product?productId=12` | `DELETE /api/v1/products/force-delete-product` |
| Category | `GET /api/v1/products/preview-force-delete-category?categoryId=4` | `DELETE /api/v1/products/force-delete-category` |
| Brand | `GET /api/v1/products/preview-force-delete-brand?brandId=9` | `DELETE /api/v1/products/force-delete-brand` |

Each delete takes `{"entityId": <id>, "confirmed": true}` in the JSON body.
Product force-delete removes its stock rows, product images, and product row.
It is blocked while feedback or market-order items reference the product.
Category and Brand force-delete remove only the selected category/brand and are
blocked while products reference them. Product image files are removed after
commit; category image files are also removed after commit.

The existing simple `DELETE /api/v1/products/delete-product-by-id?id=...`,
`DELETE /api/v1/products/delete-category?id=...`, and
`DELETE /api/v1/products/delete-brand?id=...` routes retain their current
soft-delete behavior. Use the force routes when a permanent, previewed deletion
is intended.

Example for the Product flow (use the same shape with the Category or Brand
preview/delete paths and ID parameter):

```tsx
async function forceDeleteProduct(productId: number) {
  const response = await api.get<ApiResponse<ForceDeletePreview>>(
    '/products/preview-force-delete-product', { params: { productId } },
  );
  const preview = response.data.object;
  if (!preview) throw new Error('The delete preview was missing');
  const confirmed = await confirmDelete({
    title: 'Confirm Force Delete',
    itemName: preview.entityIdentifier,
    itemLabel: preview.entityName,
    message: 'This permanently deletes the product and unreferenced related rows.',
    confirmText: 'Yes, permanently delete!',
    details: preview,
  });
  if (!confirmed) return;
  await api.delete<ApiResponse<void>>('/products/force-delete-product', {
    data: { entityId: preview.entityId, confirmed: true } satisfies ForceDeleteConfirm,
  });
  // Show success and refresh the product list.
}
```

### Stock

```http
GET    /api/v1/stocks/preview-force-delete-stock?stockId=19
DELETE /api/v1/stocks/force-delete-stock
       {"entityId": 19, "confirmed": true}
```

Stock is permanently deleted only when no `market_order_items` use it. If it is
referenced by order history, `canDelete` is false and the preview explains the
block. The product, size, and unit remain. This endpoint does not alter payment
records or payment-record items. Frontend call example:

```tsx
async function forceDeleteStock(stockId: number) {
  const response = await api.get<ApiResponse<ForceDeletePreview>>(
    '/stocks/preview-force-delete-stock', { params: { stockId } },
  );
  const preview = response.data.object;
  if (!preview) throw new Error('The delete preview was missing');
  const confirmed = await confirmDelete({
    title: 'Confirm Force Delete',
    itemName: preview.entityIdentifier,
    itemLabel: preview.entityName,
    message: 'This permanently deletes the stock row if no order history uses it.',
    details: preview,
  });
  if (!confirmed) return;
  await api.delete<ApiResponse<void>>('/stocks/force-delete-stock', {
    data: { entityId: preview.entityId, confirmed: true } satisfies ForceDeleteConfirm,
  });
  // Show success and refresh stocks.
}
```

## Order force delete

```http
GET    /api/v1/orders/preview-force-delete-order?orderId=72
DELETE /api/v1/orders/force-delete-order
       {"entityId": 72, "confirmed": true}
```

The preview lists the order's deliveries, delivery contact, complaints,
market-order items, and market order that will be removed. Deletion is blocked
if the market order is shared by another order. After revalidation, the
transaction removes those dependent operational rows, then the order and its
exclusive market-order data. The order code itself is retained.

**Payment records are preserved.** The order delete does not delete or update
`payment_records` or `payment_record_items`. Their matching counts, when the
order code appears in payment-record items, are included in
`relatedRecordCounts` as `payment_records_preserved` and
`payment_record_items_preserved`; those rows are not listed for deletion or
detachment.

Frontend call example:

```tsx
async function forceDeleteOrder(orderId: number) {
  const response = await api.get<ApiResponse<ForceDeletePreview>>(
    '/orders/preview-force-delete-order', { params: { orderId } },
  );
  const preview = response.data.object;
  if (!preview) throw new Error('The delete preview was missing');
  const confirmed = await confirmDelete({
    title: 'Confirm Force Delete',
    itemName: preview.entityIdentifier,
    itemLabel: preview.entityName,
    message: 'This permanently deletes the order and operational rows shown below. Payment records remain.',
    details: preview,
  });
  if (!confirmed) return;
  await api.delete<ApiResponse<void>>('/orders/force-delete-order', {
    data: { entityId: preview.entityId, confirmed: true } satisfies ForceDeleteConfirm,
  });
  // Show success and refresh orders.
}
```

The existing `DELETE /api/v1/orders/drop-order-by-id?orderId=...` remains a
soft delete and is unchanged. Refresh the order list after success or a
force-delete error.

## Payment-record preservation guarantee

The permanent delete statements added for Product, Stock, and Order do not
issue `DELETE` or `UPDATE` statements against `payment_records` or
`payment_record_items`. Product and Stock deletion is blocked while stock has
market-order history. Order deletion keeps payment records and their line items
as historical financial data. Existing user force deletion's explicit user
reference detachment is a separate account-removal behavior and is not part of
these Product/Stock/Order flows.

## Urgent Job force delete

### Routes

```http
GET    /api/v1/urgent-jobs/preview-force-delete-urgent-job?urgentJobId=21
DELETE /api/v1/urgent-jobs/force-delete-urgent-job
       {"entityId": 21, "confirmed": true}
```

The preview lists dependent `agent_job_tasks`, `agent_jobs`, and
`urgent_job_items`. The permanent delete removes them child-first, then deletes
the urgent job. Any payment records or payment-record items whose code matches
the job code are reported as `payment_records_preserved` /
`payment_record_items_preserved` and are never modified. The existing
`DELETE /urgent-jobs/delete-urgent-job-by-id?id=...` remains for older call
sites; use the force preview/confirm pair for the typed modal.

```tsx
async function forceDeleteUrgentJob(urgentJobId: number) {
  const response = await api.get<ApiResponse<ForceDeletePreview>>(
    '/urgent-jobs/preview-force-delete-urgent-job', { params: { urgentJobId } },
  );
  const preview = response.data.object;
  if (!preview) throw new Error('The delete preview was missing');
  const confirmed = await confirmDelete({
    title: 'Confirm Force Delete',
    itemName: preview.entityIdentifier,
    itemLabel: preview.entityName,
    message: 'This permanently deletes the urgent job and its related operational records.',
    details: preview,
  });
  if (!confirmed) return;
  await api.delete<ApiResponse<void>>('/urgent-jobs/force-delete-urgent-job', {
    data: { entityId: preview.entityId, confirmed: true } satisfies ForceDeleteConfirm,
  });
  // Show success and refresh urgent jobs.
}
```

## Delivery Fee delete (simple delete)

```http
DELETE /api/v1/delivery-fees/delete-delivery-fee?id=8
```

A delivery fee has no dependent rows in the supplied schema. The existing
endpoint now deletes only the selected `delivery_fees` row with a parameterized
`JdbcTemplate` statement. Existing route authorization and not-found behavior
are retained. Use the typed simple-delete modal, then call:

```tsx
const confirmed = await confirmDelete({
  title: 'Delete delivery fee?',
  itemName: fee.city.name,
  itemLabel: 'Delivery fee',
  message: 'This removes the delivery fee for this city.',
});
if (!confirmed) return;
await api.delete<ApiResponse<void>>('/delivery-fees/delete-delivery-fee', {
  params: { id: fee.id },
});
// Show success and refresh delivery fees.
```

## User/City Discount delete (simple delete)

The existing discount route uses a `POST` body rather than `DELETE`:

```http
POST /api/v1/discounts/delete
Content-Type: application/json

{"userId": 7, "cityId": 14}
```

A discount row has no child records. The endpoint removes only the matching
`discount` row; it does not delete its user, city, or any payment data.
The service now uses a parameterized `JdbcTemplate` delete and retains its
existing not-found response.

```tsx
const confirmed = await confirmDelete({
  title: 'Delete discount?',
  itemName: `${discount.discount}% — ${discount.city.name}`,
  itemLabel: 'Discount',
  message: 'This removes this user discount for the selected city.',
});
if (!confirmed) return;
await api.post<ApiResponse<void>>('/discounts/delete', {
  userId: discount.user.id,
  cityId: discount.city.id,
});
// Show success and refresh the discounts list.
```

## Branch force delete

### Routes

```http
GET    /api/v1/branches/preview-force-delete-branch?branchId=3
DELETE /api/v1/branches/force-delete-branch
       {"entityId": 3, "confirmed": true}
```

**At least one branch must remain. The last branch cannot be deleted.** Both
preview and delete also protect employee assignments and financial history.
A branch with employees assigned as their primary branch, non-initialization
company-wallet entries, or payment records referring to it is blocked until
those records are reassigned or resolved. If safe, only its
`branch_has_employee` links and untouched zero-balance wallet initializer row
are removed before the branch. Payment records are preserved and never
modified. The force-delete transaction locks branch rows and rechecks the
branch count, preventing concurrent requests from deleting every branch.

```tsx
async function forceDeleteBranch(branchId: number) {
  const response = await api.get<ApiResponse<ForceDeletePreview>>(
    '/branches/preview-force-delete-branch', { params: { branchId } },
  );
  const preview = response.data.object;
  if (!preview) throw new Error('The delete preview was missing');
  const confirmed = await confirmDelete({
    title: 'Confirm Branch Delete',
    itemName: preview.entityIdentifier,
    itemLabel: preview.entityName,
    message: 'At least one branch must remain. Review affected assignments and wallet data.',
    details: preview,
  });
  if (!confirmed) return;
  await api.delete<ApiResponse<void>>('/branches/force-delete-branch', {
    data: { entityId: preview.entityId, confirmed: true } satisfies ForceDeleteConfirm,
  });
  // Show success and refresh branches.
}
```

## Complaint delete (simple delete)

```http
DELETE /api/v1/complains/delete-complain-by-id?id=42
```

The existing service authorization/ownership check is retained. After that
check, the backend deletes only the complaint row using a parameterized SQL
statement. It does not delete the related order or urgent-job record. This
route has no related rows to preview, so it can use the modal's simple-delete
flow:

```tsx
const confirmed = await confirmDelete({
  title: 'Delete complaint?',
  itemName: complaint.subject,
  itemLabel: 'Complaint',
  message: 'This permanently deletes the complaint.',
});
if (!confirmed) return;
await api.delete<ApiResponse<void>>('/complains/delete-complain-by-id', {
  params: { id: complaint.id },
});
// Show success and refresh the complaints list.
```

## User Request delete (soft delete)

```http
DELETE /api/v1/users/delete-request?userRequestId=42
```

This keeps the existing soft-delete behavior: the row remains in
`user_requests`, `is_deleted` becomes `1`, and `doc_urls` is cleared. Attached
document files are removed only after the database transaction commits. It
uses the simple-delete modal flow; there is no preview endpoint for this route.

```tsx
const confirmed = await confirmDelete({
  title: 'Delete request?',
  itemName: request.title,
  itemLabel: 'User request',
  message: 'This hides the request and removes its attached documents.',
});
if (!confirmed) return;
await api.delete<ApiResponse<void>>('/users/delete-request', {
  params: { userRequestId: request.id },
});
// Show success and refresh the requests list.
```

## Operational notes

- Let the application's existing relation-based access control authorize these
  routes; this change does not add role annotations.
- Keep modal text consistent with the endpoint semantics: force delete is
  permanent, while deleting a User Request is a soft delete.
- On force-delete errors, do not treat the record as deleted. Display the
  backend message and refresh preview/list data as appropriate.
- The existing API routes and generated endpoint documentation may contain
  additional business restrictions; this guide documents the behavior added in
  the backend implementation.
