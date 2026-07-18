import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind class strings, resolving conflicting utilities (last wins)
 * and dropping falsy values. Used across the Cloud primitive kit for
 * className passthrough.
 */
export const cn = (...inputs) => twMerge(clsx(inputs));
