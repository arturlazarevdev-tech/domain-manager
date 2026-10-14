import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";

export async function resolveRegistrarId(explicit?: string) {
  if (explicit) return explicit;
  const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
  if (settings?.defaultRegistrarId) return settings.defaultRegistrarId;
  const first = await prisma.registrarAccount.findFirst({
    where: { enabled: true },
    orderBy: { createdAt: "asc" },
  });
  if (!first) {
    throw new AppError({
      message: "No registrar configured. Add one in Settings → Registrars.",
      status: 400,
    });
  }
  return first.id;
}

export async function resolveCloudflareAccountId(explicit?: string | null) {
  if (explicit) return explicit;
  const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
  if (settings?.defaultCloudflareId) return settings.defaultCloudflareId;
  const first = await prisma.cloudflareAccount.findFirst({
    where: { enabled: true },
    orderBy: { createdAt: "asc" },
  });
  if (!first) {
    throw new AppError({
      message: "Select a Cloudflare account. Add one in Infrastructure → Cloudflare.",
      status: 400,
    });
  }
  return first.id;
}

function contactFromProfile(profile: {
  name: string;
  company?: string | null;
  email: string;
  phone: string;
  phoneCc: string;
  phoneAreaCode?: string;
  country: string;
  state: string;
  city: string;
  address: string;
  zip: string;
}) {
  return {
    name: profile.name,
    company: profile.company ?? undefined,
    email: profile.email,
    phone: profile.phone,
    phoneCc: profile.phoneCc,
    phoneAreaCode: profile.phoneAreaCode,
    country: profile.country,
    state: profile.state,
    city: profile.city,
    address: profile.address,
    zip: profile.zip,
  };
}

export async function resolveRegistrantContact(opts?: { registrarId?: string; registrantId?: string }) {
  if (opts?.registrantId) {
    const profile = await prisma.registrantProfile.findUnique({ where: { id: opts.registrantId } });
    if (!profile) throw new AppError({ message: "Registrant profile not found", status: 404 });
    if (opts.registrarId && profile.registrarId && profile.registrarId !== opts.registrarId) {
      throw new AppError({
        message: "This registrant profile is not assigned to the selected registrar.",
        status: 400,
      });
    }
    return { profile, contact: contactFromProfile(profile) };
  }

  if (opts?.registrarId) {
    const forRegistrar =
      (await prisma.registrantProfile.findFirst({
        where: { registrarId: opts.registrarId, isDefault: true },
      })) ??
      (await prisma.registrantProfile.findFirst({
        where: { registrarId: opts.registrarId },
        orderBy: { createdAt: "asc" },
      }));
    if (forRegistrar) return { profile: forRegistrar, contact: contactFromProfile(forRegistrar) };
  }

  const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
  const profile =
    (settings?.defaultRegistrantId
      ? await prisma.registrantProfile.findUnique({ where: { id: settings.defaultRegistrantId } })
      : null) ??
    (await prisma.registrantProfile.findFirst({ where: { isDefault: true } })) ??
    (await prisma.registrantProfile.findFirst({ orderBy: { createdAt: "asc" } }));

  if (profile) {
    return {
      profile,
      contact: contactFromProfile(profile),
    };
  }

  const legacy = await prisma.buyer.findFirst({
    where: { email: { not: "" }, phone: { not: "" }, country: { not: "" } },
    orderBy: { createdAt: "asc" },
  });
  if (legacy?.email && legacy.phone && legacy.country) {
    return {
      profile: null as typeof profile,
      contact: {
        name: legacy.name,
        company: legacy.company ?? undefined,
        email: legacy.email,
        phone: legacy.phone,
        phoneCc: legacy.phoneCc,
        country: legacy.country,
        state: legacy.state,
        city: legacy.city,
        address: legacy.address,
        zip: legacy.zip,
      },
    };
  }

  throw new AppError({
    message: "Add a registrant profile in Settings → Registrant Profiles before purchasing domains.",
    status: 400,
  });
}
