export type GeneratorFilters = {
  noNumbers?: boolean;
  noHyphens?: boolean;
  lettersOnly?: boolean;
  startsWith?: string;
  contains?: string;
  maxLength?: number;
  minLength?: number;
};

export function matchesFilters(sld: string, filters: GeneratorFilters) {
  if (filters.lettersOnly && /[^a-z]/i.test(sld)) return false;
  if (filters.noNumbers && /\d/.test(sld)) return false;
  if (filters.noHyphens && sld.includes("-")) return false;
  if (filters.startsWith && !sld.startsWith(filters.startsWith.toLowerCase())) return false;
  if (filters.contains && !sld.includes(filters.contains.toLowerCase())) return false;
  if (filters.maxLength && sld.length > filters.maxLength) return false;
  if (filters.minLength && sld.length < filters.minLength) return false;
  return true;
}

export function applyPrefix(sld: string, startsWith?: string) {
  if (!startsWith) return sld;
  const prefix = startsWith.toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!prefix) return sld;
  if (sld.startsWith(prefix)) return sld;
  return `${prefix}${sld}`.slice(0, Math.max(prefix.length + 1, sld.length));
}
