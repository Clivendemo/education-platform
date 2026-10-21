import { defaultRetentionService } from '../../services/retention.service.js';

async function seed() {
  console.log('Seeding canonical retention policies...');
  await defaultRetentionService.seedInitialPolicies();
  console.log('Successfully seeded canonical retention policies.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Failed to seed retention policies:', err);
  process.exit(1);
});
