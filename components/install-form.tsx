'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Zap, Store, Tag, Boxes, ShieldCheck, ArrowRight, Sparkles, FolderTree, RotateCcw, Wand2 } from 'lucide-react';

function normalizeShop(raw: string): string | null {
  let s = (raw ?? '').trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!s.includes('.')) s = `${s}.myshopify.com`;
  if (/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s)) return s;
  return null;
}

export default function InstallForm() {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  const handleInstall = () => {
    const shop = normalizeShop(value);
    if (!shop) {
      setError('Enter a valid store domain, e.g. my-store.myshopify.com');
      return;
    }
    setError('');
    const url = `/api/auth?shop=${encodeURIComponent(shop)}`;
    window.location.href = url;
  };

  const features = [
    { icon: Wand2, title: 'Run all with AI', desc: 'Generate title, description, SEO, tags and category for many products in one click.' },
    { icon: Sparkles, title: 'AI content', desc: 'Write titles, descriptions, SEO meta tags and product tags automatically.' },
    { icon: FolderTree, title: 'Smart category', desc: 'Let AI set the right Shopify product category for each item.' },
    { icon: Store, title: 'Bulk vendor', desc: 'Set one vendor name across every selected product.' },
    { icon: Tag, title: 'Bulk pricing', desc: 'Multiply existing prices or set one fixed price.' },
    { icon: Boxes, title: 'Bulk inventory', desc: 'Push a single stock quantity to all products.' },
    { icon: RotateCcw, title: 'One-click restore', desc: 'Revert any product back to its original state after edits.' },
  ];

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-[1200px] flex-col items-center justify-center px-6 py-16">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-lg">
            <Zap className="h-7 w-7" />
          </span>
          <span className="font-display text-2xl font-bold tracking-tight">OXIVOLT Bulk Editor</span>
        </div>

        <h1 className="max-w-2xl text-center font-display text-4xl font-bold tracking-tight sm:text-5xl">
          Edit <span className="text-primary">hundreds</span> of products at once
        </h1>
        <p className="mt-4 max-w-2xl text-center text-base text-muted-foreground">
          Update vendor, price and inventory in bulk — or let AI generate titles, descriptions, SEO
          meta tags, product tags and categories. Preview, apply in one click, and restore anytime.
        </p>

        <Card className="mt-10 w-full max-w-md p-6 shadow-lg">
          <label className="mb-2 block text-sm font-medium">Your store domain</label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input
              value={value}
              onChange={(e) => setValue(e?.target?.value ?? '')}
              onKeyDown={(e) => {
                if (e?.key === 'Enter') handleInstall();
              }}
              placeholder="my-store.myshopify.com"
              className="flex-1"
            />
            <Button onClick={handleInstall} className="shrink-0">
              Install <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
          {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" /> Secure OAuth install · products &amp; inventory access
          </p>
        </Card>

        <div className="mt-12 grid w-full max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => {
            const Icon = f.icon;
            return (
              <Card key={f.title} className="p-5 shadow-sm transition-shadow hover:shadow-md">
                <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-primary">
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="font-display text-lg font-semibold">{f.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{f.desc}</p>
              </Card>
            );
          })}
        </div>
      </div>
    </main>
  );
}
