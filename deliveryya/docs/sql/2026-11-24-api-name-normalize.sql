-- ============================================================================
-- DeliveryYa – normalise `apis`.`name` to the bare request path
-- Date: 2026-11-24
--
-- Companion script for 2026-11-24-access-additions.sql (run that one first).
--
-- WHY
--   ApiAccessControlInterceptor resolves the incoming request like this:
--     ApiRepo#findAllApiRoutes  ->  select a.id, a.name, m.name
--     AntPathMatcher.match(route.getName(), requestPath)
--   `apis`.`name` is therefore used as the *path pattern*. Rows that store
--   "Controller -> method -> /api/v1/..." can never match a real request:
--     GET  /api/v1/orders/get-third-party-senders
--     vs   Controller -> getThirdPartySenders -> /api/v1/orders/get-third-party-senders
--   Those APIs are silently unenforced today (the interceptor allows an
--   unmatched API). The moment the match starts working again, an API that is
--   matched but not granted to anyone turns into a 403 for every user - which
--   is why this script also links the 4 legacy delete endpoints nobody holds.
--
-- AFTER THIS SCRIPT
--   apis.name = '/api/v1/orders/set-third-party-sender'   <- request path only
--   apis.desc = 'Create a third party sender'             <- human description
--
--   UPDATE only: ids are kept, so access_has_apis / api_features / user grants
--   are untouched. Rows that are already paths are skipped.
-- ============================================================================

START TRANSACTION;

-- ----------------------------------------------------------------------------
-- 1. Backup (recommended once, uncomment)
-- ----------------------------------------------------------------------------
-- CREATE TABLE `apis_backup_20261124` AS SELECT * FROM `apis`;

-- ----------------------------------------------------------------------------
-- 2. PRE-CHECK – exactly which rows change, and to what
--    Eyeball this before committing: every new_name must start with '/'.
-- ----------------------------------------------------------------------------
SELECT `id`,
       `name`                                     AS old_name,
       TRIM(SUBSTRING_INDEX(`name`, ' -> ', -1))  AS new_name
FROM `apis`
WHERE `name` LIKE '% -> %'
ORDER BY `id`;

-- ----------------------------------------------------------------------------
-- 3. PRE-CHECK – would two rows end up with the same path?
--    Only a problem if `apis`.`name` carries a UNIQUE index; the table has no
--    such constraint today (the entity only declares `name` as a normal column).
-- ----------------------------------------------------------------------------
SELECT TRIM(SUBSTRING_INDEX(`name`, ' -> ', -1)) AS path_only, COUNT(*) AS rows_after_update
FROM `apis`
WHERE `name` LIKE '% -> %'
GROUP BY path_only
HAVING COUNT(*) > 1;

-- ----------------------------------------------------------------------------
-- 4. Normalise: keep the text after the last ' -> ', trimmed.
--    Rows whose tail does not look like a path are left alone.
-- ----------------------------------------------------------------------------
UPDATE `apis`
SET `name` = TRIM(SUBSTRING_INDEX(`name`, ' -> ', -1))
WHERE `name` LIKE '% -> %'
  AND TRIM(SUBSTRING_INDEX(`name`, ' -> ', -1)) LIKE '/%';

COMMIT;

-- ----------------------------------------------------------------------------
-- 5. POST-CHECK – rows whose name still does not start with '/' (expected: empty)
--
--    If this lists rows from the very first seed blocks (their `name` holds the
--    prose and `desc` holds the path, e.g. 1 = 'API for create new access' /
--    '/api/v1/access/create-new-access'), swap them for those ids only:
--
--      UPDATE `apis` SET `name` = `desc`, `desc` = 'Access management endpoint'
--       WHERE `id` IN (/* ids from this result */);
-- ----------------------------------------------------------------------------
SELECT `id`, `name`, `desc`
FROM `apis`
WHERE `name` NOT LIKE '/%'
ORDER BY `id`;

-- ----------------------------------------------------------------------------
-- 6. Link the delete endpoints that no access holds (otherwise 403 for
--    everyone once the matcher starts working).
--
--    Only rows with *no* access link at all are touched, so existing mappings
--    are never duplicated or overridden. Change the access_id if you prefer a
--    different owner for one of them:
--      /stocks/drop-stock                     -> 61  Product Delete
--      /users/drop-address-by-id              -> 41  Profile Panel (own data)
--      /agent-jobs/pickup-requests/delete     -> 65  Agent Job Delete
--      /orders/user-delete-order              -> 108 Own Order Cancel
--
--    (None of these four is called by the current frontend; they are kept
--     protected rather than left unenforced.)
-- ----------------------------------------------------------------------------
INSERT INTO `access_has_apis` (`api_feature_ids`, `access_id`, `api_id`)
SELECT NULL, m.access_id, ap.`id`
FROM `apis` ap
JOIN (
    SELECT '/api/v1/stocks/drop-stock'                 AS `name`, 61  AS `access_id`
    UNION ALL SELECT '/api/v1/users/drop-address-by-id',          41
    UNION ALL SELECT '/api/v1/agent-jobs/pickup-requests/delete', 65
    UNION ALL SELECT '/api/v1/orders/user-delete-order',         108
) m ON m.`name` = ap.`name`
WHERE NOT EXISTS (SELECT 1 FROM `access_has_apis` x WHERE x.`api_id` = ap.`id`);

-- ----------------------------------------------------------------------------
-- 7. Verification
-- ----------------------------------------------------------------------------
-- -- sample of the normalised rows written by the additions script:
-- SELECT id, name, desc, api_method_id FROM apis WHERE id BETWEEN 232 AND 243;
-- -- nothing left with the old format:
-- SELECT COUNT(*) AS still_prefixed FROM apis WHERE name LIKE '% -> %';
-- -- every delete/drop endpoint and the access(es) that allow it
-- -- (linked_accesses = 0 means "unprotected"):
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
-- 8. Notes
-- ----------------------------------------------------------------------------
-- * `apis.desc` keeps the human description – the console (Access Catalogue)
--   still shows it under the path, so nothing becomes unreadable.
-- * Path variables (`{branchId}`) are fine: AntPathMatcher treats them as
--   templates and still matches the concrete request path.
-- * The interceptor is still short-circuited in code (`if (true) return true;`
--   in ApiAccessControlInterceptor#preHandle), so nothing is enforced until you
--   remove that line. Do this normalisation first, then switch it on – in that
--   order the matched-but-ungranted 403s cannot happen.
