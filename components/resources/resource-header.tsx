'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { HEADER_NAV, type ResourceKey } from './resource-nav';

const linkClass = (active: boolean) =>
  `rounded-md px-3 py-2 text-sm font-medium transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
    active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
  }`;

// Sticky site header shared by the Help Center pages (via ResourceShell) and the public Home page.
// md and up: horizontal nav. Below md: hamburger button toggling a stacked dropdown panel.
export function ResourceHeader({ current }: { current: ResourceKey | 'home' }) {
  const [open, setOpen] = useState(false);

  // Escape closes the mobile menu.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 md:self-start">
          <Image src="/icon.png" alt="OXIVOLT logo" width={36} height={36} className="rounded-lg" />
          <span className="font-display text-base font-bold leading-tight tracking-tight">OXIVOLT Bulk Editor</span>
        </Link>
        <nav aria-label="Help Center" className="hidden overflow-x-auto md:block">
          <ul className="flex min-w-max items-center gap-1">
            {HEADER_NAV.map((item) => {
              const active = item.key === current;
              return (
                <li key={item.key}>
                  <Link href={item.href} aria-current={active ? 'page' : undefined} className={`inline-flex ${linkClass(active)}`}>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label="Toggle navigation"
          aria-expanded={open}
          aria-controls="mobile-nav"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border text-foreground transition-colors duration-fast hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
        >
          {open ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
        </button>
      </div>
      <nav
        id="mobile-nav"
        aria-label="Help Center"
        hidden={!open}
        className="w-full overflow-hidden border-t border-border bg-background shadow-md animate-in fade-in slide-in-from-top-1 md:hidden"
      >
        <ul className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-4 py-3 sm:px-6">
          {HEADER_NAV.map((item) => {
            const active = item.key === current;
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                  className={`block w-full ${linkClass(active)}`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
