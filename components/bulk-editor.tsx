'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { toast } from 'sonner';
import { authFetch } from '@/lib/client-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Zap,
  RefreshCw,
  Loader2,
  Store,
  Tag,
  Boxes,
  Eye,
  Rocket,
  CheckCircle2,
  AlertTriangle,
  ImageIcon,
  X,
  Crown,
  Lock,
  Sparkles,
  FolderTree,
  ChevronLeft,
  ChevronRight,
  Search,
  Tags,
  Wand2,
  FileText,
  History,
  Download,
  Type as TypeIcon,
  RotateCcw,
} from 'lucide-react';

type Product = {
  id: string;
  title: string;
  vendor: string;
  status: string;
  productType?: string;
  category?: string | null;
  image: string | null;
  imageAlt: string;
  totalInventory: number;
  variantId: string | null;
  price: string;
  inventoryQuantity: number;
  inventoryItemId: string | null;
  tags?: string[];
};

const CHUNK_SIZE = 5;
// Categorizing is slower (an AI call per product), so use a smaller batch to keep
// each request short and well within the App Bridge session-token lifetime.
const CAT_CHUNK_SIZE = 3;
const PAGE_SIZE = 50;

type PlanInfo = {
  plan: 'free' | 'pro';
  planName: string;
  productLimit: number | null; // null = unlimited
  upgradeUrl: string;
};

// Open a URL at the top level (breaks out of the Shopify admin iframe).
function openTopLevel(url: string) {
  try {
    if (typeof window !== 'undefined' && window.top) {
      window.top.location.href = url;
    } else if (typeof window !== 'undefined') {
      window.location.href = url;
    }
  } catch {
    if (typeof window !== 'undefined') window.open(url, '_blank');
  }
}

// Break out of the Shopify admin iframe to (re)authorize the app, e.g. when new
// permission scopes are required or the offline token needs refreshing.
function triggerReauth(shop: string) {
  const url = `/api/auth?shop=${encodeURIComponent(shop ?? '')}`;
  try {
    if (typeof window !== 'undefined' && window.top) {
      window.top.location.href = url;
    } else if (typeof window !== 'undefined') {
      window.location.href = url;
    }
  } catch {
    if (typeof window !== 'undefined') window.location.href = url;
  }
}

function money(v: string | number): string {
  const n = typeof v === 'number' ? v : parseFloat(v ?? '0');
  if (!isFinite(n)) return '0.00';
  return n.toFixed(2);
}

