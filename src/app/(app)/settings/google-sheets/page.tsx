"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api/client";
import { Button } from "@/components/ui/button";

type Settings = { spreadsheetId: string; serviceAccountEmail: string | null; enabled: boolean; lastSuccessAt: string | null; lastReportWeek: string | null; lastSheetId: number | null; lastDomainCount: number | null; lastError: string | null };
type Data = { settings: Settings | null; preview: { start: string; end: string; count: number; totals: Record<string, number> } };
export default function GoogleSheetsPage() {
  const { data, error } = useQuery({ queryKey: ["google-sheets-report"], queryFn: () => api<Data>("/api/settings/google-sheets") });
  if (error) return <p role="alert" className="text-destructive">{error.message}</p>;
  if (!data) return <p>Загрузка настроек…</p>;
  return <ReportForm data={data} />;
}
function ReportForm({ data }: { data: Data }) {
  const queryClient = useQueryClient();
  const [spreadsheet, setSpreadsheet] = useState(data.settings?.spreadsheetId ?? "");
  const [key, setKey] = useState("");
  const [enabled, setEnabled] = useState(data.settings?.enabled ?? false);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const spreadsheetId = spreadsheet.trim().match(/spreadsheets\/d\/([\w-]+)/)?.[1] ?? spreadsheet.trim();
      await api("/api/settings/google-sheets", { method: "PATCH", body: JSON.stringify({ spreadsheetId, credentialsJson: key, enabled }) });
      setKey(""); await queryClient.invalidateQueries({ queryKey: ["google-sheets-report"] }); toast.success("Настройки сохранены");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Ошибка сохранения"); } finally { setBusy(false); }
  }
  async function send() {
    setBusy(true);
    try {
      const result = await api<{ reused: boolean; count: number }>("/api/settings/google-sheets", { method: "POST" });
      toast.success(result.reused ? "Отчёт за эту неделю уже есть в таблице" : `Отчёт отправлен: ${result.count} доменов`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Ошибка отправки"); }
    finally { await queryClient.invalidateQueries({ queryKey: ["google-sheets-report"] }); setBusy(false); }
  }
  const s = data?.settings;
  return <div className="mx-auto max-w-3xl space-y-6">
    <div><h1 className="text-2xl font-semibold">Google Sheets</h1><p className="mt-2 text-sm text-muted-foreground">Отчёт о покупках доменов каждый понедельник в 09:00 по Киеву за предыдущую неделю, с понедельника по воскресенье.</p></div>
    <div className="space-y-4 rounded-xl border bg-card p-5">
      <label className="block space-y-2"><span className="text-sm font-medium">Ссылка или ID таблицы</span><input className="input w-full rounded-md border bg-background p-2" value={spreadsheet} onChange={e => setSpreadsheet(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…/edit" /></label>
      <label className="block space-y-2"><span className="text-sm font-medium">JSON-ключ сервисного аккаунта</span><textarea className="w-full rounded-md border bg-background p-2 font-mono text-xs" rows={4} autoComplete="off" spellCheck={false} value={key} onChange={e => setKey(e.target.value)} placeholder={s?.serviceAccountEmail ? "Ключ сохранён. Оставьте пустым, чтобы сохранить его." : "Вставьте содержимое скачанного JSON-файла"} /></label>
      {s?.serviceAccountEmail && <p className="break-all text-sm">Откройте таблицу → «Настройки доступа» → добавьте <strong>{s.serviceAccountEmail}</strong> с правами <strong>Редактор</strong>.</p>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />Автоматический отчёт по понедельникам</label>
      <div className="flex flex-wrap gap-2"><Button onClick={save} disabled={busy || !data}>Сохранить</Button><Button variant="outline" onClick={send} disabled={busy || !s?.serviceAccountEmail}>Отправить за прошлую неделю</Button></div>
      <p className="text-xs text-muted-foreground">Ключ хранится в зашифрованном виде и доступен для настройки только администраторам. После изменения настроек сначала нажмите «Сохранить».</p>
    </div>
    <div className="space-y-3 rounded-xl border bg-card p-5">
      <h2 className="font-semibold">Как подключить</h2>
      <ol className="list-decimal space-y-2 pl-5 text-sm">
        <li>В <a className="underline" href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">Google Cloud Console</a> создайте проект или выберите существующий.</li>
        <li>В «APIs & Services → Library» включите <strong>Google Sheets API</strong>.</li>
        <li>Откройте «IAM & Admin → Service Accounts», создайте сервисный аккаунт. Роли проекта выдавать не нужно.</li>
        <li>Откройте аккаунт → «Keys → Add key → Create new key → JSON». Скачайте файл, вставьте его содержимое выше и сохраните.</li>
        <li>Добавьте email сервисного аккаунта в доступ к таблице с ролью «Редактор».</li>
        <li>Нажмите «Отправить за прошлую неделю» для проверки. Затем включите автоматический отчёт и сохраните.</li>
      </ol>
    </div>
    <div className="space-y-2 rounded-xl border bg-card p-5 text-sm">
      <p><strong>Столбцы:</strong> дата, сумма, домен, провайдер, валюта, байер, команда, сервер, Cloudflare. «Сумма» — цена покупки; итог считается отдельно по каждой валюте.</p>
      <p>Каждая неделя — отдельная вкладка. Повторная отправка сохраняет готовый отчёт; существующие листы не меняются.</p>
      {data && <p>Прошлая неделя: {data.preview.start} — {data.preview.end}. Доменов: {data.preview.count}. {Object.entries(data.preview.totals).map(([c, v]) => `${v.toFixed(2)} ${c}`).join(" · ")}</p>}
      <p>Автоотправка: {s?.enabled ? "включена" : "выключена"}.</p>
      {s?.lastSuccessAt && <p>Последний отчёт: <a className="underline" href={`https://docs.google.com/spreadsheets/d/${s.spreadsheetId}/edit#gid=${s.lastSheetId}`} target="_blank" rel="noreferrer">неделя с {s.lastReportWeek}, {s.lastDomainCount} доменов</a>.</p>}
      {s?.lastError && <p role="alert" className="text-destructive">{s.lastError}</p>}
    </div>
  </div>;
}
