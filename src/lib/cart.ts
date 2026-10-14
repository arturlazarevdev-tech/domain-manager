import { create } from "zustand";

export type CartDomain = {
  domain: string;
  price?: number;
  currency?: string;
};

type CartState = {
  domains: CartDomain[];
  registrarId?: string;
  buyerId?: string;
  setRegistrar: (id: string) => void;
  add: (domains: CartDomain[], registrarId?: string, buyerId?: string) => void;
  remove: (domain: string) => void;
  clear: () => void;
};

export const useCart = create<CartState>((set) => ({
  domains: [],
  setRegistrar: (registrarId) => set({ registrarId }),
  add: (domains, registrarId, buyerId) =>
    set((state) => {
      const map = new Map(state.domains.map((d) => [d.domain, d]));
      for (const domain of domains) map.set(domain.domain, domain);
      return {
        domains: [...map.values()],
        registrarId: registrarId ?? state.registrarId,
        buyerId: buyerId ?? state.buyerId,
      };
    }),
  remove: (domain) => set((state) => ({ domains: state.domains.filter((d) => d.domain !== domain) })),
  clear: () => set({ domains: [], buyerId: undefined }),
}));
