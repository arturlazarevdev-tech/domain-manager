import { z } from "zod";
import { AppError } from "@/lib/errors";
import { mapWithConcurrency } from "@/lib/concurrency";
import type { DomainAvailability, DomainRegistrar } from "@/lib/integrations/types";
import { applyPrefix, matchesFilters, type GeneratorFilters } from "./filters";
import { pronounceableName, randInt, randomLetters } from "./names";

export const generateDomainsSchema = z.object({
  registrarId: z.string().min(1).optional(),
  tld: z.string().min(2),
  amount: z.number().int().min(1).max(100),
  minLength: z.number().int().min(3).max(20).default(5),
  maxLength: z.number().int().min(3).max(24).default(12),
  keyword: z.string().optional(),
  type: z.enum(["random", "pronounceable", "dictionary", "keyword", "ai", "suggestions"]).default("pronounceable"),
  exclude: z.array(z.string()).optional(),
  filters: z
    .object({
      noNumbers: z.boolean().optional(),
      noHyphens: z.boolean().optional(),
      lettersOnly: z.boolean().optional(),
      startsWith: z.string().optional(),
      contains: z.string().optional(),
      maxLength: z.number().optional(),
      minLength: z.number().optional(),
    })
    .optional(),
}).refine(input => input.minLength <= input.maxLength, {
  message: "Minimum length cannot exceed maximum length.", path: ["minLength"],
});

export type GenerateDomainsInput = z.infer<typeof generateDomainsSchema>;

const DICTIONARY = [
  "nova", "lumen", "vertex", "pulse", "orbit", "nimbus", "sable", "aether", "vivid", "quartz",
  "ember", "solace", "harbor", "cinder", "raven", "cobalt", "flint", "willow", "onyx", "drift",
  "mira", "kestrel", "aurora", "zenith", "lyra", "osprey", "falcon", "marble", "pine", "cedar",
  "velvet", "silk", "copper", "bronze", "silver", "ivory", "coral", "amber", "jasper", "slate",
];

export async function generateAvailableDomains(
  registrar: DomainRegistrar,
  input: GenerateDomainsInput,
) {
  if (input.type === "suggestions") return generateSuggestedDomains(registrar, input);
  const tld = input.tld.replace(/^\./, "").toLowerCase();
  const keyword = input.keyword?.trim().toLowerCase().replace(/[^a-z0-9]/g, "") || input.filters?.startsWith;
  const filters: GeneratorFilters = {
    noNumbers: true,
    noHyphens: true,
    lettersOnly: true,
    ...input.filters,
    startsWith: keyword || input.filters?.startsWith,
    minLength: input.minLength,
    maxLength: input.maxLength,
  };
  const exclude = new Set((input.exclude ?? []).map((d) => d.toLowerCase()));
  const wanted = input.amount;
  const maxCandidates = Math.min(800, Math.max(wanted * 20, 80));
  const started = Date.now();
  const timeoutMs = 40_000;
  const found: DomainAvailability[] = [];
  const taken: DomainAvailability[] = [];

  while (found.length < wanted && Date.now() - started < timeoutMs && exclude.size < maxCandidates) {
    const remaining = wanted - found.length;
    const batchSize = Math.min(10, Math.max(remaining * 3, 5));
    const candidates: string[] = [];
    let safety = 0;
    while (candidates.length < batchSize && safety < 800) {
      safety += 1;
      const sld = await makeName(input.type, input.minLength, input.maxLength, filters, keyword);
      const domain = `${sld}.${tld}`;
      if (exclude.has(domain)) continue;
      if (!matchesFilters(sld, filters)) continue;
      exclude.add(domain);
      candidates.push(domain);
    }
    if (!candidates.length) break;

    const checked = await registrar.checkDomains(candidates);
    const freshAvailable = checked.filter((item) => item.available);
    await Promise.all(
      freshAvailable.filter(item => !item.price).map(async (item) => {
        try {
          item.price = await registrar.getPrice(item.domain);
        } catch {
          // availability still useful without price
        }
      }),
    );
    for (const item of checked) {
      const reason = (item.reason ?? "").toLowerCase();
      const inconclusive = !item.available && (reason === "unknown" || reason === "not_returned");
      if (inconclusive) continue;
      if (item.available) found.push(item);
      else taken.push(item);
      if (found.length >= wanted) break;
    }
  }

  return {
    available: found.slice(0, wanted),
    taken,
    generated: found.length + taken.length,
    timedOut: found.length < wanted,
  };
}

