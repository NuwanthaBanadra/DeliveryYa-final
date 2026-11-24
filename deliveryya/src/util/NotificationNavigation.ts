/**
 * Notification deep links.
 *
 * The backend stores an optional `navigate_to` value with a notification (e.g. "/manage-users").
 * Console pages live under `/deliverYya-cloud-console/...`, so a stored "/manage-users" has to be
 * resolved against the console base when the user is already inside the console. Storefront
 * notifications keep their own paths ("/store/all-products", "/profile", ...) and are used as-is.
 */

export const CONSOLE_BASE_PATH = '/deliverYya-cloud-console';

/**
 * First path segment of every console page (must match the routes in `App.tsx` and the hrefs in
 * `advance_panel/comps/main_comps/SideBar.tsx`). Used only to decide whether a stored path is a
 * console page that needs the console prefix.
 */
const CONSOLE_TOP_LEVEL_SEGMENTS = new Set([
  'access-management',
  'accounts',
  'add-orders',
  'add-product',
  'agent-delivery-history',
  'agent-payment-handover',
  'agent-wallet',
  'argent-jobs',
  'bank-details',
  'branches',
  'career',
  'categories',
  'client-market-owner-wallet',
  'company-wallet',
  'complaints',
  'dashboard',
  'delivery-fees',
  'delivery-history',
  'discounts',
  'employee-assignments',
  'manage-users',
  'markets',
  'my-complaints',
  'my-market',
  'my-requests',
  'on-hand-orders',
  'order-checkout',
  'order-checkout-confirmation',
  'ordercode-requests',
  'pickup-requests',
  'placed-orders',
  'receiving-orders',
  'request-for-market',
  'request-for-user',
  'roles',
  'settlement-report',
  'third-party-senders',
  'urgent-jobs',
  'user-access-control',
  'user-monthly-orders',
  'user-requests',
  'users',
  'verify-documents',
]);

/**
 * Turns the stored `navigateTo` value into a router path that exists for the current location.
 *
 * - inside the console, "/manage-users"              → "/deliverYya-cloud-console/manage-users"
 * - inside the console, an already prefixed path     → unchanged
 * - inside the console, a storefront path ("/store") → unchanged
 * - outside the console (storefront), any path       → unchanged
 */
export const resolveNotificationPath = (
  navigateTo: string | null | undefined,
  currentPathname: string,
): string | null => {
  const raw = typeof navigateTo === 'string' ? navigateTo.trim() : '';
  if (!raw) return null;

  const target = raw.startsWith('/') ? raw : `/${raw}`;

  const isInsideConsole = currentPathname === CONSOLE_BASE_PATH
    || currentPathname.startsWith(`${CONSOLE_BASE_PATH}/`);

  if (!isInsideConsole) return target;
  if (target === CONSOLE_BASE_PATH || target.startsWith(`${CONSOLE_BASE_PATH}/`)) return target;

  const firstSegment = target.slice(1).split('/')[0].split('?')[0].split('#')[0];
  if (CONSOLE_TOP_LEVEL_SEGMENTS.has(firstSegment)) return `${CONSOLE_BASE_PATH}${target}`;

  return target;
};
