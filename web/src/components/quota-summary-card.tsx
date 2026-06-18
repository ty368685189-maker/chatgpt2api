"use client";

import { CalendarDays, Coins, Sparkles } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type QuotaSummaryProfile = {
  quota_mode?: "daily" | "fixed" | "hybrid";
  quota_limit?: number;
  quota_used?: number;
  quota_remaining?: number;
  quota_usage_rate?: number;
  daily_quota_limit?: number;
  daily_quota_used?: number;
  daily_quota_remaining?: number;
  fixed_quota_limit?: number;
  fixed_quota_used?: number;
  fixed_quota_remaining?: number;
  quota_summary?: string;
  is_legacy?: boolean;
};

type QuotaMode = "daily" | "fixed" | "hybrid";

type QuotaSummaryCardProps = {
  profile: QuotaSummaryProfile | null;
  className?: string;
  compact?: boolean;
};

function formatQuotaValue(used: number, limit?: number) {
  if (typeof limit !== "number" || limit <= 0) {
    return "不限";
  }
  return `${used}/${limit}`;
}

function formatRemaining(limit?: number, remaining?: number) {
  if (typeof limit !== "number" || limit <= 0) {
    return "不限";
  }
  return String(Math.max(0, Number(remaining ?? 0)));
}

function getModeLabel(mode: QuotaMode) {
  if (mode === "fixed") {
    return "固定额度";
  }
  if (mode === "hybrid") {
    return "每日优先";
  }
  return "每日额度";
}

export function QuotaSummaryCard({ profile, className, compact = false }: QuotaSummaryCardProps) {
  if (!profile || profile.is_legacy) {
    return null;
  }

  const mode = profile.quota_mode || "daily";
  const modeLabel = getModeLabel(mode);
  const dailyLabel = formatQuotaValue(Number(profile.daily_quota_used || 0), profile.daily_quota_limit);
  const fixedLabel = formatQuotaValue(Number(profile.fixed_quota_used || 0), profile.fixed_quota_limit);
  const activeLimit =
    mode === "fixed"
      ? profile.fixed_quota_limit
      : mode === "hybrid"
        ? profile.quota_limit
        : profile.daily_quota_limit;
  const activeUsed =
    mode === "fixed"
      ? profile.fixed_quota_used
      : mode === "hybrid"
        ? profile.quota_used
        : profile.daily_quota_used;
  const activeRemaining =
    mode === "fixed"
      ? profile.fixed_quota_remaining
      : mode === "hybrid"
        ? profile.quota_remaining
        : profile.daily_quota_remaining;
  const activeRate = typeof profile.quota_usage_rate === "number" ? profile.quota_usage_rate : 0;
  const activeRemainingText = formatRemaining(activeLimit, activeRemaining);

  return (
    <Card className={cn("overflow-hidden border-stone-200/80 bg-white/95 shadow-[0_18px_54px_-34px_rgba(28,25,23,0.28)] dark:border-stone-800/80 dark:bg-stone-950/90", className)}>
      <CardHeader className={cn("gap-2", compact ? "p-4 pb-3" : "p-5 pb-3")}>
        <div className="flex items-center gap-2">
          <div className="inline-flex size-9 items-center justify-center rounded-2xl bg-stone-950 text-white dark:bg-stone-100 dark:text-stone-950">
            <Sparkles className="size-4" />
          </div>
          <div className="min-w-0">
            <CardTitle className={cn("text-base font-semibold text-stone-950 dark:text-stone-100", compact ? "text-[15px]" : "text-base")}>
              我的生图额度
            </CardTitle>
            <CardDescription className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
              {modeLabel}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className={cn(compact ? "px-4 pb-4" : "px-5 pb-5")}>
        <div className="relative overflow-hidden rounded-[28px] bg-stone-950 px-4 py-4 text-white shadow-[0_18px_42px_-28px_rgba(0,0,0,0.6)] dark:bg-stone-900 sm:px-5 sm:py-5">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.12),transparent_38%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.06),transparent_36%)] dark:bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.08),transparent_38%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.04),transparent_36%)]" />
          <div className="relative flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.22em] text-white/55 dark:text-stone-300">
                当前剩余
              </div>
              <div className="mt-2 flex items-end gap-2">
                <div className={cn("font-semibold tracking-tight", compact ? "text-[40px] leading-none" : "text-[52px] leading-none")}>
                  {activeRemainingText}
                </div>
                <div className="pb-1 text-sm font-medium text-white/70 dark:text-stone-300">张</div>
              </div>
            </div>
            <div className="shrink-0 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-medium text-white backdrop-blur dark:border-stone-200/20 dark:bg-white/5 dark:text-stone-100">
              {modeLabel}
            </div>
          </div>
          <div className="relative mt-4 h-1.5 overflow-hidden rounded-full bg-white/12 dark:bg-white/10">
            <div
              className="h-full rounded-full bg-white/90 transition-all dark:bg-white/80"
              style={{ width: `${Math.min(100, Math.max(0, Math.round(activeRate * 100)))}%` }}
            />
          </div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-stone-50 px-3 py-3 dark:bg-stone-900">
            <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
              <CalendarDays className="size-3.5" />
              今日额度
            </div>
            <div className="mt-2 text-lg font-semibold text-stone-950 dark:text-stone-100">{dailyLabel}</div>
          </div>
          <div className="rounded-2xl bg-stone-50 px-3 py-3 dark:bg-stone-900">
            <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
              <Coins className="size-3.5" />
              固定额度
            </div>
            <div className="mt-2 text-lg font-semibold text-stone-950 dark:text-stone-100">{fixedLabel}</div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl bg-stone-50 px-3 py-3 text-sm text-stone-600 dark:bg-stone-900 dark:text-stone-300">
          <span>正在使用：{activeUsed ?? 0}/{activeLimit && activeLimit > 0 ? activeLimit : "不限"}</span>
          <span>已用比例：{Math.round(activeRate * 100)}%</span>
          <span>模式：{modeLabel}</span>
          {profile.quota_summary ? <span className="text-stone-500 dark:text-stone-400">{profile.quota_summary}</span> : null}
          </div>
      </CardContent>
    </Card>
  );
}
