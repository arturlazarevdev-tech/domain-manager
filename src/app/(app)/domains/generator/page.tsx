"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function GeneratorRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/domains/purchase");
  }, [router]);
  return <div className="text-sm text-muted-foreground">Opening Purchase...</div>;
}
