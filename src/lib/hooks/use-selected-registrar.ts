"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { useCart } from "@/lib/cart";

export function useSelectedRegistrar() {
  const selectedId = useCart((state) => state.registrarId);
  const setRegistrar = useCart((state) => state.setRegistrar);
  const registrars = useQuery({
    queryKey: ["registrars"],
    queryFn: () => api<{ registrars: Array<{ id: string; name: string }> }>("/api/registrars"),
  });
  const accounts = registrars.data?.registrars ?? [];
  const registrar = accounts.find((account) => account.id === selectedId) ?? accounts[0];
  const registrarId = registrar?.id;
  const balance = useQuery({
    queryKey: ["balance", registrarId],
    queryFn: () => api<{ balance: { amount: number; currency: string } }>(`/api/registrars/${registrarId}/balance`),
    enabled: Boolean(registrarId),
    retry: false,
    refetchInterval: 60_000,
  });
  return { registrar, registrarId, registrars, balance, setRegistrar };
}
