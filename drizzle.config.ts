// eslint-disable-file
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/lib/db/schema',     // Adjust this path if your schema is elsewhere
  out: './migrations',
  dbCredentials: {
    url: ':memory:',   // not actually used for generation, but required
  },
});