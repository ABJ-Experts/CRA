// Loads the repo-root .env.local so DATABASE_URL etc. are present regardless of
// the cwd `nest start` / vitest is launched from. Imported first, before any
// module that reads process.env at load time (e.g. db/database.ts).
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

function findEnvFile(startDirs: string[]): string | undefined {
  for (const start of startDirs) {
    let dir = start;
    for (let i = 0; i < 8; i++) {
      const candidate = join(dir, '.env.local');
      if (existsSync(candidate)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return undefined;
}

const startDirs = [process.cwd()];
// `typeof` is safe even if __dirname is not defined (ESM/Vite test runtime).
if (typeof __dirname !== 'undefined') startDirs.push(__dirname);
const envPath = findEnvFile(startDirs);
if (envPath) config({ path: envPath });
