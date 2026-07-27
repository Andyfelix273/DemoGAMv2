/**
 * Primitives — componenti atomici condivisi GAM
 * SectionTitle, LoadingSpinner, EmptyState, ErrorState, ConfirmDialog, SearchBar
 */
import React from 'react';
import { cn } from '@/lib/utils';
import { Loader2, AlertTriangle, Search, Inbox } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// ── SectionTitle ─────────────────────────────────────────────────────
interface SectionTitleProps {
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function SectionTitle({ children, action, className }: SectionTitleProps) {
  return (
    <div className={cn('flex items-center justify-between', className)}>
      <h3 className="gam-section-title flex-1">{children}</h3>
      {action && <div className="ml-2">{action}</div>}
    </div>
  );
}

// ── LoadingSpinner ───────────────────────────────────────────────────
interface LoadingSpinnerProps {
  size?: number;
  className?: string;
  label?: string;
}

export function LoadingSpinner({ size = 20, className, label }: LoadingSpinnerProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 py-8', className)}>
      <Loader2 size={size} className="animate-spin text-[var(--gam-accent)]" />
      {label && <p className="text-xs text-[var(--gam-text-muted)]">{label}</p>}
    </div>
  );
}

// ── EmptyState ───────────────────────────────────────────────────────
interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-12 text-center', className)}>
      <div className="text-[var(--gam-text-muted)] opacity-40">
        {icon ?? <Inbox size={40} />}
      </div>
      <div>
        <p className="text-sm font-medium text-[var(--gam-text-secondary)]">{title}</p>
        {description && <p className="text-xs text-[var(--gam-text-muted)] mt-1">{description}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

// ── ErrorState ───────────────────────────────────────────────────────
interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({ message, onRetry, className }: ErrorStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-8 text-center', className)}>
      <AlertTriangle size={32} className="text-[var(--gam-danger)]" />
      <p className="text-sm text-[var(--gam-text-secondary)]">{message ?? 'Errore nel caricamento dei dati'}</p>
      {onRetry && (
        <button className="gam-btn-primary text-xs px-3 py-1.5" onClick={onRetry}>
          Riprova
        </button>
      )}
    </div>
  );
}

// ── SearchBar ────────────────────────────────────────────────────────
interface SearchBarProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}

export function SearchBar({ value, onChange, placeholder = 'Cerca…', className }: SearchBarProps) {
  return (
    <div className={cn('relative', className)}>
      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--gam-text-muted)] pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="gam-input w-full pl-8 pr-3"
      />
    </div>
  );
}

// ── ConfirmDialog ────────────────────────────────────────────────────
interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  variant?: 'default' | 'danger';
}

export function ConfirmDialog({
  open, onOpenChange, title, description,
  confirmLabel = 'Conferma', cancelLabel = 'Annulla',
  onConfirm, variant = 'default',
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="bg-[var(--gam-bg-secondary)] border-[var(--gam-border)]">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-[var(--gam-text-primary)]">{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription className="text-[var(--gam-text-secondary)]">
              {description}
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="gam-input border-[var(--gam-border)] text-[var(--gam-text-secondary)]">
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={variant === 'danger' ? 'bg-[var(--gam-danger)] hover:bg-[var(--gam-danger)]/80 text-white' : 'gam-btn-primary'}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── DataRow ──────────────────────────────────────────────────────────
interface DataRowProps {
  label: string;
  value: React.ReactNode;
  className?: string;
}

export function DataRow({ label, value, className }: DataRowProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4 py-1.5 border-b border-[var(--gam-border)]/40 last:border-0', className)}>
      <span className="gam-label shrink-0">{label}</span>
      <span className="text-xs text-[var(--gam-text-primary)] text-right">{value ?? '–'}</span>
    </div>
  );
}

// ── FilterBar ────────────────────────────────────────────────────────
interface FilterOption {
  value: string;
  label: string;
}

interface FilterBarProps {
  filters: {
    key: string;
    label: string;
    options: FilterOption[];
    value: string;
    onChange: (v: string) => void;
  }[];
  search?: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
  };
  className?: string;
}

export function FilterBar({ filters, search, className }: FilterBarProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {search && (
        <SearchBar
          value={search.value}
          onChange={search.onChange}
          placeholder={search.placeholder}
          className="flex-1 min-w-40"
        />
      )}
      {filters.map(f => (
        <select
          key={f.key}
          value={f.value}
          onChange={e => f.onChange(e.target.value)}
          className="gam-input text-xs py-1"
        >
          <option value="">{f.label}</option>
          {f.options.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ))}
    </div>
  );
}
