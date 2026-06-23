"use client";

import { memo, useEffect, useRef, useState } from "react";
import {
  Clock3,
  Download,
  EyeOff,
  LoaderCircle,
  RotateCcw,
  Sparkles,
  Trash2,
  SquareStop,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { getImageThumbnailUrl } from "@/components/image-thumbnail";
import { cn } from "@/lib/utils";
import type {
  ImageConversation,
  ImageTurnStatus,
  StoredImage,
  StoredReferenceImage,
} from "@/store/image-conversations";
import webConfig from "@/constants/common-env";

export type ImageLightboxItem = {
  id: string;
  src: string;
  sizeLabel?: string;
  dimensions?: string;
};

type ImageResultsProps = {
  selectedConversation: ImageConversation | null;
  onOpenLightbox: (images: ImageLightboxItem[], index: number) => void;
  onContinueEdit: (
    conversationId: string,
    image: StoredImage | StoredReferenceImage,
  ) => void;
  onDeletePrompt: (conversationId: string, turnId: string) => void;
  onDeleteResults: (conversationId: string, turnId: string) => void;
  onReuseTurnConfig: (
    conversationId: string,
    turnId: string,
  ) => void | Promise<void>;
  onRegenerateTurn: (
    conversationId: string,
    turnId: string,
  ) => void | Promise<void>;
  onRetryImage: (
    conversationId: string,
    turnId: string,
    imageId: string,
  ) => void | Promise<void>;
  onCancelImage: (
    conversationId: string,
    taskId: string,
  ) => void | Promise<void>;
  isCancellingTask?: (taskId: string) => boolean;
  onTimeoutRetryContinue: (taskId: string) => void | Promise<void>;
  onDismissErrors: (
    conversationId: string,
    turnId: string,
  ) => void | Promise<void>;
  formatConversationTime: (value: string) => string;
};

// Blob URL 缓存：避免 base64 超长字符串在 DOM 中，改用短小的 blob: URL
const b64BlobUrlCache = new Map<string, string>();

const zipCrcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[index] = crc >>> 0;
  }
  return table;
})();

function createZipBytePart(value: number, size: 2 | 4) {
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) {
    bytes[index] = (value >>> (8 * index)) & 0xff;
  }
  return bytes;
}

function concatBytes(...parts: Uint8Array[]) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

function getZipDateParts(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time:
      ((date.getHours() & 0x1f) << 11) |
      ((date.getMinutes() & 0x3f) << 5) |
      Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = zipCrcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (~crc) >>> 0;
}

async function getStoredImageBlob(image: StoredImage) {
  if (image.b64_json) {
    const binary = atob(image.b64_json);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: "image/png" });
  }

  if (!image.url) {
    throw new Error("图片地址为空");
  }

  let targetUrl = image.url;
  const filesIndex = image.url.indexOf("/files/");
  if (filesIndex !== -1) {
    const relativePath = image.url.substring(filesIndex);
    const baseUrl = webConfig.apiUrl.replace(/\/$/, "");
    targetUrl = `${baseUrl}${relativePath}`;
  } else if (!image.url.startsWith("http")) {
    targetUrl = `${window.location.origin}${image.url}`;
  }

  const res = await fetch(targetUrl);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return res.blob();
}

