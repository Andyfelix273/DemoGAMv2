/**
 * PlaceholderPage — Pagina placeholder per moduli non ancora migrati
 * Mostra un messaggio con il nome del modulo e un link alla versione vanilla
 */
import { Construction } from 'lucide-react';

interface Props {
  title: string;
  description?: string;
  legacyUrl?: string;
}

export default function PlaceholderPage({ title, description, legacyUrl }: Props) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
      <Construction size={48} className="text-[var(--gam-accent)]/60" />
      <h2 className="text-xl font-semibold text-[var(--gam-text-primary)]">{title}</h2>
      {description && (
        <p className="text-sm text-[var(--gam-text-muted)] max-w-md">{description}</p>
      )}
      <p className="text-xs text-[var(--gam-text-muted)]">
        Modulo in migrazione verso React — disponibile nella versione precedente
      </p>
      {legacyUrl && (
        <a
          href={legacyUrl}
          className="text-xs text-[var(--gam-accent)] hover:underline"
        >
          Apri versione precedente →
        </a>
      )}
    </div>
  );
}
