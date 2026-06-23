"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { 
  LoaderCircle, 
  Trash2, 
  Share2, 
  Download, 
  Copy, 
  Sparkles, 
  Lock,
  Globe,
  Calendar,
  Grid,
  CheckSquare
} from "lucide-react";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuthGuard } from "@/lib/use-auth-guard";
import { fetchUserWorks, deleteUserWork, shareUserWork, type WorkItem } from "@/lib/api";
import { cn } from "@/lib/utils";
import webConfig from "@/constants/common-env";
import { ImageThumbnail } from "@/components/image-thumbnail";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";

const WorkSkeleton = () => (
  <Card className="overflow-hidden rounded-xl border-stone-200/60 bg-white/70 shadow-sm animate-pulse dark:border-stone-800/50 dark:bg-stone-900/60 flex flex-col">
    <div className="relative aspect-square w-full bg-stone-250 dark:bg-stone-850" />
    <CardContent className="p-4 flex-1 flex flex-col justify-between space-y-4">
      <div className="space-y-2.5">
        <div className="h-4 bg-stone-200 dark:bg-stone-800 rounded w-5/6" />
        <div className="h-4 bg-stone-200 dark:bg-stone-800 rounded w-2/3" />
        <div className="flex gap-1.5 pt-1">
          <div className="h-4 bg-stone-200 dark:bg-stone-800 rounded w-12" />
          <div className="h-4 bg-stone-200 dark:bg-stone-800 rounded w-16" />
        </div>
      </div>
      <div className="space-y-3 pt-2 border-t border-stone-100 dark:border-stone-850">
        <div className="h-3 bg-stone-200 dark:bg-stone-805 rounded w-1/3" />
        <div className="flex gap-2">
          <div className="h-8 bg-stone-200 dark:bg-stone-800 rounded flex-1" />
          <div className="h-8 bg-stone-200 dark:bg-stone-800 rounded w-8" />
          <div className="h-8 bg-stone-200 dark:bg-stone-800 rounded w-8" />
        </div>
      </div>
    </CardContent>
  </Card>
);

