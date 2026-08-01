import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "./utils";

type ToastType = "success" | "error";

interface ToastItem {
  id: number;
  type: ToastType;
  text: string;
}

type ShowToast = (text: string, type?: ToastType) => void;

const ToastContext = createContext<ShowToast>(() => {});

export function useToast(): ShowToast {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const show = useCallback<ShowToast>((text, type = "success") => {
    setToasts((t) => {
      if (t.some((x) => x.text === text)) return t;
      const id = ++idRef.current;
      setTimeout(() => {
        setToasts((t2) => t2.filter((x) => x.id !== id));
      }, 3000);
      return [...t, { id, type, text }];
    });
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {/* 屏幕最上方的全局提示 */}
      <div className="pointer-events-none fixed left-1/2 top-4 z-[100] flex w-full max-w-md -translate-x-1/2 flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              "pointer-events-auto w-fit rounded-lg border px-4 py-2 font-mono text-xs shadow-lg",
              "animate-[toast-in_0.2s_ease-out] backdrop-blur-md",
              t.type === "success"
                ? "border-ok/40 bg-background/90 text-ok"
                : "border-accent/50 bg-background/90 text-accent",
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
