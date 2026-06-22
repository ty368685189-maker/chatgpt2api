"use client";
import {
  ArrowUp,
  ChevronDown,
  ImagePlus,
  Info,
  LoaderCircle,
  RectangleHorizontal,
  RectangleVertical,
  Square,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type RefObject,
} from "react";

import { ImageLightbox } from "@/components/image-lightbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ImageModel } from "@/lib/api";
import { cn } from "@/lib/utils";

type ImageComposerProps = {
  prompt: string;
  imageCount: string;
  imageRatio: string;
  imageTier: string;
  imageWidth: string;
  imageHeight: string;
  imageQuality: string;
  imageModel: ImageModel;
  imageModels: ImageModel[];
  availableQuota: string;
  activeTaskCount: number;
  referenceImages: Array<{ name: string; dataUrl: string }>;
  isSubmitting: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onPromptChange: (value: string) => void;
  onImageCountChange: (value: string) => void;
  onImageRatioChange: (value: string) => void;
  onImageTierChange: (value: string) => void;
  onImageWidthChange: (value: string) => void;
  onImageHeightChange: (value: string) => void;
  onImageQualityChange: (value: string) => void;
  onImageModelChange: (value: ImageModel) => void;
  onSubmit: () => void | Promise<void>;
  onPickReferenceImage: () => void;
  onReferenceImageChange: (files: File[]) => void | Promise<void>;
  onRemoveReferenceImage: (index: number) => void;
};

const imageFileNamePattern =
  /\.(avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/i;

function isImageFile(file: File) {
  return (
    file.type.startsWith("image/") ||
    (!file.type && imageFileNamePattern.test(file.name))
  );
}

function hasDraggedImages(dataTransfer: DataTransfer) {
  const items = Array.from(dataTransfer.items || []);
  if (items.length > 0) {
    return items.some(
      (item) =>
        item.kind === "file" && (item.type.startsWith("image/") || !item.type),
    );
  }
  return Array.from(dataTransfer.files || []).some(isImageFile);
}

function getDraggedImageFiles(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.files || []).filter(isImageFile);
}

