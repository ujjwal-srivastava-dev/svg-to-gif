import type { InputHTMLAttributes, ReactNode } from 'react';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm text-slate-300">
      {label}
      {children}
    </label>
  );
}

export function Check({ children, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="check">
      <input type="checkbox" {...props} />
      {children}
    </label>
  );
}
