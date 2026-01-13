const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  try {
    // Create admin user
    const adminPassword = await bcrypt.hash('admin123', 12);
    const admin = await prisma.user.upsert({
      where: { email: 'admin@routeoptimizer.com' },
      update: {},
      create: {
        email: 'admin@routeoptimizer.com',
        passwordHash: adminPassword,
        firstName: 'Admin',
        lastName: 'Sistema',
        role: 'ADMIN',
        phone: '5551234567'
      }
    });
    console.log('✅ Admin created:', admin.email);

    // Create operator user
    const operatorPassword = await bcrypt.hash('operador123', 12);
    const operator = await prisma.user.upsert({
      where: { email: 'operador@routeoptimizer.com' },
      update: {},
      create: {
        email: 'operador@routeoptimizer.com',
        passwordHash: operatorPassword,
        firstName: 'Juan',
        lastName: 'Operador',
        role: 'OPERATOR',
        phone: '5559876543'
      }
    });
    console.log('✅ Operator created:', operator.email);

    // Create driver user
    const driverPassword = await bcrypt.hash('chofer123', 12);
    const driver = await prisma.user.upsert({
      where: { email: 'chofer@routeoptimizer.com' },
      update: {},
      create: {
        email: 'chofer@routeoptimizer.com',
        passwordHash: driverPassword,
        firstName: 'Pedro',
        lastName: 'Chofer',
        role: 'DRIVER',
        phone: '5551112222'
      }
    });
    console.log('✅ Driver created:', driver.email);

    console.log('🎉 Seed completed!');
  } catch (e) {
    console.log('Seed error (may already exist):', e.message);
  }

  await prisma.$disconnect();
}

main();