async function generateSuggestedDomains(registrar: DomainRegistrar, input: GenerateDomainsInput) {
  if (!registrar.suggestDomains) throw new AppError({ message: "This registrar does not support domain suggestions.", status: 400 });
  const keyword = input.keyword?.trim().toLowerCase();
  if (!keyword || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(keyword)) {
    throw new AppError({ message: "Enter a keyword using Latin letters, numbers or hyphens (up to 63 characters).", status: 400 });
  }
  const tld = input.tld.replace(/^\./, "").toLowerCase();
  const excluded = new Set((input.exclude ?? []).map(name => name.toLowerCase()));
  const filters: GeneratorFilters = { noNumbers: true, noHyphens: true, lettersOnly: true, ...input.filters, minLength: input.minLength, maxLength: input.maxLength };
  const candidates = [...new Set(await registrar.suggestDomains(keyword, tld, 100))].filter(name =>
    !excluded.has(name) && name.endsWith(`.${tld}`) && matchesFilters(name.slice(0, -tld.length - 1), filters),
  );
  const available: DomainAvailability[] = [], taken: DomainAvailability[] = [];
  const started = Date.now();
  for (let i = 0; i < candidates.length && available.length < input.amount && Date.now() - started < 40_000; i += 10) {
    const checked = await registrar.checkDomains(candidates.slice(i, i + 10));
    // Suggestions alone do not confirm availability or the purchase price.
    for (const item of checked) {
      if (item.available) available.push(item);
      else taken.push(item);
    }
  }
  return { available: available.slice(0, input.amount), taken, generated: available.length + taken.length, timedOut: available.length < input.amount };
}

async function makeName(
  type: GenerateDomainsInput["type"],
  min: number,
  max: number,
  filters: GeneratorFilters,
  keyword?: string,
) {
  const seed = (keyword || filters.startsWith || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const room = Math.max(0, max - seed.length);
  const need = Math.max(0, min - seed.length);
  let tail = "";
  if (room > 0) {
    const tailMin = Math.max(1, need);
    const tailMax = Math.max(tailMin, room);
    if (type === "pronounceable") {
      tail = pronounceableName(tailMin, tailMax);
    } else if (type === "dictionary" || type === "keyword") {
      const a = DICTIONARY[randInt(0, DICTIONARY.length - 1)];
      const b = DICTIONARY[randInt(0, DICTIONARY.length - 1)];
      tail = `${a}${b}`.slice(0, tailMax);
      if (tail.length < tailMin) tail += randomLetters(tailMin - tail.length);
    } else if (type === "ai") {
      tail = await generateAiName(tailMin, tailMax);
    } else {
      tail = randomLetters(randInt(tailMin, tailMax), filters.lettersOnly !== false);
    }
  }
  let sld = `${seed}${tail}`.replace(/[^a-z0-9-]/g, "");
  if (!seed) sld = applyPrefix(sld, filters.startsWith);
  if (filters.contains && !sld.includes(filters.contains.toLowerCase())) {
    sld = `${sld}${filters.contains.toLowerCase()}`;
  }
  if (sld.length < min) sld += randomLetters(min - sld.length, filters.lettersOnly !== false);
  return sld.slice(0, max);
}

async function generateAiName(min: number, max: number) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new AppError({
      message: "AI names require OPENAI_API_KEY. Use Random or Pronounceable instead.",
      status: 400,
    });
  }
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Return only a single brandable domain SLD, lowercase letters only, no TLD.",
        },
        {
          role: "user",
          content: `Invent one original pronounceable brand name, ${min}-${max} letters, no numbers or hyphens.`,
        },
      ],
      temperature: 1.1,
      max_tokens: 20,
    }),
  });
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content?.toLowerCase().replace(/[^a-z]/g, "") ?? "";
  return raw || pronounceableName(min, max);
}

export { mapWithConcurrency };

export async function generateCandidateNames(input: GenerateDomainsInput) {
  if (input.type === "suggestions") throw new AppError({ message: "Use Find available for registrar suggestions.", status: 400 });
  const tld = input.tld.replace(/^\./, "").toLowerCase();
  const keyword = input.keyword?.trim().toLowerCase().replace(/[^a-z0-9]/g, "") || input.filters?.startsWith;
  const filters: GeneratorFilters = {
    noNumbers: true,
    noHyphens: true,
    lettersOnly: true,
    ...input.filters,
    startsWith: keyword || input.filters?.startsWith,
    minLength: input.minLength,
    maxLength: input.maxLength,
  };
  const exclude = new Set((input.exclude ?? []).map((d) => d.toLowerCase()));
  const names: string[] = [];
  let safety = 0;
  while (names.length < input.amount && safety < input.amount * 40) {
    safety += 1;
    const sld = await makeName(input.type, input.minLength, input.maxLength, filters, keyword);
    const domain = `${sld}.${tld}`;
    if (exclude.has(domain)) continue;
    if (!matchesFilters(sld, filters)) continue;
    exclude.add(domain);
    names.push(domain);
  }
  return names;
}
