"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, ArrowLeft } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { QuotaSummaryCard, type QuotaSummaryProfile } from "@/components/quota-summary-card";
import { useAuthGuard } from "@/lib/use-auth-guard";
import { fetchUserProfile } from "@/lib/api";

export default function QuotaPage() {
  const { isCheckingAuth, session } = useAuthGuard();
  const [profile, setProfile] = useState<QuotaSummaryProfile | null>(null);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      return;
    }
    let active = true;
    fetchUserProfile()
      .then((data) => {
        if (active) {
          setProfile(data);
        }
      })
      .catch(() => {
        if (active) {
          setProfile(null);
        }
      });
    return () => {
      active = false;
    };
  }, [session]);

  if (isCheckingAuth || !session) {
    return (
      <div className="flex min-h-[45vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1200px] flex-col gap-5 px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-stone-950 dark:text-white sm:text-3xl">
            我的生图额度
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-stone-500 dark:text-stone-400">
            这里只看额度，不放别的说明。
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" className="rounded-xl border-stone-200 bg-white/90 dark:border-stone-800 dark:bg-stone-950/80">
            <Link href="/image">
              <ArrowLeft className="size-4" />
              回到画图
            </Link>
          </Button>
        </div>
      </div>

      <QuotaSummaryCard profile={profile} />

      <Card className="rounded-[28px] border-stone-200/80 bg-stone-950 text-white shadow-[0_22px_70px_-36px_rgba(0,0,0,0.55)] dark:border-stone-800/80 dark:bg-stone-900 dark:text-white">
        <CardContent className="flex flex-col gap-3 p-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-xs font-medium uppercase tracking-[0.2em] text-stone-400 dark:text-stone-400">还能再生成</div>
            <div className="mt-2 text-4xl font-semibold tracking-tight">
              {profile?.quota_remaining != null ? profile.quota_remaining : "—"}
            </div>
            <div className="mt-1 text-sm text-stone-300 dark:text-stone-300">张</div>
          </div>
          <div className="max-w-xl text-sm leading-6 text-stone-300 dark:text-stone-300">
            系统会自动先扣每日额度，再扣固定额度。
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
