/**
 * Kanakku Database Migration CLI
 * ─────────────────────────────────────────────────────────────
 * Usage:
 *   ts-node src/db/migrate.ts            # Run pending migrations
 *   ts-node src/db/migrate.ts --status   # Check migration and account status
 *   ts-node src/db/migrate.ts --reset    # Reset database (Development only)
 * ─────────────────────────────────────────────────────────────
 */

import { db } from './index';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || '--up';

  console.log('\n============================================================');
  console.log('             KANAKKU DATABASE MIGRATION TOOL');
  console.log('============================================================\n');

  try {
    await db.init();

    if (command === '--status') {
      const isPg = db.isUsingPostgres();
      const metrics = await db.getAccountMetrics();
      console.log(`[Engine]             : ${isPg ? 'PostgreSQL' : 'Local Relational Store'}`);
      console.log(`[Total Accounts]     : ${metrics.totalAccounts}`);
      console.log(`[Active Accounts]    : ${metrics.activeAccounts}`);
      console.log(`[Disabled Accounts]  : ${metrics.disabledAccounts}`);
      console.log(`[Created Today]      : ${metrics.createdToday}`);
      console.log(`[Created This Month] : ${metrics.createdThisMonth}`);
      console.log(`[Last Login Record]  : ${metrics.lastLoginRecorded || 'None'}`);
      console.log('\n✓ Database status check complete.\n');
    } else if (command === '--reset') {
      console.log('Resetting database...');
      await db.resetDatabase();
      console.log('✓ Database schema and data reset successfully.\n');
    } else {
      console.log('Applying pending migrations...');
      const result = await db.runMigrations();
      if (result.alreadyUpToDate) {
        console.log('✓ Schema is already up-to-date.');
      } else {
        console.log(`✓ Applied ${result.applied.length} migration(s): ${result.applied.join(', ')}`);
      }
    }
  } catch (err) {
    console.error('✗ Migration failed:', (err as Error).message);
    process.exit(1);
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  main();
}