const qualityOptions = [
  { value: "auto", label: "自动" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];
const aspectOptions = [
  {
    ratio: "1:1",
    tier: "1k",
    width: "1024",
    height: "1024",
    label: "1:1",
    icon: Square,
  },
  {
    ratio: "2:3",
    tier: "1k",
    width: "1024",
    height: "1536",
    label: "2:3",
    icon: RectangleVertical,
  },
  {
    ratio: "3:2",
    tier: "1k",
    width: "1536",
    height: "1024",
    label: "3:2",
    icon: RectangleHorizontal,
  },
  {
    ratio: "3:4",
    tier: "1k",
    width: "1024",
    height: "1365",
    label: "3:4",
    icon: RectangleVertical,
  },
  {
    ratio: "4:3",
    tier: "1k",
    width: "1365",
    height: "1024",
    label: "4:3",
    icon: RectangleHorizontal,
  },
  {
    ratio: "9:16",
    tier: "1k",
    width: "1088",
    height: "1920",
    label: "9:16",
    icon: RectangleVertical,
  },
  {
    ratio: "16:9",
    tier: "1k",
    width: "1920",
    height: "1088",
    label: "16:9",
    icon: RectangleHorizontal,
  },
  {
    ratio: "1:1",
    tier: "2k",
    width: "2048",
    height: "2048",
    label: "1:1(2k)",
    icon: Square,
  },
  {
    ratio: "16:9",
    tier: "2k",
    width: "2560",
    height: "1440",
    label: "16:9(2k)",
    icon: RectangleHorizontal,
  },
  {
    ratio: "9:16",
    tier: "2k",
    width: "1440",
    height: "2560",
    label: "9:16(2k)",
    icon: RectangleVertical,
  },
  {
    ratio: "16:9",
    tier: "4k",
    width: "3840",
    height: "2160",
    label: "16:9(4k)",
    icon: RectangleHorizontal,
  },
  {
    ratio: "9:16",
    tier: "4k",
    width: "2160",
    height: "3840",
    label: "9:16(4k)",
    icon: RectangleVertical,
  },
  {
    ratio: "auto",
    tier: "auto",
    width: "1024",
    height: "1024",
    label: "auto",
    icon: null,
  },
];
const countOptions = Array.from({ length: 10 }, (_, index) =>
  String(index + 1),
);

export function ImageComposer({
  prompt,
  imageCount,
  imageRatio,
  imageTier,
  imageWidth,
  imageHeight,
  imageQuality,
  imageModel,
  imageModels,
  availableQuota,
  activeTaskCount,
  referenceImages,
  isSubmitting,
  textareaRef,
  fileInputRef,
  onPromptChange,
  onImageCountChange,
  onImageRatioChange,
  onImageTierChange,
  onImageWidthChange,
  onImageHeightChange,
  onImageQualityChange,
  onImageModelChange,
  onSubmit,
  onPickReferenceImage,
  onReferenceImageChange,
  onRemoveReferenceImage,
}: ImageComposerProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [isSizeMenuOpen, setIsSizeMenuOpen] = useState(false);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [sizeMenuPos, setSizeMenuPos] = useState<{ top: number; left: number }>(
    { top: 0, left: 0 },
  );
  const [isMobile, setIsMobile] = useState(false);
  const [activeTab, setActiveTab] = useState<"general" | "size">("general");
  const sizeMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);
  const sizeMenuBtnRef = useRef<HTMLButtonElement>(null);
  const lightboxImages = useMemo(
    () =>
      referenceImages.map((image, index) => ({
        id: `${image.name}-${index}`,
        src: image.dataUrl,
      })),
    [referenceImages],
  );
  const modelOptions = useMemo(
    () => imageModels.map((model) => ({ value: model, label: model })),
    [imageModels],
  );
  const qualityLabel =
    qualityOptions.find((option) => option.value === imageQuality)?.label ||
    "自动";
  const ratioLabel =
    imageRatio === "auto" ? "自动" : `${imageRatio} · ${imageTier}`;
  const selectedModelLabel =
    modelOptions.find((option) => option.value === imageModel)?.label ||
    imageModel;
  const compactSummary = `${qualityLabel} · ${ratioLabel} · ${imageCount || 1} 张`;
  const isCodexModel = imageModel.toLowerCase().includes("codex");
  const submitLabel = referenceImages.length > 0 ? "编辑图片" : "生成图片";
  useEffect(() => {
    if (!isSizeMenuOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          '[data-slot="select-content"], [data-slot="select-trigger"]',
        )
      ) {
        return;
      }
      if (!sizeMenuRef.current?.contains(target as Node)) {
        setIsSizeMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isSizeMenuOpen]);

  const handleTextareaPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = Array.from(event.clipboardData.files).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (imageFiles.length === 0) {
      return;
    }

    event.preventDefault();
    void onReferenceImageChange(imageFiles);
  };

  const handleComposerDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedImages(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsSizeMenuOpen(false);
    setIsDraggingImage(true);
  };

  const handleComposerDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedImages(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDraggingImage(true);
  };

  const handleComposerDragLeave = (event: DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (
      nextTarget instanceof Node &&
      event.currentTarget.contains(nextTarget)
    ) {
      return;
    }
    setIsDraggingImage(false);
  };

  const handleComposerDrop = (event: DragEvent<HTMLDivElement>) => {
    const imageFiles = getDraggedImageFiles(event.dataTransfer);
    if (event.dataTransfer.files.length > 0 || imageFiles.length > 0) {
      event.preventDefault();
      event.stopPropagation();
    }

    setIsDraggingImage(false);
    if (imageFiles.length === 0) {
      return;
    }

    void onReferenceImageChange(imageFiles);
  };

  return (
    <div className="w-full">
      <div className="w-full">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            void onReferenceImageChange(Array.from(event.target.files || []));
          }}
        />

        {referenceImages.length > 0 ? (
          <div className="mb-1.5 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:mb-2.5 sm:flex-wrap sm:overflow-visible sm:pb-0">
            {referenceImages.map((image, index) => (
              <div
                key={`${image.name}-${index}`}
                className="relative size-7 shrink-0 sm:size-14"
              >
                <button
                  type="button"
                  onClick={() => {
                    setLightboxIndex(index);
                    setLightboxOpen(true);
                  }}
                  className="group size-7 overflow-hidden rounded-lg border border-stone-200 bg-stone-50 transition hover:border-stone-300 sm:size-14 sm:rounded-2xl"
                  aria-label={`预览参考图 ${image.name || index + 1}`}
                >
                  <img
                    src={image.dataUrl}
                    alt={image.name || `参考图 ${index + 1}`}
                    className="h-full w-full object-cover"
                  />
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemoveReferenceImage(index);
                  }}
                  className="absolute -right-1 -top-1 inline-flex size-[16px] items-center justify-center rounded-full border border-stone-200 bg-white text-stone-500 transition hover:border-stone-300 hover:text-stone-800"
                  aria-label={`移除参考图 ${image.name || index + 1}`}
                >
                  <X className="size-2.5" />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div
          className={cn(
            "overflow-hidden rounded-[18px] border border-stone-200/80 bg-white shadow-[0_8px_24px_-24px_rgba(15,23,42,0.28)] transition dark:border-white/10 dark:bg-stone-950/80 sm:rounded-[28px] sm:shadow-none",
            isDraggingImage && "border-stone-900 bg-stone-50",
          )}
        >
          <div
            className="relative cursor-text"
            onDragEnter={handleComposerDragEnter}
            onDragOver={handleComposerDragOver}
            onDragLeave={handleComposerDragLeave}
            onDrop={handleComposerDrop}
            onClick={() => {
              textareaRef.current?.focus();
            }}
          >
            <ImageLightbox
              images={lightboxImages}
              currentIndex={lightboxIndex}
              open={lightboxOpen}
              onOpenChange={setLightboxOpen}
              onIndexChange={setLightboxIndex}
            />
            <Textarea
              ref={textareaRef}
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value)}
              onPaste={handleTextareaPaste}
              placeholder={
                referenceImages.length > 0
                  ? "描述你希望如何修改参考图"
                  : "输入你想要生成的画面，也可直接粘贴图片"
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void onSubmit();
                }
              }}
              className="min-h-[74px] resize-none rounded-[18px] border-0 bg-transparent px-3.5 pt-3.5 pb-1.5 text-[15px] leading-6 text-stone-900 shadow-none placeholder:text-stone-400 focus-visible:ring-0 dark:text-stone-100 dark:placeholder:text-stone-500 sm:min-h-[124px] sm:rounded-[28px] sm:px-5 sm:pt-5 sm:pb-16 sm:leading-7"
            />
            {isDraggingImage ? (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[18px] border-2 border-dashed border-stone-900 bg-white/85 text-sm font-medium text-stone-900 backdrop-blur-[1px] sm:rounded-[28px]">
                <div className="flex items-center gap-2 rounded-full bg-stone-950 px-3 py-1.5 text-sm text-white shadow-lg sm:px-4 sm:py-2">
                  <ImagePlus className="size-3.5 sm:size-4" />
                  <span>松开以上传参考图</span>
                </div>
              </div>
            ) : null}

            <div
              className="rounded-b-[18px] border-t border-stone-100 bg-white px-2.5 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-1.5 dark:border-white/10 dark:bg-stone-950/95 sm:absolute sm:inset-x-0 sm:bottom-0 sm:rounded-b-none sm:border-t-0 sm:bg-gradient-to-t sm:from-white sm:via-white/95 sm:to-transparent sm:px-5 sm:pb-3 sm:pt-5 sm:dark:from-stone-950 sm:dark:via-stone-950/95 sm:dark:to-stone-950/0"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex flex-col gap-1.5 sm:gap-3">
                <div className="hide-scrollbar flex flex-nowrap items-center gap-1 overflow-x-auto pb-0.5 sm:flex-wrap sm:overflow-visible sm:pb-0 sm:gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-7 shrink-0 rounded-full border-stone-200 bg-white px-2.5 text-[10px] font-medium text-stone-700 shadow-none sm:h-9 sm:px-3.5 sm:text-sm"
                    onClick={onPickReferenceImage}
                    aria-label={
                      referenceImages.length > 0 ? "添加参考图" : "上传"
                    }
                  >
                    <ImagePlus className="size-3 sm:size-4" />
                    <span className="hidden sm:inline">
                      {referenceImages.length > 0 ? "添加参考图" : "上传"}
                    </span>
                  </Button>
                  <div className="relative flex h-7 min-w-0 shrink items-center rounded-full bg-transparent text-[10px] sm:h-auto sm:shrink-0 sm:text-[13px]">
                    <button
                      ref={sizeMenuBtnRef}
                      type="button"
                      className="inline-flex h-7 w-fit max-w-[calc(100vw-8rem)] items-center justify-between gap-2 rounded-full bg-stone-100 px-2.5 text-left text-[10px] font-semibold text-stone-900 sm:h-9 sm:max-w-none sm:px-4 sm:text-sm"
                      onClick={() => {
                        if (!isSizeMenuOpen && sizeMenuBtnRef.current) {
                          const rect =
                            sizeMenuBtnRef.current.getBoundingClientRect();
                          const menuWidth = Math.min(
                            460,
                            window.innerWidth - 32,
                          );
                          setSizeMenuPos({
                            top: rect.top - 8,
                            left: Math.max(
                              16,
                              Math.min(
                                rect.left,
                                window.innerWidth - menuWidth - 16,
                              ),
                            ),
                          });
                        }
                        setIsSizeMenuOpen((open) => !open);
                      }}
                    >
                      <span className="truncate">{ratioLabel}</span>
                      <ChevronDown
                        className={cn(
                          "size-4 shrink-0 opacity-60 transition",
                          isSizeMenuOpen && "rotate-180",
                        )}
                      />
                    </button>
                    {isSizeMenuOpen ? (
                      <div
                        ref={sizeMenuRef}
                        className="fixed z-[80] overflow-hidden border border-stone-200/70 bg-white shadow-[0_24px_70px_-34px_rgba(15,23,42,0.38)] dark:border-stone-800 dark:bg-stone-900 sm:max-h-none sm:overflow-visible"
                        style={
                          isMobile
                            ? {
                                top: "auto",
                                right: "0",
                                bottom: "0",
                                left: "0",
                                width: "100vw",
                                height: "min(86dvh, 720px)",
                                maxHeight: "86dvh",
                                borderRadius: "24px 24px 0 0",
                                padding: "0",
                              }
                            : {
                                top: sizeMenuPos.top,
                                left: sizeMenuPos.left,
                                transform: "translateY(-100%)",
                                width: "min(440px, calc(100vw - 2rem))",
                                borderRadius: "24px",
                                padding: "14px",
                              }
                        }
                      >
                        <div className="sticky top-0 z-10 mb-1.5 flex items-center justify-between border-b border-stone-100 bg-white/95 px-3.5 pb-2 pt-3 backdrop-blur dark:border-stone-800 dark:bg-stone-900/95 sm:static sm:mb-1.5 sm:px-0 sm:pt-0 sm:backdrop-blur-0">
                          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                            <h3 className="truncate text-sm font-semibold text-stone-950 dark:text-white sm:text-base">
                              图像设置
                            </h3>
                            <div className="flex rounded-lg bg-stone-100 p-0.5 dark:bg-stone-800">
                              <button
                                type="button"
                                onClick={() => setActiveTab("general")}
                                className={cn(
                                  "cursor-pointer rounded-md px-2 py-0.5 text-[10px] font-semibold transition-all sm:px-2.5 sm:text-xs",
                                  activeTab === "general"
                                    ? "bg-white text-stone-950 shadow-sm dark:bg-stone-800 dark:text-white"
                                    : "text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200",
                                )}
                              >
                                常规
                              </button>
                              <button
                                type="button"
                                onClick={() => setActiveTab("size")}
                                className={cn(
                                  "cursor-pointer rounded-md px-2 py-0.5 text-[10px] font-semibold transition-all sm:px-2.5 sm:text-xs",
                                  activeTab === "size"
                                    ? "bg-white text-stone-950 shadow-sm dark:bg-stone-800 dark:text-white"
                                    : "text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200",
                                )}
                              >
                                尺寸
                              </button>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => setIsSizeMenuOpen(false)}
                            className="inline-flex size-7 items-center justify-center rounded-full cursor-pointer text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                            aria-label="关闭设置"
                          >
                            <X className="size-4" />
                          </button>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-1 sm:px-0 sm:pb-0">
                          {activeTab === "general" && (
                            <div className="space-y-[5px]">
                              <div>
                                <div className="mb-1 text-[10px] font-medium text-stone-900 dark:text-stone-300 sm:mb-1.5 sm:text-sm">
                                  模型
                                </div>
                                <Select
                                  value={imageModel}
                                  onValueChange={(value) => {
                                    onImageModelChange(value as ImageModel);
                                  }}
                                >
                                  <SelectTrigger className="h-7 rounded-xl border-stone-200 bg-white text-[12px] shadow-none dark:border-stone-800 dark:bg-stone-900 dark:text-stone-100 sm:h-9 sm:text-sm">
                                    <div className="flex min-w-0 items-center gap-2">
                                      <img
                                        src="/openai.svg"
                                        alt=""
                                        aria-hidden="true"
                                        className="size-3.5 shrink-0 text-stone-700 dark:invert sm:size-4"
                                      />
                                      <span className="truncate">
                                        {selectedModelLabel}
                                      </span>
                                    </div>
                                  </SelectTrigger>
                                  <SelectContent className="z-[120]">
                                    {modelOptions.map((option) => (
                                      <SelectItem
                                        key={option.value}
                                        value={option.value}
                                        className="pl-10"
                                        style={{
                                          backgroundImage: "url('/openai.svg')",
                                          backgroundRepeat: "no-repeat",
                                          backgroundPosition: "12px center",
                                          backgroundSize: "16px 16px",
                                        }}
                                      >
                                        {option.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              <div>
                                <div className="mb-1 text-[10px] font-medium text-stone-900 dark:text-stone-300 sm:mb-1.5 sm:text-sm">
                                  质量
                                </div>
                                <div className="grid grid-cols-4 gap-0.5 sm:gap-1.5">
                                  {qualityOptions.map((option) => {
                                    const active =
                                      option.value === imageQuality;
                                    return (
                                      <button
                                        key={option.value}
                                        type="button"
                                        className={cn(
                                          "h-6 cursor-pointer rounded-full border border-stone-200 bg-white text-[10px] text-stone-800 transition hover:border-stone-300 hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 sm:h-9 sm:text-sm",
                                          active &&
                                            "border-stone-950 bg-white font-medium text-stone-950 dark:border-white dark:bg-stone-800 dark:text-white",
                                        )}
                                        onClick={() =>
                                          onImageQualityChange(option.value)
                                        }
                                      >
                                        {option.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>

                              <div className="border-t border-stone-100 pt-[5px] dark:border-stone-800">
                                <div className="mb-1 text-[10px] font-medium text-stone-900 dark:text-stone-300 sm:mb-1.5 sm:text-sm">
                                  生成数量
                                </div>
                                <div className="grid grid-cols-4 gap-0.5 sm:grid-cols-5 sm:gap-1">
                                  {countOptions.map((option) => {
                                    const active =
                                      String(imageCount) === option;
                                    return (
                                      <button
                                        key={option}
                                        type="button"
                                        className={cn(
                                          "h-6 cursor-pointer rounded-full border border-stone-200 bg-white text-[10px] text-stone-800 transition hover:border-stone-300 hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800",
                                          active &&
                                            "border-stone-950 bg-white font-medium text-stone-950 dark:border-white dark:bg-stone-800 dark:text-white",
                                        )}
                                        onClick={() =>
                                          onImageCountChange(option)
                                        }
                                      >
                                        {option} 张
                                      </button>
                                    );
                                  })}
                                  <div
                                    className={cn(
                                      "col-span-2 flex h-6 items-center gap-1 rounded-full border border-stone-200 bg-white px-2 transition-colors focus-within:border-stone-950 dark:border-stone-800 dark:bg-stone-900 sm:h-9 sm:px-3",
                                      !countOptions.includes(
                                        String(imageCount),
                                      ) &&
                                        imageCount !== "" &&
                                        "border-stone-950 dark:border-white",
                                    )}
                                  >
                                    <span className="shrink-0 select-none text-[10px] text-stone-500">
                                      其他
                                    </span>
                                    <input
                                      type="number"
                                      inputMode="numeric"
                                      min="1"
                                      max="100"
                                      step="1"
                                      placeholder="输入数量"
                                      value={
                                        countOptions.includes(
                                          String(imageCount),
                                        )
                                          ? ""
                                          : imageCount
                                      }
                                      onChange={(event) => {
                                        const val = event.target.value;
                                        onImageCountChange(val);
                                      }}
                                      className="w-full bg-transparent p-0 text-center text-[12px] font-medium text-stone-800 focus:outline-none dark:text-stone-100"
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}

                          {activeTab === "size" && (
                            <div className="space-y-1.5">
                              <div>
                                <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-stone-900 dark:text-stone-300 sm:mb-1.5 sm:text-sm">
                                  尺寸{" "}
                                  <Info className="size-3 text-stone-400" />
                                </div>
                                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
                                  <div className="flex items-center rounded-lg bg-stone-100 px-2 py-[0.2rem] text-sm text-stone-700 dark:bg-stone-900 dark:text-stone-300">
                                    <span className="mr-1.5 text-[10px] text-stone-500">
                                      W
                                    </span>
                                    <Input
                                      type={
                                        imageRatio === "auto"
                                          ? "text"
                                          : "number"
                                      }
                                      inputMode={
                                        imageRatio === "auto"
                                          ? "text"
                                          : "numeric"
                                      }
                                      disabled={imageRatio === "auto"}
                                      placeholder={
                                        imageRatio === "auto"
                                          ? "自动"
                                          : undefined
                                      }
                                      value={
                                        imageRatio === "auto" ? "" : imageWidth
                                      }
                                      onChange={(event) =>
                                        onImageWidthChange(event.target.value)
                                      }
                                      className="h-5 border-0 bg-transparent px-0 text-[12px] font-medium text-stone-800 shadow-none focus-visible:ring-0 dark:text-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
                                    />
                                  </div>
                                  <span className="text-[10px] text-stone-400">
                                    ×
                                  </span>
                                  <div className="flex items-center rounded-lg bg-stone-100 px-2 py-[0.2rem] text-sm text-stone-700 dark:bg-stone-900 dark:text-stone-300">
                                    <span className="mr-1.5 text-[10px] text-stone-500">
                                      H
                                    </span>
                                    <Input
                                      type={
                                        imageRatio === "auto"
                                          ? "text"
                                          : "number"
                                      }
                                      inputMode={
                                        imageRatio === "auto"
                                          ? "text"
                                          : "numeric"
                                      }
                                      disabled={imageRatio === "auto"}
                                      placeholder={
                                        imageRatio === "auto"
                                          ? "自动"
                                          : undefined
                                      }
                                      value={
                                        imageRatio === "auto" ? "" : imageHeight
                                      }
                                      onChange={(event) =>
                                        onImageHeightChange(event.target.value)
                                      }
                                      className="h-5 border-0 bg-transparent px-0 text-[12px] font-medium text-stone-800 shadow-none focus-visible:ring-0 dark:text-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
                                    />
                                  </div>
                                </div>
                              </div>

                              <div>
                                <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-stone-900 dark:text-stone-300 sm:mb-1.5 sm:text-sm">
                                  宽高比{" "}
                                  <Info className="size-3 text-stone-400" />
                                </div>
                                <div className="grid grid-cols-3 gap-1 sm:grid-cols-5">
                                  {aspectOptions.map((option) => {
                                    const active =
                                      option.ratio === imageRatio &&
                                      option.tier === imageTier &&
                                      option.width === imageWidth &&
                                      option.height === imageHeight;
                                    const Icon = option.icon;
                                    const disabled =
                                      !isCodexModel &&
                                      (option.tier === "2k" ||
                                        option.tier === "4k");
                                    return (
                                      <button
                                        key={`${option.ratio}-${option.tier}-${option.label}`}
                                        type="button"
                                        disabled={disabled}
                                        className={cn(
                                          "flex h-9 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border border-stone-200 bg-white text-[9px] text-stone-800 transition hover:border-stone-300 hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 sm:h-[64px] sm:gap-1 sm:text-sm",
                                          active &&
                                            "border-stone-950 dark:border-white dark:bg-stone-800 dark:text-white",
                                          disabled &&
                                            "cursor-not-allowed border-stone-100 bg-stone-50 text-stone-300 hover:border-stone-100 hover:bg-stone-50 dark:border-stone-900 dark:bg-stone-950 dark:text-stone-400",
                                          option.ratio === "auto" &&
                                            "col-span-2 sm:col-span-1",
                                        )}
                                        onClick={() => {
                                          if (disabled) {
                                            return;
                                          }
                                          onImageRatioChange(option.ratio);
                                          onImageTierChange(option.tier);
                                          onImageWidthChange(option.width);
                                          onImageHeightChange(option.height);
                                        }}
                                      >
                                        {Icon ? (
                                          <>
                                            <Icon className="size-3 stroke-[1.8]" />
                                            <span>{option.label}</span>
                                          </>
                                        ) : (
                                          <span>{option.label}</span>
                                        )}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="hidden flex-wrap items-center gap-1.5 sm:flex sm:gap-2">
                    <div className="shrink-0 rounded-full bg-stone-100 px-2 py-1 text-[10px] font-medium text-stone-600 sm:px-3 sm:py-1.5 sm:text-xs">
                      <span className="hidden sm:inline">号池余量 </span>
                      {availableQuota}
                    </div>
                    {activeTaskCount > 0 && (
                      <div className="flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700 sm:gap-1.5 sm:px-3 sm:py-1.5 sm:text-xs">
                        <LoaderCircle className="size-3 animate-spin" />
                        {activeTaskCount}
                        <span className="hidden sm:inline"> 个任务处理中</span>
                      </div>
                    )}
                    <div className="hidden shrink-0 rounded-full bg-stone-100 px-3 py-1.5 text-xs font-medium text-stone-600 sm:flex">
                      {compactSummary}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void onSubmit()}
                    disabled={!prompt.trim() || isSubmitting}
                    className="inline-flex h-9 min-w-[100px] items-center justify-center gap-2 rounded-full bg-stone-950 px-3.5 text-[13px] font-semibold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300 sm:h-11 sm:min-w-[140px] sm:text-sm"
                    aria-label={
                      referenceImages.length > 0 ? "编辑图片" : "生成图片"
                    }
                  >
                    {isSubmitting ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : (
                      <ArrowUp className="size-3.5" />
                    )}
                    <span>{isSubmitting ? "发送中" : submitLabel}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
