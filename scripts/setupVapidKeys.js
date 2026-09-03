import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';

const directory = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(directory, '..', '.env');
const env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

if (/^VAPID_PUBLIC_KEY=.+$/m.test(env) && /^VAPID_PRIVATE_KEY=.+$/m.test(env)) {
  console.log('VAPID keys already exist; no changes made.');
  process.exit(0);
}

const keys = webpush.generateVAPIDKeys();
const separator = env.endsWith('\n') || !env ? '' : '\n';
const addition = `${separator}\n# Web Push notifications\nVAPID_SUBJECT=mailto:support@kamleshsuits.com\nVAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\n`;
fs.appendFileSync(envPath, addition, { encoding: 'utf8', mode: 0o600 });
console.log('Generated VAPID keys in backend/.env without printing private material.');
