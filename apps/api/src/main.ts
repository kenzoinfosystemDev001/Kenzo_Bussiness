import { startServer } from './bootstrap';

startServer().catch((err: unknown) => {
  // Configuration errors are printed without stack noise; everything else in full.
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