async function buildZipBlob(
  files: Array<{ name: string; blob: Blob }>,
): Promise<Blob> {
  const encoder = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;
  const { time, date } = getZipDateParts();

  for (const file of files) {
    const fileNameBytes = encoder.encode(file.name);
    const fileBytes = new Uint8Array(await file.blob.arrayBuffer());
    const crc = crc32(fileBytes);

    const localHeader = concatBytes(
      createZipBytePart(0x04034b50, 4),
      createZipBytePart(20, 2),
      createZipBytePart(0x0800, 2),
      createZipBytePart(0, 2),
      createZipBytePart(time, 2),
      createZipBytePart(date, 2),
      createZipBytePart(crc, 4),
      createZipBytePart(fileBytes.length, 4),
      createZipBytePart(fileBytes.length, 4),
      createZipBytePart(fileNameBytes.length, 2),
      createZipBytePart(0, 2),
      fileNameBytes,
    );
    localChunks.push(localHeader, fileBytes);

    const centralHeader = concatBytes(
      createZipBytePart(0x02014b50, 4),
      createZipBytePart(20, 2),
      createZipBytePart(20, 2),
      createZipBytePart(0x0800, 2),
      createZipBytePart(0, 2),
      createZipBytePart(time, 2),
      createZipBytePart(date, 2),
      createZipBytePart(crc, 4),
      createZipBytePart(fileBytes.length, 4),
      createZipBytePart(fileBytes.length, 4),
      createZipBytePart(fileNameBytes.length, 2),
      createZipBytePart(0, 2),
      createZipBytePart(0, 2),
      createZipBytePart(0, 2),
      createZipBytePart(0, 2),
      createZipBytePart(0, 4),
      createZipBytePart(offset, 4),
      fileNameBytes,
    );
    centralChunks.push(centralHeader);
    offset += localHeader.length + fileBytes.length;
  }

  const centralDirectory = concatBytes(...centralChunks);
  const endOfCentralDirectory = concatBytes(
    createZipBytePart(0x06054b50, 4),
    createZipBytePart(0, 2),
    createZipBytePart(0, 2),
    createZipBytePart(files.length, 2),
    createZipBytePart(files.length, 2),
    createZipBytePart(centralDirectory.length, 4),
    createZipBytePart(offset, 4),
    createZipBytePart(0, 2),
  );

  return new Blob([...localChunks, centralDirectory, endOfCentralDirectory] as BlobPart[], {
    type: "application/zip",
  });
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadStoredImage(image: StoredImage, fileName: string) {
  try {
    const blob = await getStoredImageBlob(image);
    triggerDownload(blob, fileName);
  } catch (err) {
    console.error("Failed to download image:", err);
    if (image.url) {
      window.open(image.url, "_blank");
    }
  }
}

async function downloadImageBatch(
  images: StoredImage[],
  filePrefix: string,
) {
  const files: Array<{ name: string; blob: Blob }> = [];
  let failedCount = 0;

  for (let index = 0; index < images.length; index += 1) {
    try {
      const blob = await getStoredImageBlob(images[index]);
      files.push({
        name: `${filePrefix}-${String(index + 1).padStart(2, "0")}.png`,
        blob,
      });
    } catch (err) {
      failedCount += 1;
      console.error("Failed to prepare batch image:", err);
    }
  }

  if (files.length === 0) {
    throw new Error("没有可下载的图片");
  }

  const zipBlob = await buildZipBlob(files);
  triggerDownload(zipBlob, `${filePrefix}.zip`);
  return {
    downloadedCount: files.length,
    failedCount,
  };
}

function getStoredImageSrc(image: StoredImage) {
  if (image.b64_json) {
    let url = b64BlobUrlCache.get(image.b64_json);
    if (!url) {
      const binary = atob(image.b64_json);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: "image/png" });
      url = URL.createObjectURL(blob);
      b64BlobUrlCache.set(image.b64_json, url);
    }
    return url;
  }
  return image.url || "";
}

