'use client';

import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';

export default function ExitIframe({ shop }: { shop: string }) {
  useEffect(() => {
    const url = `/api/auth?shop=${encodeURIComponent(shop ?? '')}`;
    try {
      if (window.top) {
        window.top.location.href = url;
      } else {
        window.location.href = url;
      }
    } catch {
      window.location.href = url;
    }
  }, [shop]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">Connecting to your Shopify store…</p>
    </div>
  );
}
