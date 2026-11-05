import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SystemSettingsService } from '../src/system-settings/system-settings.service.js';
import { resetDatabase } from './utils/reset-database.js';

async function startApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

// .env.test sets SUPER_ADMIN_EMAIL=superadmin@batisso.test
describe('Super admin bootstrap and system settings (e2e)', () => {
  beforeAll(async () => {
    const app = await startApp();
    await resetDatabase(app.get(PrismaService));
    await app.close();
  });

  it('creates exactly one super admin on the first start, none on restart', async () => {
    const first = await startApp();
    await first.close();
    const second = await startApp();
    const prisma = second.get(PrismaService);

    const admins = await prisma.admin.findMany();
    await second.close();

    expect(admins).toHaveLength(1);
    expect(admins[0]).toMatchObject({
      email: 'superadmin@batisso.test',
      role: 'SUPER_ADMIN',
      isActive: true,
    });
    expect(admins[0].passwordHash).toMatch(/^scrypt\$/);
  });

  it('serves the default settings on an empty settings table', async () => {
    const app = await startApp();

    const settings = await app.get(SystemSettingsService).get();
    await app.close();

    expect(settings).toEqual({
      maxLoginAttempts: 5,
      maxAdminSessions: 3,
      maxPinAttempts: 5,
      deliveryAlertDays: 7,
      cancellationEscalationHours: 48,
      inactivityReminderDays: 30,
    });
  });
});
