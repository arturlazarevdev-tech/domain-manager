export const REPORT_TIMEZONE = "Europe/Kiev";
export const REPORT_COLUMNS = ["Дата", "Сумма", "Домен", "Провайдер", "Валюта", "Байер", "Команда", "Сервер", "Cloudflare"];
const day = 86400000;
export function localDay(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: REPORT_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function midnight(date: string) {
  const wall = Date.parse(`${date}T00:00:00Z`);
  let utc = wall;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: REPORT_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(utc));
    const p = Object.fromEntries(parts.map(p => [p.type, p.value]));
    const actual = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    utc += wall - actual;
  }
  return new Date(utc);
}
export function previousWeek(now = new Date()) {
  const today = new Date(`${localDay(now)}T00:00:00Z`);
  const monday = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * day);
  const startDay = new Date(monday.getTime() - 7 * day).toISOString().slice(0, 10);
  const endDay = monday.toISOString().slice(0, 10);
  const lastDay = new Date(monday.getTime() - day).toISOString().slice(0, 10);
  return { startDay, endDay, lastDay, start: midnight(startDay), end: midnight(endDay) };
}
export function moneyTotals(rows: (string | number)[][]) {
  const cents: Record<string, number> = {};
  for (const row of rows) cents[String(row[4])] = (cents[String(row[4])] ?? 0) + Math.round(Number(row[1]) * 100);
  return Object.fromEntries(Object.entries(cents).sort().map(([currency, amount]) => [currency, amount / 100]));
}
