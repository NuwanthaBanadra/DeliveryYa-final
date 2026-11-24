-- ============================================================================
-- DeliveryYa – access control additions (batch 4: access management)
-- Date: 2026-11-24  (rev 2 – adds the notify-by-access API + full grants)
--
-- Incremental and INSERT-only. Written against the current live data:
--   access            AUTO_INCREMENT = 122   (rows 25 … 121)
--   access_types      AUTO_INCREMENT = 33    (rows 1 … 32)
--   apis              AUTO_INCREMENT = 232   (rows 1 … 231)
--   access_has_apis   AUTO_INCREMENT = 786   (rows 1 … 785)
--   access_has_user_roles AUTO_INCREMENT = 2552
--
-- What this adds
--   1  access type   – 33  Third Party Senders
--   2  accesses      – 122 Third Party Senders        (Mid,  type 33)
--                      123 Third Party Sender Delete   (Top,  type 33)
--   12 API rows      – the 11 controller endpoints that were still missing from
--                      `apis` (the 10 preview/force-delete pairs for market,
--                      stock, order, urgent job and branch + the third party
--                      sender create endpoint added in batch 2) and the new
--                      universal POST /notifications/notify-by-access.
--                      No other endpoint is missing: the controllers expose 243
--                      mappings, `apis` had 231.
--   15 access ↔ API links
--   +  "all accesses" grants for Super Admin (role 1) and Admin (role 2)
--
-- Idempotency: single-shot. If you ever need to re-run, delete the rows this
-- script created first (ids are listed at the top of every statement). The
-- role-grant statement in step 5 is safe to re-run – it only inserts the
-- pairs that are still missing.
-- ============================================================================

START TRANSACTION;

-- ----------------------------------------------------------------------------
-- 1. Access type
--    One type per feature area, like 28 Wallets / 30 Discounts / 32 Notifications.
-- ----------------------------------------------------------------------------
INSERT INTO `access_types` (`id`, `name`) VALUES
	(33, 'Third Party Senders');

-- ----------------------------------------------------------------------------
-- 2. Accesses
--    Level 2 = Mid  : opens the screen, create + edit
--    Level 1 = Top  : destructive (delete)
-- ----------------------------------------------------------------------------
INSERT INTO `access` (`id`, `name`, `desc`, `access_level_id`, `access_type_id`) VALUES
	(122, 'Third Party Senders', 'View, create and edit third party senders', 2, 33),
	(123, 'Third Party Sender Delete', 'Top level delete of third party sender records', 1, 33);

-- ----------------------------------------------------------------------------
-- 3. APIs
--    `apis`.`name` = the bare request path, nothing else. The interceptor
--    (ApiAccessControlInterceptor) matches this column against the incoming
--    path with AntPathMatcher, so "Controller -> method -> /path" can never
--    match. Existing rows are normalised by 2026-11-24-api-name-normalize.sql.
--    api_method_id: 1 = DELETE, 2 = POST, 3 = GET, 4 = ANY, 5 = PUT
-- ----------------------------------------------------------------------------
INSERT INTO `apis` (`id`, `name`, `desc`, `api_method_id`) VALUES
	(232, '/api/v1/orders/set-third-party-sender', 'Create a third party sender', 2),
	(233, '/api/v1/markets/preview-force-delete-market', 'Get preview of records that will be deleted for a market', 3),
	(234, '/api/v1/markets/force-delete-market', 'Force delete a market and its dependent records', 1),
	(235, '/api/v1/orders/preview-force-delete-order', 'Get preview of records that will be deleted for an order', 3),
	(236, '/api/v1/orders/force-delete-order', 'Force delete an order and its dependent records', 1),
	(237, '/api/v1/stocks/preview-force-delete-stock', 'Get preview of records that will be deleted for a stock row', 3),
	(238, '/api/v1/stocks/force-delete-stock', 'Force delete a stock row and its dependent records', 1),
	(239, '/api/v1/urgent-jobs/preview-force-delete-urgent-job', 'Get preview of records that will be deleted for an urgent job', 3),
	(240, '/api/v1/urgent-jobs/force-delete-urgent-job', 'Force delete an urgent job and its dependent records', 1),
	(241, '/api/v1/branches/preview-force-delete-branch', 'Get preview of records that will be deleted for a branch', 3),
	(242, '/api/v1/branches/force-delete-branch', 'Force delete a branch and its dependent records', 1),
	(243, '/api/v1/notifications/notify-by-access', 'Notify every user holding the given accesses (message / email / sms)', 2);

