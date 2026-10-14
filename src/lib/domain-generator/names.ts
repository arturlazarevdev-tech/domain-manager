const ONSETS = [
  "b", "c", "d", "f", "g", "h", "j", "k", "l", "m", "n", "p", "r", "s", "t", "v", "w", "z",
  "br", "cr", "dr", "fr", "gr", "kr", "pr", "tr", "st", "sl", "sn", "sk", "cl", "fl", "pl", "bl",
  "ch", "sh", "th", "qu", "tw", "sw", "gl", "kl",
];
const NUCLEI = ["a", "e", "i", "o", "u", "a", "e", "i", "o", "u", "ae", "io", "ia", "eo", "ai", "ou"];
const CODAS = ["", "", "n", "r", "l", "s", "x", "t", "v", "k", "m", "p", "d"];

export function randomLetters(length: number, lettersOnly = true) {
  const alphabet = lettersOnly ? "abcdefghijklmnopqrstuvwxyz" : "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export function pronounceableName(min: number, max: number) {
  const lo = Math.max(min, Math.ceil((min + max) / 2));
  const target = randInt(Math.min(lo, max), max);
  let name = "";
  while (name.length < target) {
    const syllable =
      ONSETS[randInt(0, ONSETS.length - 1)] +
      NUCLEI[randInt(0, NUCLEI.length - 1)] +
      CODAS[randInt(0, CODAS.length - 1)];
    name += syllable;
  }
  return name.slice(0, target).replace(/[^a-z]/g, "x");
}

export function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
