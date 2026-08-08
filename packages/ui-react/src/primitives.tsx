"use client"

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react"

/**
 * Minimal class joiner. A dependency on `clsx` would be the only runtime dep
 * in this package, for eleven characters of logic.
 */
export function cx(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(" ")
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger"
}

export function Button({ variant = "secondary", className, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium",
        "transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600",
        "disabled:pointer-events-none disabled:opacity-50",
        variant === "primary" && "bg-sky-600 text-white hover:bg-sky-700",
        variant === "secondary" &&
          "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800",
        variant === "ghost" && "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
        className,
      )}
      {...props}
    />
  )
}

export function Alert({
  level = "error",
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { level?: "info" | "warning" | "error" }) {
  return (
    <div
      role={level === "error" ? "alert" : "status"}
      className={cx(
        "rounded-md border px-3 py-2 text-sm",
        level === "error" && "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
        level === "warning" &&
          "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
        level === "info" && "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function StepShell({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">{title}</h2>
        {description ? <p className="text-sm text-slate-600 dark:text-slate-400">{description}</p> : null}
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      {footer ? <footer className="flex items-center justify-between gap-2 pt-2">{footer}</footer> : null}
    </div>
  )
}
