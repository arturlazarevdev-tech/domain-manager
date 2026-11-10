import { prisma } from "./lib/db";
import { previewReport, sendWeeklyReport } from "./lib/reports/service";
async function main() {
try {
  if (process.argv.includes("--dry-run")) {
    const { week, count, totals } = await previewReport();
    console.log(JSON.stringify({ week: week.startDay, count, totals }));
  } else console.log(JSON.stringify(await sendWeeklyReport(true)));
} catch {
  console.error("Weekly Google Sheets report failed. See Settings → Google Sheets for details.");
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }

}
void main();
