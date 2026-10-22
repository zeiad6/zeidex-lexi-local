import { useSyncExternalStore } from "react";

export interface Toast {
  id: number;
  title: string;
  body?: string;
  action?: { label: string; run: () => void };
  tone?: "info" | "success" | "warning";
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** In-app toast; also a system notification when the tab is hidden and permission was granted. */
export function notify(t: Omit<Toast, "id">) {
  toasts = [...toasts, { ...t, id: nextId++ }];
  emit();
  if (typeof document !== "undefined" && document.hidden && "Notification" in window && Notification.permission === "granted") {
    new Notification(t.title, { body: t.body, icon: "./icon.svg" });
  }
}

export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export const useToasts = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
  );
