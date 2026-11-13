/**
 * Tiny UI primitives. Lovable projects usually pull in shadcn/ui; for a demo of this size
 * a handful of Tailwind components keeps the dependency list short.
 */
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const variants: Record<Variant, string> = {
  primary: 'bg-teal-700 text-white hover:bg-teal-800 focus-visible:outline-teal-700',
  secondary: 'bg-white text-stone-800 ring-1 ring-stone-300 hover:bg-stone-50 focus-visible:outline-stone-500',
  danger: 'bg-white text-red-700 ring-1 ring-red-200 hover:bg-red-50 focus-visible:outline-red-600',
  ghost: 'text-stone-700 hover:bg-stone-100 focus-visible:outline-stone-500',
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

export function TextField({ label, id, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-stone-700">
        {label}
      </label>
      <input
        id={id}
        className="mt-1 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 focus:outline-none"
        {...props}
      />
    </div>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-6 w-6 animate-spin rounded-full border-2 border-teal-700 border-t-transparent ${className}`}
    />
  );
}

export function Alert({ tone = 'error', children }: { tone?: 'error' | 'success' | 'info'; children: ReactNode }) {
  const tones = {
    error: 'border-red-200 bg-red-50 text-red-800',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    info: 'border-sky-200 bg-sky-50 text-sky-800',
  };
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-4 py-3 text-sm ${tones[tone]}`}>
      {children}
    </div>
  );
}

export function Badge({ tone, children }: { tone: 'green' | 'grey' | 'amber'; children: ReactNode }) {
  const tones = {
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    grey: 'bg-stone-100 text-stone-600 ring-stone-500/20',
    amber: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-8">
      <h1 className="text-3xl font-semibold tracking-tight text-stone-900">{title}</h1>
      {subtitle && <p className="mt-2 text-stone-600">{subtitle}</p>}
    </div>
  );
}
