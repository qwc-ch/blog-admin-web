import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "../lib/utils";

/* ---------- Button ---------- */

type ButtonVariant = "primary" | "outline" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md";
}

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-foreground text-background hover:bg-foreground/85 hover:text-background",
  outline:
    "border border-border text-foreground hover:bg-foreground hover:text-background hover:border-foreground",
  ghost: "text-muted-foreground hover:bg-card-hover hover:text-foreground",
  danger: "text-accent hover:bg-accent hover:text-background",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-mono font-medium transition-colors duration-75 select-none",
        "disabled:opacity-40 disabled:pointer-events-none cursor-pointer",
        size === "md" ? "h-9 px-4 text-sm" : "h-7 px-2.5 text-xs",
        buttonVariants[variant],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";

/* ---------- Form primitives ---------- */

export const Label = forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn(
      "text-[10px] font-mono uppercase tracking-wider text-muted-foreground",
      className,
    )}
    {...props}
  />
));
Label.displayName = "Label";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-9 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground",
        "placeholder:text-muted-foreground/60 outline-none transition-colors duration-75",
        "focus:border-foreground/60 disabled:opacity-40",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground",
      "placeholder:text-muted-foreground/60 outline-none transition-colors duration-75",
      "focus:border-foreground/60 disabled:opacity-40 resize-y",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "h-9 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground",
      "outline-none transition-colors duration-75 focus:border-foreground/60",
      "cursor-pointer [&>option]:bg-card",
      className,
    )}
    {...props}
  />
));
Select.displayName = "Select";

/* ---------- Toggle switch ---------- */

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-75 cursor-pointer",
        "disabled:opacity-40 disabled:pointer-events-none",
        checked ? "border-foreground bg-foreground" : "border-border-strong bg-muted",
      )}
    >
      <span
        className={cn(
          "absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full transition-all duration-75",
          checked
            ? "left-[calc(100%-0.75rem-2px)] bg-background"
            : "left-[3px] bg-muted-foreground",
        )}
      />
    </button>
  );
}

/* ---------- Badge / pill ---------- */

interface BadgeProps {
  children: ReactNode;
  className?: string;
  variant?: "default" | "outline" | "accent" | "ok";
}

const badgeVariants: Record<string, string> = {
  default: "border-border-strong bg-card text-muted-foreground",
  outline: "border-border text-foreground",
  accent: "border-accent bg-accent text-background border",
  ok: "border-ok/50 bg-ok/10 text-ok border",
};

export function Badge({ children, className, variant = "default" }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-px font-mono text-[10px] uppercase tracking-wider",
        badgeVariants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ---------- Message (toast-like) ---------- */

export function Message({
  type = "success",
  children,
}: {
  type?: "success" | "error";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "mb-4 flex items-center gap-2 rounded-md border px-3 py-2 font-mono text-xs",
        type === "success"
          ? "border-ok/40 bg-ok/10 text-ok"
          : "border-accent/50 bg-accent/10 text-accent",
      )}
    >
      {children}
    </div>
  );
}

/* ---------- Empty state ---------- */

export function EmptyState({
  icon,
  text,
}: {
  icon?: ReactNode;
  text: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      {icon && <div className="text-muted-foreground/30">{icon}</div>}
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

/* ---------- Page header ---------- */

export function PageHeader({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <h2 className="text-base font-bold tracking-tight">{title}</h2>
        {count !== undefined && <Badge>{count}</Badge>}
      </div>
      {children}
    </div>
  );
}

/* ---------- Field (label + control) ---------- */

export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

/* ---------- Card ---------- */

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-border bg-card", className)}>
      {children}
    </div>
  );
}
