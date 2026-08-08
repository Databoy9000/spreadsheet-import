import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * shadcn's `cn`, verbatim. Kept identical on purpose: if you copy these
 * components into a shadcn project, they should collapse onto the `cn` you
 * already have rather than fight it.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
