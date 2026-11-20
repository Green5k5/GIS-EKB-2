import fs from 'node:fs';
import crypto from 'node:crypto';
import { loadEnv } from '../server/env.js';

loadEnv();
if (!process.env.ADMIN_KEY) {
  const key = crypto.randomBytes(32).toString('base64url');
  fs.appendFileSync('.env', `\nADMIN_KEY=${key}\n`, { encoding: 'utf8', mode: 0o600 });
  console.log('Создан ключ администратора в .env (ADMIN_KEY).');
}