export default function BulkEditor({ shop, host }: { shop: string; host: string }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [planInfo, setPlanInfo] = useState<PlanInfo | null>(null);

  // Which fields to edit
  const [applyVendor, setApplyVendor] = useState(true);
  const [applyPrice, setApplyPrice] = useState(true);
  const [applyQuantity, setApplyQuantity] = useState(true);

  // Field values
  const [vendor, setVendor] = useState('OXIVOLT');
  const [priceMode, setPriceMode] = useState<'multiply' | 'fixed'>('multiply');
  const [factor, setFactor] = useState('0.7');
  const [fixedPrice, setFixedPrice] = useState('52.82');
  const [quantity, setQuantity] = useState('100');

  // Preview + apply
  const [showPreview, setShowPreview] = useState(false);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  // Auto category (AI)
  const [categorizing, setCategorizing] = useState(false);
  const [catProgress, setCatProgress] = useState({ done: 0, total: 0 });

  // AI content (descriptions + SEO)
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceMode, setEnhanceMode] = useState<'description' | 'seo' | 'tags' | 'title' | null>(null);
  const [enhanceProgress, setEnhanceProgress] = useState({ done: 0, total: 0 });

  // Run all AI actions at once
  const [runningAll, setRunningAll] = useState(false);
  const [runAllStep, setRunAllStep] = useState('');
  const [runAllProgress, setRunAllProgress] = useState({ done: 0, total: 0 });

  // Edit history
  const [showHistory, setShowHistory] = useState(false);
  const [historyItems, setHistoryItems] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [undoingId, setUndoingId] = useState<string | null>(null);

  // Monthly usage (products processed this month)
  const [usage, setUsage] = useState<{ period: string; count: number } | null>(null);

  // Pagination
  const [page, setPage] = useState(0);

  // Search + filter
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'draft' | 'archived'>('all');

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await authFetch('/api/products', { method: 'GET' });
      if (res.status === 401) {
        const info = await res.json().catch(() => ({}));
        if (info?.error === 'reauth_required') {
          setLoadError('Updating app permissions... redirecting to Shopify.');
          triggerReauth(shop);
          return;
        }
        setLoadError('Your session expired. Please reload the app from Shopify admin.');
        setProducts([]);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(data?.error ?? 'Failed to load products.');
        setProducts([]);
        return;
      }
      setProducts(Array.isArray(data?.products) ? data.products : []);
      setPage(0);
    } catch (e: any) {
      setLoadError(e?.message ?? 'Failed to load products.');
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [shop]);

  const loadPlan = useCallback(async () => {
    try {
      const res = await authFetch('/api/subscription', { method: 'GET' });
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      if (data?.plan) {
        setPlanInfo({
          plan: data.plan,
          planName: data.planName ?? (data.plan === 'pro' ? 'Pro' : 'Free'),
          productLimit: data.productLimit ?? null,
          upgradeUrl: data.upgradeUrl ?? '',
        });
      }
    } catch {
      // non-fatal: leave plan unknown, limits are re-checked server-side
    }
  }, []);

  const loadUsage = useCallback(async () => {
    try {
      const res = await authFetch('/api/usage', { method: 'GET' });
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      if (typeof data?.count === 'number') {
        setUsage({ period: data.period ?? '', count: data.count });
      }
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    loadProducts();
    loadPlan();
    loadUsage();
  }, [loadProducts, loadPlan, loadUsage]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (statusFilter !== 'all' && (p?.status ?? '').toLowerCase() !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        (p?.title ?? '').toLowerCase().includes(q) ||
        (p?.vendor ?? '').toLowerCase().includes(q) ||
        (p?.productType ?? '').toLowerCase().includes(q) ||
        (p?.category ?? '').toLowerCase().includes(q)
      );
    });
  }, [products, search, statusFilter]);

  // Reset to first page whenever the filter/search changes.
  useEffect(() => {
    setPage(0);
  }, [search, statusFilter]);

  const selectedInFiltered = useMemo(
    () => filtered.reduce((acc, p) => (selected.has(p?.id) ? acc + 1 : acc), 0),
    [filtered, selected],
  );
  const allSelected = filtered.length > 0 && selectedInFiltered === filtered.length;
  const someSelected = selectedInFiltered > 0 && selectedInFiltered < filtered.length;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const pageProducts = useMemo(
    () => filtered.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE),
    [filtered, currentPage],
  );

  const toggleAll = () => {
    const ids = filtered.map((p) => p?.id).filter(Boolean) as string[];
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const computeNewPrice = useCallback(
    (p: Product): string => {
      if (!applyPrice) return money(p?.price);
      if (priceMode === 'fixed') return money(fixedPrice);
      const f = parseFloat(factor);
      const base = parseFloat(p?.price ?? '0');
      if (!isFinite(f) || !isFinite(base)) return money(p?.price);
      return money(base * f);
    },
    [applyPrice, priceMode, fixedPrice, factor],
  );

  const selectedProducts = useMemo(
    () => products.filter((p) => selected.has(p?.id)),
    [products, selected],
  );

  const noFieldSelected = !applyVendor && !applyPrice && !applyQuantity;

  const productLimit = planInfo?.productLimit ?? null;
  const isFree = planInfo?.plan === 'free';
  const overLimit = productLimit !== null && selected.size > productLimit;

  const goUpgrade = () => {
    if (planInfo?.upgradeUrl) openTopLevel(planInfo.upgradeUrl);
  };

  const handlePreview = () => {
    if (selectedProducts.length === 0) {
      toast.error('Select at least one product first.');
      return;
    }
    if (noFieldSelected) {
      toast.error('Enable at least one field to edit.');
      return;
    }
    if (overLimit) {
      toast.error(
        `Your ${planInfo?.planName ?? 'Free'} plan is limited to ${productLimit} products. Upgrade to edit more.`,
      );
      return;
    }
    setShowPreview(true);
  };

  const buildUpdate = (p: Product) => {
    const u: any = {
      productId: p?.id,
      title: p?.title,
      variantId: p?.variantId,
      inventoryItemId: p?.inventoryItemId,
    };
    if (applyVendor) {
      u.vendor = vendor;
      u.prevVendor = p?.vendor ?? '';
    }
    if (applyPrice) {
      u.price = computeNewPrice(p);
      u.prevPrice = money(p?.price);
    }
    if (applyQuantity) {
      u.quantity = parseInt(quantity, 10);
      u.prevQuantity = typeof p?.inventoryQuantity === 'number' ? p.inventoryQuantity : (p?.totalInventory ?? 0);
    }
    return u;
  };

  const handleApply = async () => {
    if (selectedProducts.length === 0 || noFieldSelected) return;
    if (overLimit) {
      toast.error(
        `Your ${planInfo?.planName ?? 'Free'} plan is limited to ${productLimit} products. Upgrade to edit more.`,
      );
      return;
    }
    setApplying(true);
    setShowPreview(false);
    setProgress({ done: 0, total: selectedProducts.length });

    let okCount = 0;
    let failCount = 0;
    const failures: string[] = [];

    const updates = selectedProducts.map(buildUpdate);
    for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
      const chunk = updates.slice(i, i + CHUNK_SIZE);
      try {
        const res = await authFetch('/api/products/update', {
          method: 'POST',
          body: JSON.stringify({ updates: chunk }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401 && data?.error === 'reauth_required') {
          setApplying(false);
          toast.info('Updating app permissions... redirecting to Shopify.');
          triggerReauth(shop);
          return;
        }
        if (res.status === 402 && data?.error === 'limit_exceeded') {
          setApplying(false);
          toast.error(data?.message ?? 'Plan limit reached. Please upgrade.');
          await loadPlan();
          return;
        }
        const results = Array.isArray(data?.results) ? data.results : [];
        for (const r of results) {
          if (r?.success) okCount += 1;
          else {
            failCount += 1;
            if (r?.error) failures.push(r.error);
          }
        }
        if (!res.ok && results.length === 0) {
          failCount += chunk.length;
          if (data?.error) failures.push(data.error);
        }
      } catch (e: any) {
        failCount += chunk.length;
        failures.push(e?.message ?? 'Network error');
      }
      setProgress({ done: Math.min(i + chunk.length, updates.length), total: updates.length });
    }

    setApplying(false);
    if (failCount === 0) {
      toast.success(`Updated ${okCount} product${okCount === 1 ? '' : 's'} successfully.`);
    } else if (okCount === 0) {
      toast.error(`All updates failed. ${failures[0] ?? ''}`);
    } else {
      toast.warning(`${okCount} updated, ${failCount} failed. ${failures[0] ?? ''}`);
    }
    await loadProducts();
    await loadUsage();
  };

  const handleCategorize = async () => {
    if (selectedProducts.length === 0) {
      toast.error('Select at least one product first.');
      return;
    }
    if (overLimit) {
      toast.error(
        `Your ${planInfo?.planName ?? 'Free'} plan is limited to ${productLimit} products. Upgrade to categorize more.`,
      );
      return;
    }

    setCategorizing(true);
    setCatProgress({ done: 0, total: selectedProducts.length });

    let okCount = 0;
    let failCount = 0;
    const failures: string[] = [];

    const ids = selectedProducts.map((p) => p?.id).filter(Boolean) as string[];
    for (let i = 0; i < ids.length; i += CAT_CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CAT_CHUNK_SIZE);
      try {
        const res = await authFetch('/api/products/categorize', {
          method: 'POST',
          body: JSON.stringify({ productIds: chunk }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401 && data?.error === 'reauth_required') {
          setCategorizing(false);
          toast.info('Updating app permissions... redirecting to Shopify.');
          triggerReauth(shop);
          return;
        }
        if (res.status === 402 && data?.error === 'limit_exceeded') {
          setCategorizing(false);
          toast.error(data?.message ?? 'Plan limit reached. Please upgrade.');
          await loadPlan();
          return;
        }
        const results = Array.isArray(data?.results) ? data.results : [];
        for (const r of results) {
          if (r?.success) okCount += 1;
          else {
            failCount += 1;
            if (r?.error) failures.push(r.error);
          }
        }
        if (!res.ok && results.length === 0) {
          failCount += chunk.length;
          if (data?.error) failures.push(data.error);
        }
      } catch (e: any) {
        failCount += chunk.length;
        failures.push(e?.message ?? 'Network error');
      }
      setCatProgress({ done: Math.min(i + chunk.length, ids.length), total: ids.length });
    }

    setCategorizing(false);
    if (failCount === 0) {
      toast.success(`Categorized ${okCount} product${okCount === 1 ? '' : 's'} successfully.`);
    } else if (okCount === 0) {
      toast.error(`Categorization failed. ${failures[0] ?? ''}`);
    } else {
      toast.warning(`${okCount} categorized, ${failCount} failed. ${failures[0] ?? ''}`);
    }
    await loadProducts();
    await loadUsage();
  };

  const handleEnhance = async (mode: 'description' | 'seo' | 'tags' | 'title') => {
    if (selectedProducts.length === 0) {
      toast.error('Select at least one product first.');
      return;
    }
    if (overLimit) {
      toast.error(
        `Your ${planInfo?.planName ?? 'Free'} plan is limited to ${productLimit} products. Upgrade to process more.`,
      );
      return;
    }

    setEnhancing(true);
    setEnhanceMode(mode);
    setEnhanceProgress({ done: 0, total: selectedProducts.length });

    let okCount = 0;
    let failCount = 0;
    const failures: string[] = [];

    const ids = selectedProducts.map((p) => p?.id).filter(Boolean) as string[];
    for (let i = 0; i < ids.length; i += CAT_CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CAT_CHUNK_SIZE);
      try {
        const res = await authFetch('/api/products/enhance', {
          method: 'POST',
          body: JSON.stringify({ productIds: chunk, mode }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401 && data?.error === 'reauth_required') {
          setEnhancing(false);
          setEnhanceMode(null);
          toast.info('Updating app permissions... redirecting to Shopify.');
          triggerReauth(shop);
          return;
        }
        if (res.status === 402 && data?.error === 'limit_exceeded') {
          setEnhancing(false);
          setEnhanceMode(null);
          toast.error(data?.message ?? 'Plan limit reached. Please upgrade.');
          await loadPlan();
          return;
        }
        const results = Array.isArray(data?.results) ? data.results : [];
        for (const r of results) {
          if (r?.success) okCount += 1;
          else {
            failCount += 1;
            if (r?.error) failures.push(r.error);
          }
        }
        if (!res.ok && results.length === 0) {
          failCount += chunk.length;
          if (data?.error) failures.push(data.error);
        }
      } catch (e: any) {
        failCount += chunk.length;
        failures.push(e?.message ?? 'Network error');
      }
      setEnhanceProgress({ done: Math.min(i + chunk.length, ids.length), total: ids.length });
    }

    setEnhancing(false);
    setEnhanceMode(null);
    const label =
      mode === 'seo'
        ? 'SEO meta tags'
        : mode === 'tags'
          ? 'tags'
          : mode === 'title'
            ? 'titles'
            : 'descriptions';
    if (failCount === 0) {
      toast.success(`Generated ${label} for ${okCount} product${okCount === 1 ? '' : 's'}.`);
    } else if (okCount === 0) {
      toast.error(`Could not generate ${label}. ${failures[0] ?? ''}`);
    } else {
      toast.warning(`${okCount} done, ${failCount} failed. ${failures[0] ?? ''}`);
    }
    await loadProducts();
    await loadUsage();
  };

  // One-click: run every AI action (title, description, SEO, tags, category) on the selection
  const handleRunAll = async () => {
    if (selectedProducts.length === 0) {
      toast.error('Select at least one product first.');
      return;
    }
    if (overLimit) {
      toast.error(
        `Your ${planInfo?.planName ?? 'Free'} plan is limited to ${productLimit} products. Upgrade to process more.`,
      );
      return;
    }

    const steps: { endpoint: string; label: string; body: (chunk: string[]) => any }[] = [
      { endpoint: '/api/products/enhance', label: 'content', body: (c) => ({ productIds: c, mode: 'all' }) },
      { endpoint: '/api/products/categorize', label: 'category', body: (c) => ({ productIds: c }) },
    ];

    const ids = selectedProducts.map((p) => p?.id).filter(Boolean) as string[];
    setRunningAll(true);
    setRunAllStep(steps[0].label);
    const totalUnits = ids.length * steps.length;
    let doneUnits = 0;
    setRunAllProgress({ done: 0, total: totalUnits });

    let okTotal = 0;
    let failTotal = 0;
    let firstError = '';

    for (const step of steps) {
      setRunAllStep(step.label);
      for (let i = 0; i < ids.length; i += CAT_CHUNK_SIZE) {
        const chunk = ids.slice(i, i + CAT_CHUNK_SIZE);
        try {
          const res = await authFetch(step.endpoint, {
            method: 'POST',
            body: JSON.stringify(step.body(chunk)),
          });
          const data = await res.json().catch(() => ({}));
          if (res.status === 401 && data?.error === 'reauth_required') {
            setRunningAll(false);
            setRunAllStep('');
            toast.info('Updating app permissions... redirecting to Shopify.');
            triggerReauth(shop);
            return;
          }
          if (res.status === 402 && data?.error === 'limit_exceeded') {
            setRunningAll(false);
            setRunAllStep('');
            toast.error(data?.message ?? 'Plan limit reached. Please upgrade.');
            await loadPlan();
            return;
          }
          const results = Array.isArray(data?.results) ? data.results : [];
          for (const r of results) {
            if (r?.success) okTotal += 1;
            else {
              failTotal += 1;
              if (r?.error && !firstError) firstError = r.error;
            }
          }
          if (!res.ok && results.length === 0) {
            failTotal += chunk.length;
            if (data?.error && !firstError) firstError = data.error;
          }
        } catch (e: any) {
          failTotal += chunk.length;
          if (!firstError) firstError = e?.message ?? 'Network error';
        }
        doneUnits += chunk.length;
        setRunAllProgress({ done: doneUnits, total: totalUnits });
      }
    }

    setRunningAll(false);
    setRunAllStep('');
    if (failTotal === 0) {
      toast.success(
        `AI finished all 5 actions on ${ids.length} product${ids.length === 1 ? '' : 's'}.`,
      );
    } else if (okTotal === 0) {
      toast.error(`AI run failed. ${firstError}`);
    } else {
      toast.warning(`${okTotal} operations done, ${failTotal} failed. ${firstError}`);
    }
    await loadProducts();
    await loadUsage();
  };

  const openHistory = async () => {
    setShowHistory(true);
    setHistoryLoading(true);
    try {
      const res = await authFetch('/api/history', { method: 'GET' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && data?.error === 'reauth_required') {
        setShowHistory(false);
        toast.info('Updating app permissions... redirecting to Shopify.');
        triggerReauth(shop);
        return;
      }
      if (!res.ok) {
        toast.error(data?.error ?? 'Could not load history.');
        setHistoryItems([]);
        return;
      }
      setHistoryItems(Array.isArray(data?.items) ? data.items : []);
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not load history.');
      setHistoryItems([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleUndo = async (productId: string) => {
    if (!productId) return;
    setUndoingId(productId);
    try {
      const res = await authFetch('/api/products/restore', {
        method: 'POST',
        body: JSON.stringify({ productId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && data?.error === 'reauth_required') {
        toast.info('Updating app permissions... redirecting to Shopify.');
        triggerReauth(shop);
        return;
      }
      if (!res.ok || data?.success === false) {
        toast.error(data?.error ?? 'Could not restore this product.');
        return;
      }
      toast.success('Product restored to its original state.');
      // Flip every tracked edit of this product to "Undone".
      setHistoryItems((prev) =>
        prev.map((h) =>
          h?.productId === productId ? { ...h, undone: true, canUndo: false } : h,
        ),
      );
      await loadProducts();
      await loadUsage();
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not restore this product.');
    } finally {
      setUndoingId(null);
    }
  };

  const exportCsv = () => {
    const rows = selected.size > 0 ? selectedProducts : filtered;
    if (rows.length === 0) {
      toast.error('No products to export.');
      return;
    }
    const esc = (v: any) => {
      const s = (v ?? '').toString();
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ['Title', 'Vendor', 'Type', 'Category', 'Status', 'Tags', 'Price', 'Inventory'];
    const lines = [header.join(',')];
    for (const p of rows) {
      lines.push(
        [
          esc(p?.title),
          esc(p?.vendor),
          esc(p?.productType),
          esc(p?.category ?? ''),
          esc(p?.status),
          esc(Array.isArray(p?.tags) ? p.tags.join('; ') : ''),
          esc(money(p?.price)),
          esc(p?.inventoryQuantity ?? 0),
        ].join(','),
      );
    }
    const csv = lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `products-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} product${rows.length === 1 ? '' : 's'} to CSV.`);
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6">
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow">
              <Zap className="h-6 w-6" />
            </span>
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight">OXIVOLT Bulk Editor</h1>
              <p className="text-sm text-muted-foreground">
                <span suppressHydrationWarning>{shop}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {planInfo ? (
              <Badge
                variant={isFree ? 'secondary' : 'default'}
                className="gap-1.5 px-2.5 py-1 text-xs"
              >
                <Crown className="h-3.5 w-3.5" />
                {planInfo.planName} plan
                {productLimit !== null ? ` · up to ${productLimit}` : ' · unlimited'}
              </Badge>
            ) : null}
            {usage ? (
              <Badge variant="outline" className="gap-1.5 px-2.5 py-1 text-xs">
                <Boxes className="h-3.5 w-3.5" />
                {usage.count} processed this month
              </Badge>
            ) : null}
            {isFree ? (
              <Button variant="default" size="sm" onClick={goUpgrade} className="gap-1.5">
                <Crown className="h-4 w-4" /> Upgrade
              </Button>
            ) : null}
            <Button variant="outline" onClick={exportCsv} disabled={loading} className="gap-1.5">
              <Download className="h-4 w-4" /> Export CSV
            </Button>
            <Button variant="outline" onClick={openHistory} className="gap-1.5">
              <History className="h-4 w-4" /> History
            </Button>
            <Button variant="outline" onClick={loadProducts} disabled={loading || applying || categorizing || enhancing || runningAll}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_340px]">
          {/* Products table */}
          <Card className="overflow-hidden p-0 shadow-sm">
            {/* Search + filter banner */}
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-3">
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
                <SelectTrigger className="h-10 w-[120px] shrink-0">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
              <div className="relative min-w-[180px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e?.target?.value ?? '')}
                  placeholder="Search by title, vendor, type or category"
                  className="h-10 pl-9"
                />
                {search ? (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-secondary"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 border-b border-border bg-secondary/40 px-4 py-3">
              <div className="flex items-center gap-3">
                <Checkbox
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  onCheckedChange={toggleAll}
                  aria-label="Select all"
                />
                <span className="text-sm font-medium">Select all</span>
              </div>
              <Badge variant="secondary">
                {selected.size} / {filtered.length} selected
              </Badge>
            </div>

            <div className="max-h-[600px] overflow-y-auto">
              {loading ? (
                <div className="flex flex-col items-center justify-center gap-3 py-20">
                  <Loader2 className="h-7 w-7 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Loading products…</p>
                </div>
              ) : loadError ? (
                <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
                  <AlertTriangle className="h-7 w-7 text-destructive" />
                  <p className="max-w-sm text-sm text-muted-foreground">{loadError}</p>
                  <Button variant="outline" size="sm" onClick={loadProducts}>
                    Try again
                  </Button>
                </div>
              ) : products.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
                  <Boxes className="h-7 w-7 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No products found in this store.</p>
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
                  <Search className="h-7 w-7 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No products match your search.</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSearch('');
                      setStatusFilter('all');
                    }}
                  >
                    Clear filters
                  </Button>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {pageProducts.map((p) => {
                    const isSel = selected.has(p?.id);
                    return (
                      <li
                        key={p?.id}
                        className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                          isSel ? 'bg-primary/5' : 'hover:bg-secondary/40'
                        }`}
                      >
                        <Checkbox
                          checked={isSel}
                          onCheckedChange={() => toggleOne(p?.id)}
                          aria-label={`Select ${p?.title}`}
                        />
                        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md bg-muted">
                          {p?.image ? (
                            <Image
                              src={p.image}
                              alt={p?.imageAlt || p?.title || 'Product image'}
                              fill
                              sizes="48px"
                              className="object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                              <ImageIcon className="h-5 w-5" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{p?.title || 'Untitled'}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {p?.vendor || 'No vendor'}
                          </p>
                          <p className="mt-0.5 flex items-center gap-1 truncate text-xs">
                            <FolderTree className="h-3 w-3 shrink-0 text-muted-foreground" />
                            {p?.category ? (
                              <span className="truncate text-muted-foreground">{p.category}</span>
                            ) : (
                              <span className="truncate italic text-amber-600">No category</span>
                            )}
                          </p>
                        </div>
                        <div className="hidden w-20 text-right font-mono text-sm sm:block">
                          ${money(p?.price)}
                        </div>
                        <div className="w-16 text-right font-mono text-sm text-muted-foreground">
                          {p?.inventoryQuantity ?? 0}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            {!loading && !loadError && filtered.length > PAGE_SIZE ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-secondary/40 px-4 py-3 text-sm">
                <span className="text-muted-foreground">
                  Showing {currentPage * PAGE_SIZE + 1}–
                  {Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={currentPage === 0}
                  >
                    <ChevronLeft className="mr-1 h-4 w-4" /> Previous
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Page {currentPage + 1} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={currentPage >= totalPages - 1}
                  >
                    Next <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : null}
          </Card>

          {/* Bulk edit panel */}
          <div className="space-y-4">
            <Card className="space-y-5 p-5 shadow-sm">
              <h2 className="font-display text-lg font-semibold tracking-tight">Bulk edit</h2>

              {/* Vendor */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="applyVendor"
                    checked={applyVendor}
                    onCheckedChange={(v) => setApplyVendor(Boolean(v))}
                  />
                  <Label htmlFor="applyVendor" className="flex items-center gap-1.5 font-medium">
                    <Store className="h-4 w-4 text-primary" /> Vendor
                  </Label>
                </div>
                <Input
                  value={vendor}
                  onChange={(e) => setVendor(e?.target?.value ?? '')}
                  disabled={!applyVendor}
                  placeholder="OXIVOLT"
                />
              </div>

              {/* Price */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="applyPrice"
                    checked={applyPrice}
                    onCheckedChange={(v) => setApplyPrice(Boolean(v))}
                  />
                  <Label htmlFor="applyPrice" className="flex items-center gap-1.5 font-medium">
                    <Tag className="h-4 w-4 text-primary" /> Price
                  </Label>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={priceMode === 'multiply' ? 'default' : 'outline'}
                    onClick={() => setPriceMode('multiply')}
                    disabled={!applyPrice}
                    className="flex-1"
                  >
                    Multiply
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={priceMode === 'fixed' ? 'default' : 'outline'}
                    onClick={() => setPriceMode('fixed')}
                    disabled={!applyPrice}
                    className="flex-1"
                  >
                    Fixed
                  </Button>
                </div>
                {priceMode === 'multiply' ? (
                  <div>
                    <Input
                      type="number"
                      step="0.01"
                      value={factor}
                      onChange={(e) => setFactor(e?.target?.value ?? '')}
                      disabled={!applyPrice}
                      placeholder="0.7"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      New price = current price × factor
                    </p>
                  </div>
                ) : (
                  <div>
                    <Input
                      type="number"
                      step="0.01"
                      value={fixedPrice}
                      onChange={(e) => setFixedPrice(e?.target?.value ?? '')}
                      disabled={!applyPrice}
                      placeholder="52.82"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">Same price for all selected</p>
                  </div>
                )}
              </div>

              {/* Quantity */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="applyQuantity"
                    checked={applyQuantity}
                    onCheckedChange={(v) => setApplyQuantity(Boolean(v))}
                  />
                  <Label htmlFor="applyQuantity" className="flex items-center gap-1.5 font-medium">
                    <Boxes className="h-4 w-4 text-primary" /> Inventory quantity
                  </Label>
                </div>
                <Input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(e?.target?.value ?? '')}
                  disabled={!applyQuantity}
                  placeholder="100"
                />
              </div>

              {overLimit ? (
                <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="space-y-1.5">
                    <p>
                      You selected <b>{selected.size}</b> products, but the{' '}
                      <b>{planInfo?.planName ?? 'Free'}</b> plan allows editing{' '}
                      <b>{productLimit}</b> at a time.
                    </p>
                    <Button size="sm" onClick={goUpgrade} className="h-7 gap-1.5">
                      <Crown className="h-3.5 w-3.5" /> Upgrade to edit all
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="space-y-2 pt-2">
                <Button
                  onClick={handlePreview}
                  variant="outline"
                  className="w-full"
                  disabled={applying || loading || categorizing || enhancing || runningAll || overLimit}
                >
                  <Eye className="mr-2 h-4 w-4" /> Preview changes
                </Button>
                <Button
                  onClick={handleApply}
                  className="w-full"
                  disabled={applying || loading || categorizing || enhancing || runningAll || selected.size === 0 || noFieldSelected || overLimit}
                >
                  {applying ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Rocket className="mr-2 h-4 w-4" />
                  )}
                  Apply to {selected.size} product{selected.size === 1 ? '' : 's'}
                </Button>
              </div>

              {applying ? (
                <div className="space-y-2">
                  <Progress
                    value={progress.total > 0 ? (progress.done / progress.total) * 100 : 0}
                  />
                  <p className="text-center text-xs text-muted-foreground">
                    {progress.done} / {progress.total} processed
                  </p>
                </div>
              ) : null}
            </Card>

            {/* AI Content (descriptions + SEO) */}
            <Card className="space-y-4 p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Wand2 className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="font-display text-lg font-semibold tracking-tight">AI Content</h2>
                  <p className="text-xs text-muted-foreground">Titles, descriptions, SEO (incl. URL handle), tags &amp; category</p>
                </div>
              </div>

              <p className="text-sm text-muted-foreground">
                Let AI handle everything for the selected products — titles, descriptions,
                search-optimized meta tags, product tags and the best Shopify category — based on
                their image and details. Run them all at once, or one at a time.
              </p>

              <div className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{selected.size}</span> product
                {selected.size === 1 ? '' : 's'} selected
              </div>

              {overLimit ? (
                <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="space-y-1.5">
                    <p>
                      You selected <b>{selected.size}</b> products, but the{' '}
                      <b>{planInfo?.planName ?? 'Free'}</b> plan allows <b>{productLimit}</b> at a time.
                    </p>
                    <Button size="sm" onClick={goUpgrade} className="h-7 gap-1.5">
                      <Crown className="h-3.5 w-3.5" /> Upgrade for unlimited
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="space-y-2">
                <Button
                  onClick={handleRunAll}
                  className="w-full"
                  disabled={runningAll || enhancing || categorizing || applying || loading || selected.size === 0 || overLimit}
                >
                  {runningAll ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Wand2 className="mr-2 h-4 w-4" />
                  )}
                  Run all with AI
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  Title, description, SEO, tags &amp; category — all in one click.
                </p>

                <div className="flex items-center gap-2 pt-1">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    or run one at a time
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>

                <Button
                  onClick={() => handleEnhance('title')}
                  variant="outline"
                  className="w-full"
                  disabled={runningAll || enhancing || categorizing || applying || loading || selected.size === 0 || overLimit}
                >
                  {enhancing && enhanceMode === 'title' ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <TypeIcon className="mr-2 h-4 w-4" />
                  )}
                  Generate titles
                </Button>
                <Button
                  onClick={() => handleEnhance('description')}
                  variant="outline"
                  className="w-full"
                  disabled={runningAll || enhancing || categorizing || applying || loading || selected.size === 0 || overLimit}
                >
                  {enhancing && enhanceMode === 'description' ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FileText className="mr-2 h-4 w-4" />
                  )}
                  Generate descriptions
                </Button>
                <Button
                  onClick={() => handleEnhance('seo')}
                  variant="outline"
                  className="w-full"
                  disabled={runningAll || enhancing || categorizing || applying || loading || selected.size === 0 || overLimit}
                >
                  {enhancing && enhanceMode === 'seo' ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 h-4 w-4" />
                  )}
                  Generate SEO &amp; URL handle
                </Button>
                <Button
                  onClick={() => handleEnhance('tags')}
                  variant="outline"
                  className="w-full"
                  disabled={runningAll || enhancing || categorizing || applying || loading || selected.size === 0 || overLimit}
                >
                  {enhancing && enhanceMode === 'tags' ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Tags className="mr-2 h-4 w-4" />
                  )}
                  Generate tags
                </Button>
                <Button
                  onClick={handleCategorize}
                  variant="outline"
                  className="w-full"
                  disabled={runningAll || enhancing || categorizing || applying || loading || selected.size === 0 || overLimit}
                >
                  {categorizing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FolderTree className="mr-2 h-4 w-4" />
                  )}
                  Set product category
                </Button>
              </div>

              {runningAll ? (
                <div className="space-y-2">
                  <Progress
                    value={runAllProgress.total > 0 ? (runAllProgress.done / runAllProgress.total) * 100 : 0}
                  />
                  <p className="text-center text-xs text-muted-foreground">
                    {runAllStep ? `Generating ${runAllStep}… ` : ''}
                    {runAllProgress.done} / {runAllProgress.total} processed
                  </p>
                </div>
              ) : enhancing ? (
                <div className="space-y-2">
                  <Progress
                    value={
                      enhanceProgress.total > 0
                        ? (enhanceProgress.done / enhanceProgress.total) * 100
                        : 0
                    }
                  />
                  <p className="text-center text-xs text-muted-foreground">
                    {enhanceProgress.done} / {enhanceProgress.total} processed
                  </p>
                </div>
              ) : categorizing ? (
                <div className="space-y-2">
                  <Progress
                    value={catProgress.total > 0 ? (catProgress.done / catProgress.total) * 100 : 0}
                  />
                  <p className="text-center text-xs text-muted-foreground">
                    {catProgress.done} / {catProgress.total} processed
                  </p>
                </div>
              ) : null}
            </Card>
          </div>
        </div>
      </div>

      {/* Preview modal */}
      {showPreview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden p-0 shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h3 className="font-display text-lg font-semibold">Preview changes</h3>
              <Button variant="ghost" size="icon" onClick={() => setShowPreview(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3">
              <p className="mb-3 text-sm text-muted-foreground">
                {selectedProducts.length} product{selectedProducts.length === 1 ? '' : 's'} will be
                updated. Showing first {Math.min(selectedProducts.length, 50)}.
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-2">Product</th>
                    {applyVendor ? <th className="py-2 px-2">Vendor</th> : null}
                    {applyPrice ? <th className="py-2 px-2">Price</th> : null}
                    {applyQuantity ? <th className="py-2 pl-2">Qty</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {selectedProducts.slice(0, 50).map((p) => (
                    <tr key={p?.id} className="border-b border-border/60">
                      <td className="max-w-[200px] truncate py-2 pr-2">{p?.title}</td>
                      {applyVendor ? (
                        <td className="py-2 px-2">
                          <span className="text-muted-foreground line-through">{p?.vendor || '—'}</span>{' '}
                          <span className="font-medium text-primary">{vendor}</span>
                        </td>
                      ) : null}
                      {applyPrice ? (
                        <td className="py-2 px-2 font-mono">
                          <span className="text-muted-foreground line-through">${money(p?.price)}</span>{' '}
                          <span className="font-medium text-primary">${computeNewPrice(p)}</span>
                        </td>
                      ) : null}
                      {applyQuantity ? (
                        <td className="py-2 pl-2 font-mono">
                          <span className="text-muted-foreground line-through">
                            {p?.inventoryQuantity ?? 0}
                          </span>{' '}
                          <span className="font-medium text-primary">{parseInt(quantity, 10) || 0}</span>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
              <Button variant="outline" onClick={() => setShowPreview(false)}>
                Cancel
              </Button>
              <Button onClick={handleApply}>
                <CheckCircle2 className="mr-2 h-4 w-4" /> Confirm &amp; apply
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      {/* History modal */}
      {showHistory ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden p-0 shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h3 className="font-display text-lg font-semibold">Edit history</h3>
                <p className="text-xs text-muted-foreground">
                  Restore reverts the whole product to its original state (before AI edits).
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setShowHistory(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3">
              {historyLoading ? (
                <div className="flex flex-col items-center justify-center gap-3 py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Loading history…</p>
                </div>
              ) : historyItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                  <History className="h-6 w-6 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No edits recorded yet.</p>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {(() => {
                    // Group all edits by product so each product appears once with a
                    // single "Restore" control that reverts the WHOLE product.
                    const groups: any[] = [];
                    const byId = new Map<string, any>();
                    for (const h of historyItems) {
                      const pid = h?.productId || h?.id;
                      if (!byId.has(pid)) {
                        const g = {
                          productId: pid,
                          productTitle: h?.productTitle,
                          latestAt: h?.createdAt,
                          parts: [] as string[],
                          errors: [] as string[],
                          anyCanUndo: false,
                          anyUndone: false,
                          anySuccess: false,
                        };
                        byId.set(pid, g);
                        groups.push(g);
                      }
                      const g = byId.get(pid);
                      try {
                        const obj = JSON.parse(h?.changes ?? '{}');
                        for (const [k, v] of Object.entries(obj)) {
                          g.parts.push(
                            `${k}: ${Array.isArray(v) ? (v as any[]).join(', ') : String(v)}`,
                          );
                        }
                      } catch {
                        // ignore unparseable change payloads
                      }
                      if (h?.canUndo) g.anyCanUndo = true;
                      if (h?.undone) g.anyUndone = true;
                      if (h?.success) g.anySuccess = true;
                      if (!h?.success && h?.errorMsg) g.errors.push(h.errorMsg);
                    }
                    return groups.map((g) => (
                      <li key={g.productId} className="flex items-start gap-3 py-3">
                        {g.anySuccess ? (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                        ) : (
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {g.productTitle || 'Untitled product'}
                          </p>
                          {g.parts.length > 0 ? (
                            <p className="text-xs text-muted-foreground">
                              {g.parts.slice(0, 8).join(' · ')}
                              {g.parts.length > 8 ? ` · +${g.parts.length - 8} more` : ''}
                            </p>
                          ) : null}
                          {g.errors.length > 0 ? (
                            <p className="text-xs text-destructive">{g.errors[0]}</p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          <span
                            className="text-xs text-muted-foreground"
                            suppressHydrationWarning
                          >
                            {g.latestAt
                              ? new Date(g.latestAt).toLocaleString('en-US', {
                                  dateStyle: 'medium',
                                  timeStyle: 'short',
                                })
                              : ''}
                          </span>
                          {g.anyCanUndo ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 gap-1 px-2 text-xs"
                              title="Restore this product to its original state (before AI edits)"
                              onClick={() => handleUndo(g.productId)}
                              disabled={undoingId === g.productId}
                            >
                              {undoingId === g.productId ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <RotateCcw className="h-3 w-3" />
                              )}
                              Restore
                            </Button>
                          ) : g.anyUndone ? (
                            <Badge variant="secondary" className="gap-1 px-2 py-0.5 text-[11px]">
                              <RotateCcw className="h-3 w-3" /> Restored
                            </Badge>
                          ) : null}
                        </div>
                      </li>
                    ));
                  })()}
                </ul>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
              <Button variant="outline" onClick={() => setShowHistory(false)}>
                Close
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </main>
  );
}
