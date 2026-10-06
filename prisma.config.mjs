import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
// Load environment from the repository root .env
dotenv.config({ path: path.join(process.cwd(), '.env') });

// Build a datasource URL that ensures SSL is enabled when connecting to Supabase.
const rawDbUrl = process.env.DATABASE_URL;
let datasourceUrl = 'env:DATABASE_URL';
if (rawDbUrl) {
  // If the URL already contains ssl settings, use it as-is.
  let adjusted = rawDbUrl;
  // Supabase provides a pooler on port 6543 which may not support advisory locks required by Prisma Migrate.
  // Prefer connecting to the direct Postgres port 5432 for migrations when possible.
  if (adjusted.includes(':6543')) {
    adjusted = adjusted.replace(':6543', ':5432');
  }
  if (adjusted.includes('sslmode') || adjusted.includes('ssl=true') || adjusted.includes('ssl=1')) {
    datasourceUrl = adjusted;
  } else {
    const sep = adjusted.includes('?') ? '&' : '?';
    datasourceUrl = `${adjusted}${sep}sslmode=require&ssl=true`;
  }
}

export default {
  schema: path.join(process.cwd(), 'prisma', 'schema.prisma'),
  migrations: {
    path: path.join(process.cwd(), 'prisma', 'migrations'),
  },
  datasource: {
    url: datasourceUrl,
  },
};
