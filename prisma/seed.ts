import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db";

async function main() {
  const email = process.env.ADMIN_EMAIL || "admin@localhost";
  const password = process.env.ADMIN_PASSWORD || "changeme";
  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: "admin" },
    create: {
      email,
      passwordHash,
      name: "Admin",
      role: "admin",
    },
  });

  await prisma.appSettings.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default" },
  });

  console.log(`Seeded admin user ${email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
