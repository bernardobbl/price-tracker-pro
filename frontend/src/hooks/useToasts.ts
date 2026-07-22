import { useCallback, useState } from "react";

export interface ToastItem {
  id: number;
  type: "success" | "error";
  message: string;
}

let counter = 0;

/** Hook simples de toasts com auto-dismiss. */
export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (type: ToastItem["type"], message: string) => {
      const id = ++counter;
      setToasts((prev) => [...prev, { id, type, message }]);
      window.setTimeout(() => remove(id), 4000);
    },
    [remove]
  );

  return { toasts, push, remove };
}
