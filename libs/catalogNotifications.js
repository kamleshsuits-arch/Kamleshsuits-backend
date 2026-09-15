import { createHash } from 'node:crypto';
import { DEFAULT_PRODUCT_CATEGORY, getProductCategory } from '../config/productTaxonomy.js';

const money = value => `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const text = (value, length) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, length);
const categoryId = product => product.product_category || DEFAULT_PRODUCT_CATEGORY;
const categoryLabel = id => getProductCategory(id)?.label || 'our collection';

export const inventoryMessage = products => {
  const available = products.filter(product => Number(product.stock) > 0);
  if (!available.length) return null;
  const first = available[0];
  const category = categoryId(first);
  const label = first.product_subcategory || categoryLabel(category);
  const single = available.length === 1;
  const price = Math.min(...available.map(product => Number(product.price)));
  return {
    title: text(`New arrival${single ? '' : 's'} · ${label}`, 80),
    body: single
      ? `${text(first.title, 120)} is now available for ${money(price)}. Explore ${categoryLabel(category)} at Kamlesh Suits.`
      : `${available.length} new ${label} designs, starting at ${money(price)}. Discover the latest collection at Kamlesh Suits.`,
    url: single ? `/product/${encodeURIComponent(first.suitId)}` : `/new-arrivals?category=${encodeURIComponent(category)}`,
    image: first.image || '',
    source_ids: available.map(product => product.suitId),
  };
};

export const voucherMessage = (coupon, now = Date.now()) => {
  const expires = coupon.expires_at ? Date.parse(coupon.expires_at) : Infinity;
  if (!coupon.code || !(Number(coupon.discount) > 0) || !(expires > now)
    || (coupon.usage_limit && Number(coupon.used_count) >= Number(coupon.usage_limit))) return null;
  const categories = coupon.category_ids || [];
  const scope = categories.length ? categories.map(categoryLabel).join(', ') : 'all collections';
  const offer = coupon.discount_type === 'percent' ? `${coupon.discount}% off` : `${money(coupon.discount)} off`;
  const minimum = Number(coupon.min_purchase) > 0 ? ` Min. eligible spend ${money(coupon.min_purchase)}.` : '';
  const expiry = Number.isFinite(expires) ? ` Ends ${new Date(expires).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}.` : '';
  const params = new URLSearchParams({ voucher: coupon.code });
  categories.forEach(id => params.append('category', id));
  return {
    title: text(`New voucher · ${offer}`, 80),
    body: `Use ${text(coupon.code, 40)} for ${offer} on ${scope}.${minimum}${expiry}`,
    url: `/new-arrivals?${params}`,
    source_ids: [coupon.suitId],
    source_updated_at: coupon.updated_at,
    offer_expires_at: Number.isFinite(expires) ? expires : null,
  };
};

export const notificationWrite = (message, source, eventId, now = Date.now()) => {
  if (!message) return null;
  const id = createHash('sha256').update(`${source}:${eventId}`).digest('hex');
  return { Put: {
    TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
    ConditionExpression: 'attribute_not_exists(suitId)',
    Item: {
      ...message, suitId: `NOTIFICATION#AUTO#${id}`, type: 'admin_notification', source,
      tag: `auto-${id}`, audience: { mode: 'all' }, created_by: 'automatic',
      created_at: new Date(now).toISOString(), status: 'pending', attempts: 0,
      next_attempt_at: now, expires_at_ms: Math.min(now + 86400000, message.offer_expires_at || Infinity),
      delivery: { sent: 0, failed: 0 },
    },
  } };
};

// Add these writes to the SAME transaction as a bulk import: one alert per
// category/subcategory, never one alert per photograph or colour variant.
export const inventoryNotificationWrites = (products, batchId) => {
  const groups = new Map();
  for (const product of products) {
    const key = `${categoryId(product)}:${product.product_subcategory || ''}`;
    groups.set(key, [...(groups.get(key) || []), product]);
  }
  return [...groups].map(([key, items]) => notificationWrite(
    inventoryMessage(items), 'inventory_added', `${batchId}:${key}`,
  )).filter(Boolean);
};
