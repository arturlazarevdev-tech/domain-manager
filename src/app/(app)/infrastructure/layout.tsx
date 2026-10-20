import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/api/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, response } = await requireAdmin();
  if (response || !user) redirect("/");
  return <>{children}</>;
}
