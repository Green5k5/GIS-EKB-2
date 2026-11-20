import fs from 'node:fs';
import crypto from 'node:crypto';
import { loadEnv } from '../server/env.js';

loadEnv();
let key = process.env.ADMIN_KEY;
if (!key) {
  key = crypto.randomBytes(24).toString('base64url');
  fs.appendFileSync('.env', `\nADMIN_KEY=${key}\n`, { encoding: 'utf8', mode: 0o600 });
}
fs.mkdirSync('.runtime', { recursive: true });
fs.writeFileSync('.runtime/admin-key.txt', key + '\n', { mode: 0o600 });
console.log('Administration: http://127.0.0.1:8090/admin/');
console.log('Your admin key is saved in .runtime/admin-key.txt');