export default function MyWorksPage() {
  const { isCheckingAuth, session } = useAuthGuard();
  const router = useRouter();
  const [works, setWorks] = useState<WorkItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  
  // Batch Mode State
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDownloading, setIsDownloading] = useState(false);

  const LIMIT = 12;
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const loadWorks = async (reset = false) => {
    const currentOffset = reset ? 0 : offset;
    if (reset) {
      setIsLoading(true);
    } else {
      setIsLoadingMore(true);
    }
    try {
      const res = await fetchUserWorks(LIMIT, currentOffset);
      if (reset) {
        setWorks(res.items || []);
        setOffset(res.items?.length || 0);
      } else {
        setWorks(prev => [...prev, ...(res.items || [])]);
        setOffset(prev => prev + (res.items?.length || 0));
      }
      setHasMore(res.has_more);
    } catch (error) {
      toast.error("加载作品历史失败");
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    if (session) {
      void loadWorks(true);
    }
  }, [session]);

  useEffect(() => {
    if (isLoading || isLoadingMore || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          void loadWorks(false);
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }
    observerRef.current = observer;

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [isLoading, isLoadingMore, hasMore, offset]);

  const handleCopyPrompt = (prompt: string) => {
    navigator.clipboard.writeText(prompt);
    toast.success("提示词已复制到剪贴板");
  };

  const handleToggleShare = async (work: WorkItem) => {
    const nextShareState = !work.is_public;
    try {
      await shareUserWork(work.id, nextShareState);
      setWorks(works.map(w => w.id === work.id ? { ...w, is_public: nextShareState } : w));
      toast.success(nextShareState ? "已成功公开发布到社区画廊！" : "已从社区画廊撤回发布。");
    } catch (error) {
      toast.error("更新分享状态失败");
    }
  };

  const handleDeleteWork = async (workId: string) => {
    try {
      await deleteUserWork(workId);
      setWorks(works.filter(w => w.id !== workId));
      toast.success("作品已成功删除");
      setDeletingId(null);
    } catch (error) {
      toast.error("删除作品失败");
    }
  };

  const getFullImageUrl = (imagePath: string) => {
    if (!imagePath) return "";
    const filesIndex = imagePath.indexOf("/files/");
    if (filesIndex !== -1) {
      const relativePath = imagePath.substring(filesIndex);
      const baseUrl = webConfig.apiUrl.replace(/\/$/, "");
      return `${baseUrl}${relativePath}`;
    }
    if (imagePath.startsWith("http://") || imagePath.startsWith("https://")) {
      return imagePath;
    }
    const baseUrl = webConfig.apiUrl.replace(/\/$/, "");
    return `${baseUrl}${imagePath.startsWith("/") ? "" : "/"}${imagePath}`;
  };

  const handleToggleSelection = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleSelectAll = () => {
    if (selectedIds.size === works.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(works.map((w) => w.id)));
    }
  };

  const handleBulkDownload = async () => {
    if (selectedIds.size === 0) return;
    setIsDownloading(true);
    toast.info("正在打包下载，请稍候...");

    try {
      const zip = new JSZip();
      const selectedWorks = works.filter((w) => selectedIds.has(w.id));
      let counter = 0;

      for (const work of selectedWorks) {
        for (let i = 0; i < work.images.length; i++) {
          const imgUrl = getFullImageUrl(work.images[i]);
          if (!imgUrl) continue;

          try {
            const response = await fetch(imgUrl);
            const blob = await response.blob();
            const ext = blob.type === "image/png" ? "png" : blob.type === "image/jpeg" ? "jpg" : "webp";
            const filename = `work_${work.id.substring(0, 8)}_${i + 1}.${ext}`;
            zip.file(filename, blob);
            counter++;
          } catch (e) {
            console.error("Failed to fetch image", imgUrl, e);
          }
        }
      }

      if (counter > 0) {
        const zipBlob = await zip.generateAsync({ type: "blob" });
        saveAs(zipBlob, `my_works_${Date.now()}.zip`);
        toast.success(`成功下载 ${counter} 张图片！`);
      } else {
        toast.error("没有可下载的图片");
      }
    } catch (e) {
      toast.error("打包下载失败");
    } finally {
      setIsDownloading(false);
      setIsBatchMode(false);
      setSelectedIds(new Set());
    }
  };

  if (isCheckingAuth || !session) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <LoaderCircle className="size-6 animate-spin text-stone-400" />
      </div>
    );
  }

  return (
    <>
    <div className="space-y-6 py-4">
      <section className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <div className="text-xs font-semibold tracking-[0.18em] text-stone-500 uppercase dark:text-stone-400">Library</div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">我的作品</h1>
          <p className="text-sm text-stone-500 dark:text-stone-400">
            查看您在云端生成的所有图片记录。您可将满意的画作一键共享至公共画廊，或者直接下载。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isBatchMode ? (
            <>
              <Button
                variant="outline"
                onClick={handleSelectAll}
                className="rounded-xl bg-white dark:bg-stone-900"
              >
                {selectedIds.size === works.length ? "取消全选" : "全选"}
              </Button>
              <Button
                variant="default"
                onClick={() => void handleBulkDownload()}
                disabled={selectedIds.size === 0 || isDownloading}
                className="rounded-xl bg-stone-950 text-white hover:bg-stone-800"
              >
                {isDownloading ? (
                  <LoaderCircle className="size-4 mr-2 animate-spin" />
                ) : (
                  <Download className="size-4 mr-2" />
                )}
                下载已选 ({selectedIds.size})
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setIsBatchMode(false);
                  setSelectedIds(new Set());
                }}
                className="rounded-xl"
              >
                退出批量
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => setIsBatchMode(true)}
                className="rounded-xl bg-white dark:bg-stone-900"
              >
                <CheckSquare className="size-4 mr-2" />
                批量管理
              </Button>
              <Button 
                onClick={() => router.push("/image")} 
                className="w-full md:w-auto rounded-xl bg-stone-950 text-white hover:bg-stone-850 dark:bg-white dark:text-stone-950 dark:hover:bg-stone-200"
              >
                <Sparkles className="size-4 mr-2" />
                去画图
              </Button>
            </>
          )}
        </div>
      </section>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <WorkSkeleton key={i} />
          ))}
        </div>
      ) : works.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-16 text-center border-dashed rounded-xl">
          <div className="rounded-xl bg-stone-50 p-4 dark:bg-stone-800/40 text-stone-400 dark:text-stone-500 mb-4">
            <Grid className="size-8" />
          </div>
          <h3 className="text-lg font-semibold text-stone-800 dark:text-stone-200">暂无作品记录</h3>
          <p className="text-sm text-stone-500 dark:text-stone-400 mt-1 max-w-sm">
            您还没有生成过任何作品，或者它们仅保存在本地。立即去“画图”页体验吧！
          </p>
          <Button 
            onClick={() => router.push("/image")} 
            variant="outline" 
            className="mt-5 rounded-xl border-stone-200"
          >
            立即生成第一张画作
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {works.map((work) => {
              const firstImg = work.images[0] ? getFullImageUrl(work.images[0]) : "";
              const hasMultiple = work.images.length > 1;

              return (
                <Card 
                  key={work.id} 
                  className={cn(
                    "overflow-hidden rounded-xl border-white/60 bg-white/70 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md dark:border-stone-800/50 dark:bg-stone-900/60 flex flex-col group",
                    isBatchMode && selectedIds.has(work.id) ? "ring-2 ring-stone-950 dark:ring-white" : ""
                  )}
                >
                  <div 
                    className="relative aspect-square w-full overflow-hidden bg-stone-100 dark:bg-stone-950 cursor-pointer" 
                    onClick={() => {
                      if (isBatchMode) {
                        handleToggleSelection(work.id);
                      } else if (firstImg) {
                        setPreviewImage(firstImg);
                      }
                    }}
                  >
                    {isBatchMode && (
                      <div className="absolute left-2 top-2 z-10 flex size-7 items-center justify-center rounded-md bg-white/80 backdrop-blur shadow-sm dark:bg-stone-900/80">
                        <Checkbox 
                          checked={selectedIds.has(work.id)} 
                          onCheckedChange={() => handleToggleSelection(work.id)} 
                        />
                      </div>
                    )}
                    {firstImg ? (
                      <ImageThumbnail 
                        src={firstImg} 
                        alt="作品图片" 
                        className="h-full w-full"
                        imageClassName="transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-stone-400">
                        无图片
                      </div>
                    )}

                    {/* Share badge */}
                    <div className="absolute left-3 top-3">
                      <Badge 
                        variant="secondary" 
                        className={`rounded-lg px-2 py-0.5 text-[10px] font-medium backdrop-blur-md border border-white/10 ${
                          work.is_public 
                            ? "bg-emerald-500/80 text-white hover:bg-emerald-500/80" 
                            : "bg-stone-950/60 text-white/90 hover:bg-stone-950/60"
                        }`}
                      >
                        {work.is_public ? (
                          <>
                            <Globe className="size-3 mr-1" />
                            已公开
                          </>
                        ) : (
                          <>
                            <Lock className="size-3 mr-1" />
                            私有
                          </>
                        )}
                      </Badge>
                    </div>

                    {/* Multiple images indicator */}
                    {hasMultiple && (
                      <div className="absolute right-3 top-3">
                        <Badge variant="secondary" className="rounded-lg px-2 py-0.5 text-[10px] bg-stone-950/60 text-white border-white/10 font-bold backdrop-blur-md">
                          +{work.images.length - 1} 张
                        </Badge>
                      </div>
                    )}
                  </div>

                  <CardContent className="p-4 flex-1 flex flex-col justify-between space-y-4">
                    <div className="space-y-2.5">
                      <p className="line-clamp-3 text-xs leading-5 font-medium text-stone-850 dark:text-stone-200" title={work.prompt}>
                        {work.prompt}
                      </p>
                      
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant="outline" className="text-[10px] rounded-md px-1.5 py-0 border-stone-200 text-stone-500 dark:border-stone-800 dark:text-stone-400">
                          {work.model}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] rounded-md px-1.5 py-0 border-stone-200 text-stone-500 dark:border-stone-800 dark:text-stone-400">
                          {work.size}
                        </Badge>
                      </div>
                    </div>

                    <div className="space-y-3 pt-2 border-t border-stone-100 dark:border-stone-850">
                      <div className="flex items-center justify-between text-[11px] text-stone-400">
                        <span className="flex items-center">
                          <Calendar className="size-3.5 mr-1" />
                          {work.created_at.split(" ")[0]}
                        </span>
                        {work.likes > 0 && (
                          <span className="font-semibold text-rose-500">
                            ❤️ {work.likes} 个赞
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="secondary"
                          className="flex-1 rounded-lg text-xs h-8 px-2"
                          onClick={() => router.push(`/image?prompt=${encodeURIComponent(work.prompt)}&model=${encodeURIComponent(work.model)}&size=${encodeURIComponent(work.size)}&quality=${encodeURIComponent(work.quality)}`)}
                        >
                          <Sparkles className="size-3 mr-1 text-amber-500" />
                          同款生成
                        </Button>

                        <Button
                          size="icon"
                          variant="ghost"
                          className="rounded-lg size-8 text-stone-500 hover:text-stone-900 dark:hover:text-white"
                          onClick={() => handleCopyPrompt(work.prompt)}
                          title="复制提示词"
                        >
                          <Copy className="size-3.5" />
                        </Button>

                        {firstImg && (
                          <a 
                            href={firstImg}
                            download={`ai-art-${work.id}.png`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center rounded-lg size-8 text-stone-500 hover:text-stone-900 dark:hover:text-white hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
                            title="在新窗口查看/下载"
                          >
                            <Download className="size-3.5" />
                          </a>
                        )}

                        <Button
                          size="icon"
                          variant="ghost"
                          className={`rounded-lg size-8 ${work.is_public ? "text-emerald-600 hover:text-emerald-700" : "text-stone-500 hover:text-stone-900"}`}
                          onClick={() => void handleToggleShare(work)}
                          title={work.is_public ? "撤销公开分享" : "发布到社区画廊"}
                        >
                          <Share2 className="size-3.5" />
                        </Button>

                        {deletingId === work.id ? (
                          <div className="flex items-center gap-1 animate-in fade-in zoom-in-95 duration-150">
                            <Button
                              size="sm"
                              variant="destructive"
                              className="rounded-lg h-8 px-2 text-[10px]"
                              onClick={() => void handleDeleteWork(work.id)}
                            >
                              确定
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="rounded-lg h-8 px-2 text-[10px]"
                              onClick={() => setDeletingId(null)}
                            >
                              取消
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="rounded-lg size-8 text-stone-400 hover:text-red-500"
                            onClick={() => setDeletingId(work.id)}
                            title="删除作品"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {isLoadingMore && Array.from({ length: 4 }).map((_, i) => (
              <WorkSkeleton key={`skeleton-${i}`} />
            ))}
          </div>

          {/* Sentinel element for infinite scroll */}
          <div ref={loadMoreRef} className="py-8 flex justify-center w-full">
            {!isLoadingMore && hasMore && (
              <Button
                variant="outline"
                onClick={() => void loadWorks(false)}
                className="rounded-xl border-stone-200 text-xs px-4"
              >
                点击加载更多
              </Button>
            )}
            {!isLoadingMore && !hasMore && works.length > 0 && (
              <div className="text-stone-400 text-xs py-2">已加载全部作品</div>
            )}
          </div>
        </div>
      )}
    </div>

      <Dialog open={!!previewImage} onOpenChange={(open) => { if (!open) setPreviewImage(null); }}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 border-0 bg-transparent shadow-none [&>button]:text-white [&>button]:hover:text-white/80">
          <div className="flex items-center justify-center">
            {previewImage && (
              <img
                src={previewImage}
                alt="预览"
                className="max-w-full max-h-[90vh] object-contain rounded-lg"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
