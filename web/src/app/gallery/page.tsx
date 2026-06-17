"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { 
  LoaderCircle, 
  Heart, 
  Copy, 
  Sparkles, 
  Search,
  Grid,
  Calendar,
  Flame,
  Download
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { fetchGallery, likeGalleryWork, type WorkItem } from "@/lib/api";
import webConfig from "@/constants/common-env";
import { ImageThumbnail } from "@/components/image-thumbnail";

const WorkSkeleton = () => (
  <Card className="overflow-hidden rounded-2xl border-stone-200/60 bg-white/70 shadow-sm animate-pulse dark:border-stone-800/50 dark:bg-stone-900/60 flex flex-col">
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

export default function GalleryPage() {
  const router = useRouter();
  const [works, setWorks] = useState<WorkItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const LIMIT = 12;
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const loadGallery = async (query = searchQuery, reset = false) => {
    const currentOffset = reset ? 0 : offset;
    if (reset) {
      setIsLoading(true);
    } else {
      setIsLoadingMore(true);
    }

    try {
      const res = await fetchGallery(query, LIMIT, currentOffset);
      if (reset) {
        setWorks(res.items || []);
        setOffset(res.items?.length || 0);
      } else {
        setWorks(prev => [...prev, ...(res.items || [])]);
        setOffset(prev => prev + (res.items?.length || 0));
      }
      setHasMore(res.has_more);
    } catch (error) {
      toast.error("加载社区画廊失败");
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    void loadGallery("", true);
  }, []);

  useEffect(() => {
    if (isLoading || isLoadingMore || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          void loadGallery(searchQuery, false);
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
  }, [isLoading, isLoadingMore, hasMore, offset, searchQuery]);

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const val = event.target.value;
    setSearchQuery(val);

    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    searchDebounceRef.current = setTimeout(() => {
      void loadGallery(val, true);
    }, 500);
  };

  const handleLike = async (workId: string) => {
    try {
      const res = await likeGalleryWork(workId);
      setWorks(works.map(w => w.id === workId ? { ...w, likes: res.likes } : w));
      toast.success("已点赞！谢谢您的支持。");
    } catch (error) {
      toast.error("点赞失败，请稍后重试");
    }
  };

  const handleCopyPrompt = (prompt: string) => {
    navigator.clipboard.writeText(prompt);
    toast.success("提示词已复制到剪贴板");
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

  return (
    <div className="space-y-6 py-4">
      <section className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <div className="text-xs font-semibold tracking-[0.18em] text-stone-500 uppercase dark:text-stone-400">Showcase</div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl flex items-center gap-2">
            社区画廊
            <Flame className="size-5 text-amber-500 fill-amber-500" />
          </h1>
          <p className="text-sm text-stone-500 dark:text-stone-400">
            浏览由社区成员公开分享的精美 AI 画作。支持复制提示词、一键生成同款作品。
          </p>
        </div>

        <div className="relative w-full md:max-w-xs">
          <Search className="absolute left-3 top-3 size-4.5 text-stone-400" />
          <Input
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder="搜索画作提示词..."
            className="h-11 rounded-xl border-stone-200 bg-white/80 pl-10 pr-4 dark:border-stone-800 dark:bg-stone-900/80"
          />
        </div>
      </section>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <WorkSkeleton key={i} />
          ))}
        </div>
      ) : works.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-16 text-center border-dashed rounded-2xl">
          <div className="rounded-2xl bg-stone-50 p-4 dark:bg-stone-850 text-stone-400 dark:text-stone-500 mb-4">
            <Grid className="size-8" />
          </div>
          <h3 className="text-lg font-semibold text-stone-800 dark:text-stone-200">未找到相关画作</h3>
          <p className="text-sm text-stone-500 dark:text-stone-400 mt-1 max-w-sm">
            目前还没有公开的作品，或者没有符合您搜索关键词的画作。
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {works.map((work) => {
              const firstImg = work.images[0] ? getFullImageUrl(work.images[0]) : "";

              return (
                <Card 
                  key={work.id} 
                  className="overflow-hidden rounded-2xl border-white/60 bg-white/70 shadow-sm transition-all duration-300 hover:shadow-md dark:border-stone-800/50 dark:bg-stone-900/60 flex flex-col group"
                >
                  <div className="relative aspect-square w-full overflow-hidden bg-stone-100 dark:bg-stone-950">
                    {firstImg ? (
                      <ImageThumbnail 
                        src={firstImg} 
                        alt={work.prompt} 
                        className="h-full w-full"
                        imageClassName="transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-stone-400">
                        无图片
                      </div>
                    )}

                    {/* Likes badge floating */}
                    {work.likes > 0 && (
                      <div className="absolute left-3 top-3">
                        <Badge variant="secondary" className="rounded-lg px-2 py-0.5 text-[10px] bg-rose-500/85 hover:bg-rose-500/85 text-white border-none font-semibold backdrop-blur-md">
                          ❤️ {work.likes}
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
                          className="rounded-lg size-8 text-stone-400 hover:text-rose-500"
                          onClick={() => void handleLike(work.id)}
                          title="给作品点赞"
                        >
                          <Heart className="size-3.5 hover:fill-rose-500 text-rose-500" />
                        </Button>
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
                onClick={() => void loadGallery(searchQuery, false)}
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
  );
}
