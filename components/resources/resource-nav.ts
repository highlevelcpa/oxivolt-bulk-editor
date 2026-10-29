// Help Center navigation data, shared by the server ResourceShell (footer) and the client
// ResourceHeader. Kept in a plain module (no 'use client') so server code gets real arrays.

export type ResourceKey = 'docs' | 'tutorial' | 'faq' | 'changelog' | 'privacy';

export const NAV: { key: ResourceKey; href: string; label: string }[] = [
  { key: 'docs', href: '/docs', label: 'User Guide' },
  { key: 'tutorial', href: '/tutorial', label: 'Tutorial' },
  { key: 'faq', href: '/faq', label: 'FAQ' },
  { key: 'changelog', href: '/changelog', label: 'Changelog' },
  { key: 'privacy', href: '/privacy', label: 'Privacy' },
];

// Header adds a Home link (public landing page) before the Help Center items.
export const HEADER_NAV: { key: ResourceKey | 'home'; href: string; label: string }[] = [
  { key: 'home', href: '/', label: 'Home' },
  ...NAV,
];