export function ImageResults({
  selectedConversation,
  onOpenLightbox,
  onContinueEdit,
  onDeletePrompt,
  onDeleteResults,
  onReuseTurnConfig,
  onRegenerateTurn,
  onRetryImage,
  onCancelImage,
  isCancellingTask,
  onTimeoutRetryContinue,
  onDismissErrors,
  formatConversationTime,
}: ImageResultsProps) {
  const [imageDimensions, setImageDimensions] = useState<Record<string, string>>({});
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [downloadingTurnId, setDownloadingTurnId] = useState<string | null>(
    null,
  );

  // 仅在存在 loading 图片时启动定时器，避免空闲时无谓重渲染
  const hasLoadingImages = selectedConversation?.turns.some(
    (turn) =>
      !turn.resultsDeleted &&
      turn.images.some((image) => image.status === "loading"),
  );
  useEffect(() => {
    if (!hasLoadingImages) return;
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 500);
    return () => clearInterval(timer);
  }, [hasLoadingImages]);

  const updateImageDimensions = (id: string, width: number, height: number) => {
    const dimensions = formatImageDimensions(width, height);
    if (imageDimensions[id] !== dimensions) {
      setImageDimensions((prev) => ({
        ...prev,
        [id]: dimensions,
      }));
    }
  };

  if (!selectedConversation) {
    return (
      <div className="flex min-h-[88px] items-start justify-center pt-3 text-center sm:min-h-[220px] sm:items-center sm:pt-0">
        <div className="max-w-2xl px-4">
          <h1
            className="text-[18px] font-semibold tracking-tight text-stone-950 sm:text-2xl md:text-[38px]"
            style={{
              fontFamily:
                '"Palatino Linotype","Book Antiqua","URW Palladio L","Times New Roman",serif',
            }}
          >
            先输入一句想法
          </h1>
          <p
            className="mx-auto mt-1.5 max-w-[240px] text-[10px] leading-5 italic tracking-[0.01em] text-stone-500 sm:mt-3 sm:max-w-none sm:text-sm sm:leading-6"
            style={{
              fontFamily:
                '"Palatino Linotype","Book Antiqua","URW Palladio L","Times New Roman",serif',
            }}
          >
            先发起一轮生成，再继续改图、重试或复用配置。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[980px] flex-col gap-2 sm:gap-8">
      {selectedConversation.turns.map((turn, turnIndex) => {
        const referenceLightboxImages = turn.referenceImages.map(
          (image, index) => ({
            id: `${turn.id}-reference-${index}`,
            src: image.dataUrl,
          }),
        );
        const successfulTurnImages = turn.images.flatMap((image) => {
          const src =
            image.status === "success" ? getStoredImageSrc(image) : "";
          return src
            ? [
                {
                  id: image.id,
                  src,
                  sizeLabel: image.b64_json
                    ? formatBase64ImageSize(image.b64_json)
                    : undefined,
                  dimensions: imageDimensions[image.id],
                },
              ]
            : [];
        });
        const downloadableTurnImages = turn.images.filter(
          (image): image is StoredImage => image.status === "success",
        );
        const isDownloadingTurn = downloadingTurnId === turn.id;

        return (
          <div key={turn.id} className="flex flex-col gap-3 sm:gap-6">
            {!turn.promptDeleted ? (
              <div className="flex justify-end items-start gap-2.5">
                <div className="flex max-w-[85%] flex-col items-end sm:max-w-[75%]">
                  <div className="mb-1 hidden flex-wrap justify-end gap-2 text-[10px] text-stone-400 dark:text-stone-500 sm:flex sm:mb-1.5">
                    <span>第 {turnIndex + 1} 轮</span>
                    <span>{turn.mode === "edit" ? "编辑图" : "文生图"}</span>
                    <span>{getTurnStatusLabel(turn.status)}</span>
                    <span>{formatConversationTime(turn.createdAt)}</span>
                  </div>
                  <div className="rounded-2xl rounded-tr-none bg-stone-900 dark:bg-stone-850 px-4 py-2.5 text-[13px] leading-relaxed text-stone-50 shadow-md sm:px-5 sm:py-3 sm:text-[14px]">
                    {turn.prompt}
                  </div>
                  <div className="mt-1 flex flex-wrap justify-end gap-1.5 sm:mt-2">
                    <button
                      type="button"
                      onClick={() =>
                        void onReuseTurnConfig(selectedConversation.id, turn.id)
                      }
                      className="inline-flex items-center gap-1 rounded-full bg-stone-100 dark:bg-stone-800 px-2.5 py-0.5 text-[8px] font-medium text-stone-600 dark:text-stone-300 transition hover:bg-stone-200 dark:hover:bg-stone-700 hover:text-stone-900 dark:hover:text-stone-100 sm:text-[10px]"
                    >
                      复用配置
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onDeletePrompt(selectedConversation.id, turn.id)
                      }
                      className="inline-flex size-5 items-center justify-center rounded-full text-stone-300 transition hover:bg-rose-50 hover:text-rose-500 dark:text-stone-600 dark:hover:bg-rose-950/30"
                      aria-label="删除提示词记录"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>
                {/* 用户头像 */}
                <div className="flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full bg-stone-200 dark:bg-stone-700 text-stone-700 dark:text-stone-300 text-xs font-bold shadow-sm sm:h-9 sm:w-9">
                  宇
                </div>
              </div>
            ) : null}

            {!turn.resultsDeleted ? (
              <div className="flex justify-start items-start gap-2.5">
                {/* AI 助手头像 */}
                <div className="flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full bg-gradient-to-tr from-violet-600 to-indigo-600 text-white shadow-md shadow-indigo-100 dark:shadow-none sm:h-9 sm:w-9">
                  <Sparkles className="size-4 animate-pulse" />
                </div>

                {/* AI 消息卡片：毛玻璃与气泡样式 */}
                <div className="flex-1 rounded-2xl rounded-tl-none border border-stone-200/60 dark:border-stone-800/50 bg-white/70 dark:bg-stone-900/60 backdrop-blur-md p-3.5 sm:p-5 shadow-sm max-w-[90%] sm:max-w-[85%]">
                  
                  {/* 状态指示栏 */}
                  <div className="mb-3.5 flex flex-wrap items-center gap-2 text-[10px] text-stone-500 dark:text-stone-400">
                    <span className="inline-flex items-center rounded-full bg-stone-100 dark:bg-stone-800 px-2 py-0.5 font-medium text-stone-600 dark:text-stone-300">
                      {turn.count} 张图片
                    </span>
                    <span className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 font-medium",
                      turn.status === "success" && "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400",
                      turn.status === "generating" && "bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400",
                      turn.status === "queued" && "bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400",
                      turn.status === "error" && "bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400"
                    )}>
                      {getTurnStatusLabel(turn.status)}
                    </span>
                    {turn.status === "queued" ? (
                      <span className="text-[9px] text-amber-600 dark:text-amber-400">
                        等待当前队列排队完成
                      </span>
                    ) : null}
                  </div>

                  {/* 参考图区域 */}
                  {turn.referenceImages.length > 0 ? (
                    <div className="mb-4 rounded-xl border border-stone-200/40 dark:border-stone-800/40 bg-stone-50/50 dark:bg-stone-950/30 p-2.5">
                      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                        本轮参考图
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {turn.referenceImages.map((image, index) => (
                          <div
                            key={`${turn.id}-${image.name}-${index}`}
                            className="relative flex flex-col items-center gap-1.5"
                          >
                            <button
                              type="button"
                              onClick={() =>
                                onOpenLightbox(referenceLightboxImages, index)
                              }
                              className="group relative h-14 w-14 overflow-hidden rounded-lg border border-stone-200/80 dark:border-stone-800/85 bg-stone-100/60 dark:bg-stone-900/60 text-left transition hover:border-stone-300 sm:h-16 sm:w-16"
                              aria-label={`预览参考图 ${image.name || index + 1}`}
                            >
                              <img
                                src={image.dataUrl}
                                alt={image.name || `参考图 ${index + 1}`}
                                className="absolute inset-0 h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
                              />
                            </button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 rounded-full border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-2.5 text-[9px] text-stone-700 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800"
                              onClick={() =>
                                onContinueEdit(selectedConversation.id, image)
                              }
                            >
                              <Sparkles className="size-3" />
                              <span>加入编辑</span>
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {/* 图片展示与骨架屏 */}
                  <div className="grid grid-cols-1 gap-2.5 sm:block sm:columns-2 sm:gap-4 sm:space-y-4 xl:columns-3">
                    {turn.images.map((image, index) => {
                      const imageSrc =
                        image.status === "success"
                          ? getStoredImageSrc(image)
                          : "";
                      if (image.status === "success" && imageSrc) {
                        const currentIndex = successfulTurnImages.findIndex(
                          (item) => item.id === image.id,
                        );
                        const sizeLabel = image.b64_json
                          ? formatBase64ImageSize(image.b64_json)
                          : "";
                        const dimensions = imageDimensions[image.id];
                        const imageMeta = [sizeLabel, dimensions]
                          .filter(Boolean)
                          .join(" · ");

                        return (
                          <div key={image.id} className="break-inside-avoid">
                            <LazyImage
                              src={getImageThumbnailUrl(imageSrc)}
                              fullSrc={imageSrc}
                              alt={`Generated result ${index + 1}`}
                              className={cn(
                                "group block w-full cursor-zoom-in overflow-hidden rounded-lg sm:rounded-xl",
                                getTurnAspectClass(turn.ratio),
                              )}
                              onLoad={(event) => {
                                updateImageDimensions(
                                  image.id,
                                  event.currentTarget.naturalWidth,
                                  event.currentTarget.naturalHeight,
                                );
                              }}
                              onOpen={() =>
                                onOpenLightbox(
                                  successfulTurnImages,
                                  currentIndex,
                                )
                              }
                            />
                            <div className="flex flex-col gap-0.5 px-0.5 py-0.5 text-[8px] sm:flex-row sm:items-center sm:justify-between sm:gap-2 sm:px-3 sm:py-2 sm:text-xs">
                              <div className="min-w-0 text-stone-500">
                                <span>结果 {index + 1}</span>
                                {image.durationMs != null ? (
                                  <span className="hidden text-stone-400 sm:ml-2 sm:inline">
                                    {formatDuration(image.durationMs)}
                                  </span>
                                ) : null}
                                {imageMeta ? (
                                  <span className="hidden text-stone-400 sm:block">
                                    {imageMeta}
                                  </span>
                                ) : null}
                              </div>
                              <div className="flex items-center gap-0.5">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-6 w-6 rounded-full border-stone-200 dark:border-stone-850 bg-white dark:bg-stone-900 px-0 text-[9px] text-stone-700 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800 sm:h-8 sm:w-fit sm:px-3 sm:text-xs"
                                  onClick={() =>
                                    onContinueEdit(
                                      selectedConversation.id,
                                      image,
                                    )
                                  }
                                  aria-label="加入编辑"
                                >
                                  <Sparkles className="size-3" />
                                  <span className="hidden sm:inline">
                                    加入编辑
                                  </span>
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-6 w-6 rounded-full border-stone-200 dark:border-stone-850 bg-white dark:bg-stone-900 px-0 text-[9px] text-stone-700 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800 sm:h-8 sm:w-fit sm:px-3 sm:text-xs"
                                  onClick={() =>
                                    void downloadStoredImage(
                                      image,
                                      `turn-${turnIndex + 1}-image-${
                                        index + 1
                                      }.png`,
                                    )
                                  }
                                  aria-label="下载"
                                >
                                  <Download className="size-3" />
                                  <span className="hidden sm:inline">下载</span>
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      if (image.status === "error") {
                        const isTimeoutError =
                          image.error?.includes("超时") && image.taskId;
                        return (
                          <div key={image.id} className="break-inside-avoid">
                            <div
                              className={cn(
                                "overflow-hidden rounded-lg border border-rose-200 dark:border-rose-950 bg-rose-50 dark:bg-rose-950/20 sm:rounded-xl",
                                getTurnAspectClass(turn.ratio),
                              )}
                            >
                              <div className="flex h-full min-h-16 flex-col items-center justify-center gap-1 px-2 py-2 text-center text-[10px] leading-4 text-rose-600 dark:text-rose-400 sm:gap-3 sm:px-6 sm:py-8 sm:text-sm sm:leading-6">
                                <p className="font-medium">
                                  图片 {index + 1}/{turn.images.length}
                                </p>
                                <span className="line-clamp-2 sm:line-clamp-none text-stone-500 dark:text-stone-400">
                                  {image.error || "生成失败"}
                                </span>
                                <div className="flex flex-wrap items-center justify-center gap-1.5">
                                  {isTimeoutError && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void onTimeoutRetryContinue(
                                          image.taskId!,
                                        )
                                      }
                                      className="rounded-full bg-emerald-100 dark:bg-emerald-950 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 shadow-sm transition hover:bg-emerald-200 dark:hover:bg-emerald-900 sm:px-3 sm:text-xs"
                                    >
                                      继续等待
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void onRetryImage(
                                        selectedConversation.id,
                                        turn.id,
                                        image.id,
                                      )
                                    }
                                    className="rounded-full bg-white dark:bg-stone-900 px-2 py-0.5 text-[10px] font-medium text-rose-600 dark:text-rose-400 shadow-sm transition hover:bg-rose-100 dark:hover:bg-rose-950/50 sm:px-3 sm:text-xs"
                                  >
                                    重新生成
                                  </button>
                                </div>
                              </div>
                            </div>
                            <div className="hidden sm:block" />
                          </div>
                        );
                      }

                      const imageTaskStatus =
                        image.taskStatus ||
                        (turn.status === "queued" ? "queued" : "running");
                      const imageStatusLabel =
                        imageTaskStatus === "queued"
                          ? "排队中"
                          : getProgressLabel(image.progress);
                      const showElapsed =
                        imageTaskStatus === "running" &&
                        image.elapsedSecs != null;
                      const elapsedDisplay = showElapsed
                        ? formatElapsed(
                            image.elapsedUpdatedAt != null
                              ? image.elapsedSecs! +
                                  (currentTime - image.elapsedUpdatedAt!) / 1000
                              : image.elapsedSecs!,
                          )
                        : null;
                      return (
                        <div key={image.id} className="break-inside-avoid">
                          <div
                            className={cn(
                              "relative overflow-hidden rounded-lg border border-stone-200/80 dark:border-stone-800 bg-stone-100/80 dark:bg-stone-950/40 sm:rounded-xl",
                              getTurnAspectClass(turn.ratio),
                            )}
                          >
                            <div className="flex h-full flex-col items-center justify-center gap-1 px-2 py-2 text-center text-stone-500 dark:text-stone-400 sm:gap-3 sm:px-6 sm:py-8">
                              <div className="rounded-full bg-white dark:bg-stone-900 p-1.5 shadow-sm sm:p-3">
                                {imageTaskStatus === "queued" ? (
                                  <Clock3 className="size-4 sm:size-5" />
                                ) : (
                                  <LoaderCircle className="size-4 animate-spin sm:size-5" />
                                )}
                              </div>
                              <p className="text-[9px] font-medium leading-4 sm:text-sm">
                                图片 {index + 1}/{turn.images.length}
                              </p>
                              <p className="text-[8px] leading-4 text-stone-400 sm:text-xs">
                                {imageStatusLabel}
                              </p>
                              {image.taskId ? (
                                <button
                                  type="button"
                                  disabled={isCancellingTask?.(image.taskId) ?? false}
                                  onClick={() =>
                                    void onCancelImage(
                                      selectedConversation.id,
                                      image.taskId!,
                                    )
                                  }
                                  className="inline-flex items-center gap-1 rounded-full bg-white dark:bg-stone-900 px-2 py-0.5 text-[8px] font-medium text-rose-600 dark:text-rose-400 shadow-sm transition hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:cursor-not-allowed disabled:opacity-60 sm:px-3 sm:text-[10px]"
                                >
                                  <SquareStop className="size-3" />
                                  {isCancellingTask?.(image.taskId) ?? false
                                    ? "停止中"
                                    : "停止"}
                                </button>
                              ) : null}
                            </div>
                          </div>
                          {elapsedDisplay != null && (
                            <div className="hidden px-0.5 py-1 text-[9px] text-stone-400 sm:block sm:px-3 sm:py-3 sm:text-xs">
                              {elapsedDisplay}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {turn.status === "error" && turn.error ? (
                    <div className="mt-2.5 flex flex-col gap-1.5 border-l-2 border-amber-300 dark:border-amber-700 bg-amber-50/70 dark:bg-amber-950/20 px-3 py-2.5 text-sm leading-6 text-amber-700 dark:text-amber-400 sm:mt-4 sm:flex-row sm:items-center sm:justify-between sm:px-4 sm:py-3 rounded-r-lg">
                      <span className="text-[11px] sm:text-sm">
                        {turn.error}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          void onDismissErrors(selectedConversation.id, turn.id)
                        }
                        className="inline-flex shrink-0 items-center gap-1 self-start rounded-full bg-amber-100 dark:bg-amber-900 px-2 py-0.5 text-[8px] font-medium text-amber-700 dark:text-amber-300 transition hover:bg-amber-200 dark:hover:bg-amber-800 hover:text-amber-900 sm:ml-3 sm:text-[10px]"
                      >
                        <EyeOff className="size-3" />
                        忽略错误
                      </button>
                    </div>
                  ) : null}

                  {/* 气泡底部控制区 */}
                  <div className="mt-4 flex items-center justify-between border-t border-stone-200/50 dark:border-stone-800/40 pt-3 text-[10px]">
                    <div className="flex items-center gap-1.5">
                      {downloadableTurnImages.length > 0 ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 rounded-full border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-2.5 text-[10px] text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800"
                          disabled={isDownloadingTurn}
                          onClick={async () => {
                            if (isDownloadingTurn) {
                              return;
                            }
                            setDownloadingTurnId(turn.id);
                            try {
                              const result = await downloadImageBatch(
                                downloadableTurnImages,
                                `turn-${turnIndex + 1}-images`,
                              );
                              if (result.failedCount > 0) {
                                toast.warning(
                                  `已打包 ${result.downloadedCount} 张，${result.failedCount} 张失败`,
                                );
                              } else {
                                toast.success(
                                  `已开始下载 ${result.downloadedCount} 张图片`,
                                );
                              }
                            } catch (error) {
                              const message =
                                error instanceof Error
                                  ? error.message
                                  : "批量下载失败";
                              toast.error(message);
                            } finally {
                              setDownloadingTurnId(null);
                            }
                          }}
                        >
                          {isDownloadingTurn ? (
                            <LoaderCircle className="size-3 animate-spin" />
                          ) : (
                            <Download className="size-3 mr-1" />
                          )}
                          <span>
                            {isDownloadingTurn ? "打包中" : "批量下载"}
                          </span>
                        </Button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() =>
                          void onRegenerateTurn(selectedConversation.id, turn.id)
                        }
                        className="inline-flex items-center gap-1 rounded-full bg-stone-100 dark:bg-stone-800 px-2.5 py-1 text-[10px] font-medium text-stone-500 dark:text-stone-400 transition hover:bg-stone-200 dark:hover:bg-stone-700 hover:text-stone-900 dark:hover:text-stone-200"
                      >
                        <RotateCcw className="size-3 mr-0.5" />
                        全部重新生成
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        onDeleteResults(selectedConversation.id, turn.id)
                      }
                      className="inline-flex size-7 items-center justify-center rounded-full text-stone-300 dark:text-stone-600 transition hover:bg-rose-50 dark:hover:bg-rose-950/30 hover:text-rose-500"
                      aria-label="删除生成结果"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function getTurnStatusLabel(status: ImageTurnStatus) {
  if (status === "queued") {
    return "排队中";
  }
  if (status === "generating") {
    return "处理中";
  }
  if (status === "success") {
    return "已完成";
  }
  return "失败";
}

const PROGRESS_LABELS: Record<string, string> = {
  getting_account: "确认可用账号",
  image_stream_resolve_start: "提交绘制指令",
  uploading: "上传图片",
  bootstrapping: "预热首页",
  getting_token: "获取 token",
  preparing_conversation: "准备会话",
  starting_generation: "启动生成",
  generating: "生成中",
  receiving_image: "接收图片中",
};

function getProgressLabel(progress?: string) {
  if (!progress) {
    return "生成中";
  }
  return PROGRESS_LABELS[progress] || "生成中";
}

function formatElapsed(seconds: number): string {
  return `${seconds.toFixed(1)}s`;
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

const base64SizeCache = new Map<string, string>();
function formatBase64ImageSize(base64: string) {
  let cached = base64SizeCache.get(base64);
  if (cached !== undefined) return cached;
  const normalized = base64.replace(/\s/g, "");
  const padding = normalized.endsWith("==")
    ? 2
    : normalized.endsWith("=")
      ? 1
      : 0;
  const bytes = Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);

  if (bytes >= 1024 * 1024) {
    cached = `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  } else if (bytes >= 1024) {
    cached = `${(bytes / 1024).toFixed(1)} KB`;
  } else {
    cached = `${bytes} B`;
  }
  base64SizeCache.set(base64, cached);
  return cached;
}

function formatImageDimensions(width: number, height: number) {
  return `${width} x ${height}`;
}

function getTurnAspectClass(ratio?: string) {
  if (ratio === "16:9") return "aspect-video";
  if (ratio === "9:16") return "aspect-[9/16]";
  if (ratio === "4:3") return "aspect-[4/3]";
  if (ratio === "3:4") return "aspect-[3/4]";
  return "aspect-square";
}

const LazyImage = memo(function LazyImage({
  src,
  fullSrc,
  alt,
  className,
  onLoad,
  onOpen,
}: {
  src: string;
  fullSrc?: string;
  alt: string;
  className: string;
  onLoad?: (event: React.SyntheticEvent<HTMLImageElement>) => void;
  onOpen?: () => void;
}) {
  const [isVisible, setIsVisible] = useState(false);
  const imgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = imgRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={imgRef} className="relative">
      {isVisible ? (
        <button type="button" onClick={onOpen} className={className}>
          <img
            src={src}
            alt={alt}
            className="block h-full w-full object-cover transition duration-200 group-hover:brightness-90 sm:h-auto sm:object-contain"
            onLoad={(event) => {
              if (!fullSrc || event.currentTarget.currentSrc === fullSrc) {
                onLoad?.(event);
              }
            }}
            onError={(event) => {
              const target = event.currentTarget;
              if (fullSrc && target.src !== fullSrc) {
                target.src = fullSrc;
              }
            }}
          />
        </button>
      ) : (
        <div
          className={`animate-pulse rounded-xl bg-stone-100 min-h-[128px] sm:min-h-[280px] ${className}`}
        />
      )}
    </div>
  );
});
