import { create } from "zustand";
import type { User } from "@/api/types";

const KEY = "ng-auth";

interface Stored {
  token: string;
  user: User;
}

function load(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

function save(value: Stored | null) {
  try {
    if (value) localStorage.setItem(KEY, JSON.stringify(value));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable (private mode) - session stays in memory */
  }
}

interface AuthState {
  token: string | null;
  user: User | null;
  notice: string | null;
  setSession: (token: string, user: User) => void;
  setUser: (user: User) => void;
  logout: (notice?: string) => void;
  clearNotice: () => void;
}

const initial = load();

export const useAuth = create<AuthState>((set, get) => ({
  token: initial?.token ?? null,
  user: initial?.user ?? null,
  notice: null,
  setSession: (token, user) => {
    save({ token, user });
    set({ token, user, notice: null });
  },
  setUser: (user) => {
    const token = get().token;
    if (token) save({ token, user });
    set({ user });
  },
  logout: (notice) => {
    save(null);
    set({ token: null, user: null, notice: notice ?? null });
  },
  clearNotice: () => set({ notice: null }),
}));
