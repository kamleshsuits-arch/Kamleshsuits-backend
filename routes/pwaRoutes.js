import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { DeleteCommand, GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ddbDocClient } from '../libs/awsClient.js';
import { adminAuth } from '../middleware/adminAuth.js';
import { optionalUserAuth } from '../middleware/userAuth.js';
import { isPushConfigured, sendPushNotification } from '../libs/pushNotificationService.js';

const validInstallationId = value => /^[a-zA-Z0-9-]{16,80}$/.test(String(value || ''));
const safeText = (value, max) => String(value || '').trim().slice(0, max);
const safeRoute = handler => async (req, res, next) => {
  try { await handler(req, res, next); }
  catch (error) {
    console.error('PWA route error:', error);
    if (!res.headersSent) res.status(500).json({ message: 'Notification service is temporarily unavailable' });
  }
};

const scanType = async type => {
  const items = [];
  let ExclusiveStartKey;
  do {
    const result = await ddbDocClient.send(new ScanCommand({
      TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
      FilterExpression: '#type = :type',
      ExpressionAttributeNames: { '#type': 'type' },
      ExpressionAttributeValues: { ':type': type },
      ExclusiveStartKey,
    }));
    items.push(...(result.Items || []));
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
};

export const registerPwaRoutes = app => {
  app.get('/api/push/public-key', (req, res) => {
    if (!isPushConfigured()) return res.status(503).json({ message: 'Push notifications are not configured' });
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
  });

  app.post('/api/pwa/install', optionalUserAuth, safeRoute(async (req, res) => {
    const installationId = safeText(req.body.installationId, 80);
    if (!validInstallationId(installationId)) return res.status(400).json({ message: 'Invalid installation ID' });
    const key = { suitId: `PWA_INSTALL#${installationId}` };
    const existing = await ddbDocClient.send(new GetCommand({ TableName: process.env.AWS_DYNAMODB_TABLE_NAME, Key: key }));
    const now = new Date().toISOString();
    const item = {
      ...key,
      type: 'pwa_install',
      installation_id: installationId,
      installed: req.body.installed === true || existing.Item?.installed === true,
      display_mode: safeText(req.body.displayMode, 30),
      platform: safeText(req.body.platform, 100),
      user_agent: safeText(req.headers['user-agent'], 300),
      user_id: req.user?.sub || existing.Item?.user_id || '',
      user_email: req.user?.email || existing.Item?.user_email || '',
      first_seen_at: existing.Item?.first_seen_at || now,
      installed_at: req.body.installed === true ? (existing.Item?.installed_at || now) : (existing.Item?.installed_at || ''),
      last_seen_at: now,
    };
    await ddbDocClient.send(new PutCommand({ TableName: process.env.AWS_DYNAMODB_TABLE_NAME, Item: item }));
    res.json({ tracked: true, installed: item.installed });
  }));

  app.post('/api/push/subscribe', optionalUserAuth, safeRoute(async (req, res) => {
    const { subscription } = req.body;
    const installationId = safeText(req.body.installationId, 80);
    if (!validInstallationId(installationId) || !subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(400).json({ message: 'Invalid push subscription' });
    }
    const digest = createHash('sha256').update(subscription.endpoint).digest('hex');
    const suitId = `PUSH_SUBSCRIPTION#${digest}`;
    const existing = await ddbDocClient.send(new GetCommand({ TableName: process.env.AWS_DYNAMODB_TABLE_NAME, Key: { suitId } }));
    const now = new Date().toISOString();
    await ddbDocClient.send(new PutCommand({
      TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
      Item: {
        suitId,
        type: 'push_subscription',
        installation_id: installationId,
        user_id: req.user?.sub || '',
        user_email: req.user?.email || '',
        subscription,
        active: true,
        created_at: existing.Item?.created_at || now,
        updated_at: now,
      },
    }));
    res.status(201).json({ subscribed: true });
  }));

  app.delete('/api/push/subscribe', optionalUserAuth, safeRoute(async (req, res) => {
    const endpoint = safeText(req.body.endpoint, 2000);
    if (!endpoint) return res.status(400).json({ message: 'Subscription endpoint is required' });
    const digest = createHash('sha256').update(endpoint).digest('hex');
    await ddbDocClient.send(new DeleteCommand({
      TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
      Key: { suitId: `PUSH_SUBSCRIPTION#${digest}` },
    }));
    res.json({ subscribed: false });
  }));

  app.get('/api/admin/pwa/installs', adminAuth, safeRoute(async (req, res) => {
    const installs = await scanType('pwa_install');
    res.json(installs.sort((a, b) => new Date(b.last_seen_at) - new Date(a.last_seen_at)));
  }));

  app.get('/api/admin/notifications', adminAuth, safeRoute(async (req, res) => {
    const notifications = await scanType('admin_notification');
    res.json(notifications.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 100));
  }));

  app.post('/api/admin/notifications', adminAuth, safeRoute(async (req, res) => {
    const title = safeText(req.body.title, 80);
    const body = safeText(req.body.body, 220);
    const url = safeText(req.body.url || '/', 500);
    if (!title || !body || !url.startsWith('/')) return res.status(400).json({ message: 'Title, message, and an internal link are required' });

    const delivery = await sendPushNotification({ title, body, url, tag: `broadcast-${Date.now()}` });
    const notification = {
      suitId: `NOTIFICATION#${uuidv4()}`,
      type: 'admin_notification',
      title,
      body,
      url,
      created_by: req.user.email || req.user.sub,
      delivery,
      created_at: new Date().toISOString(),
    };
    await ddbDocClient.send(new PutCommand({ TableName: process.env.AWS_DYNAMODB_TABLE_NAME, Item: notification }));
    res.status(201).json(notification);
  }));
};
