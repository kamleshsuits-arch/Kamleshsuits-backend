# Automatic collection and voucher notifications

New in-stock products created through the admin API enqueue a category-specific
push with the product name, selling price, image and product-detail link. A newly
created voucher enqueues its percentage/rupee offer, code, eligible collections,
minimum eligible spend and expiry. Ordinary edits do not send launch alerts.

Alerts go to all active push subscriptions, including installed apps and guests
who allowed notifications. Installation alone cannot grant notification permission.
No historical catalog backfill or customer test broadcast is performed.

## Delivery and history

Catalog data and its alert are saved in one DynamoDB transaction. The backend
drains the persistent queue immediately and every 30 seconds while running;
Render downtime delays delivery until the backend wakes. No additional service or
environment variables are needed beyond the existing VAPID values and DynamoDB
permissions (including TransactWriteItems and UpdateItem).

History appears in Admin → Notifications with automatic source, pending/sending/
sent/partial/failed/skipped status and counts. Temporary delivery failures retry
only failed subscription IDs, up to five attempts with backoff. Expired subscriptions
are removed. Queued alerts expire after 24 hours (or earlier for expiring vouchers).
Deleted, changed, expired or exhausted vouchers are skipped before dispatch.

Delivery is at-least-once: a process crash after push acceptance but before saving
delivery results can cause redelivery. Stable notification tags replace the same
device alert. Push-provider acceptance is not proof a user saw the notification.

## Bulk imports

Add `inventoryNotificationWrites(items, uniqueBatchId)` from
`libs/catalogNotifications.js` to the same `TransactItems` array as new product
writes. It groups by category/subcategory to avoid per-photo or per-colour alerts.
Keep each transaction within DynamoDB's 100-action limit. The local
`importNewCollection.js` and `importHomeLinenExtension.js` workflows include this
hook; do not rerun previously applied imports. Arbitrary direct database writes
outside these workflows do not trigger alerts.

## Verification (mocked, no customer pushes)

`node --test scripts/catalog-notifications.test.js scripts/catalog-notification-routes.test.js scripts/push-delivery.test.js scripts/push-audience.test.js`

The matching frontend release adds category/voucher landing links and automatic
notification history labels. Publish both frontend and backend changes together.
