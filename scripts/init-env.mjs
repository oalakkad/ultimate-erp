// Creates .env from .env.example on first run. Never overwrites an existing .env.
import { copyFileSync, existsSync } from 'node:fs';

if (!existsSync('.env')) {
  copyFileSync('.env.example', '.env');
  console.log('Created .env from .env.example (local development values).');
}