-- ----------------------------------------------------------------------------
-- 4. Access ↔ API links
--    One row per (access, api) pair – the older blocks contain duplicates, do
--    not copy that pattern. `api_feature_ids` stays NULL (API features are not
--    used yet).
-- ----------------------------------------------------------------------------
INSERT INTO `access_has_apis` (`id`, `api_feature_ids`, `access_id`, `api_id`) VALUES
	-- 122 Third Party Senders: list (88) + create (232) + update (115)
	(786, NULL, 122, 88),
	(787, NULL, 122, 232),
	(788, NULL, 122, 115),
	-- 123 Third Party Sender Delete: delete (70)
	(789, NULL, 123, 70),
	-- 103 Market Delete: force delete market
	(790, NULL, 103, 233),
	(791, NULL, 103, 234),
	-- 64 Order Delete Or Drop: force delete order
	(792, NULL, 64, 235),
	(793, NULL, 64, 236),
	-- 61 Product Delete: force delete stock row
	(794, NULL, 61, 237),
	(795, NULL, 61, 238),
	-- 114 Urgent Job Delete: force delete urgent job
	(796, NULL, 114, 239),
	(797, NULL, 114, 240),
	-- 117 Branch Management: force delete branch
	(798, NULL, 117, 241),
	(799, NULL, 117, 242),
	-- 121 Send Notifications: the universal notify-by-access endpoint
	(800, NULL, 121, 243);

-- ----------------------------------------------------------------------------
-- 5. All accesses for Super Admin (role 1) and Admin (role 2)
--    Every access that exists in `access` (today 25 … 123, including the two
--    new ones) is granted to both roles. Only the missing pairs are inserted,
--    so this statement is safe to run again after adding more accesses.
--
--    Super Admin = user_roles 1, Admin = user_roles 2.
--    Delete this statement if you prefer to grant from the console only.
-- ----------------------------------------------------------------------------
INSERT INTO `access_has_user_roles` (`access_id`, `user_roles_id`, `created_at`, `created_by`)
SELECT a.`id`, r.`id`, NOW(), 'system'
FROM `access` a
JOIN (SELECT 1 AS `id` UNION ALL SELECT 2) r
LEFT JOIN `access_has_user_roles` h
       ON h.`access_id` = a.`id`
      AND h.`user_roles_id` = r.`id`
WHERE h.`id` IS NULL;

COMMIT;

-- ----------------------------------------------------------------------------
-- 6. Verification (run after COMMIT)
-- ----------------------------------------------------------------------------
-- SELECT * FROM access WHERE id IN (122, 123);
-- SELECT * FROM apis WHERE id BETWEEN 232 AND 243;
-- SELECT a.id, a.name, ap.name FROM access_has_apis a JOIN apis ap ON ap.id = a.api_id
--  WHERE a.id BETWEEN 786 AND 800;
-- -- every access must be granted to both roles:
-- SELECT r.id, COUNT(*) AS granted
--   FROM user_roles r JOIN access_has_user_roles h ON h.user_roles_id = r.id
--  WHERE r.id IN (1, 2) GROUP BY r.id;

-- -- every delete / force-delete endpoint and the access(es) that allow it.
-- -- Rows with linked_accesses = 0 are NOT protected by any access yet (the four
-- -- legacy ones - /stocks/drop-stock, /users/drop-address-by-id,
-- -- /agent-jobs/pickup-requests/delete, /orders/user-delete-order - are not
-- -- called by the frontend).
-- SELECT ap.id, ap.name, m.name AS method,
--        COUNT(aa.id) AS linked_accesses,
--        GROUP_CONCAT(aa.access_id ORDER BY aa.access_id) AS access_ids
--   FROM apis ap
--   JOIN api_methods m ON m.id = ap.api_method_id
--   LEFT JOIN access_has_apis aa ON aa.api_id = ap.id
--  WHERE ap.name LIKE '%delete%' OR ap.name LIKE '%drop%'
--  GROUP BY ap.id, ap.name, m.name
--  ORDER BY (COUNT(aa.id) = 0) DESC, ap.id;

-- ----------------------------------------------------------------------------
-- 7. Notes
-- ----------------------------------------------------------------------------
-- * Access 122 gates the Third Party Senders menu item and route (create/edit);
--   123 gates its row delete button. There is no super-admin bypass in the
--   frontend, which is why step 5 grants 122/123 to roles 1 and 2.
-- * The "market created" notification needs no new access: it is delivered to
--   the holders of access 56 (Market Requests) through
--   POST /api/v1/notifications/notify-by-access (api 243, linked to 121).
-- * api_feature_ids / api_features are untouched – API features are still unused.
-- * Order of execution with the companion script:
--     1) 2026-11-24-access-additions.sql        (this file)
--     2) 2026-11-24-api-name-normalize.sql      (strips "Controller -> method -> "
--        from every pre-existing apis.name and links the 4 legacy delete
--        endpoints that no access holds yet)
