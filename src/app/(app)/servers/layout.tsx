import { redirect } from "next/navigation";
import { requireUser } from "@/lib/api/auth";
export default async function ServersLayout({ children }: { children: React.ReactNode }) {
  const { user, response } = await requireUser();
  if (response || !user) redirect("/login");
  return <>{children}</>;
}
