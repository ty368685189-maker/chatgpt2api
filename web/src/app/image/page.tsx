"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowDown, History, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ImageComposer } from "@/app/image/components/image-composer";
import {
  ImageResults,
  type ImageLightboxItem,
} from "@/app/image/components/image-results";
import { ImageSidebar } from "@/app/image/components/image-sidebar";
import { ImageLightbox } from "@/components/image-lightbox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import webConfig from "@/constants/common-env";
import {
  createImageEditTask,
  createImageGenerationTask,
  cancelImageTask,
  fetchAccounts,
  fetchModels,
  fetchImageTasks,
  resumeImagePoll,
  type Account,
  type ImageModel,
  type Model,
  type ImageTask,
} from "@/lib/api";
import { useAuthGuard } from "@/lib/use-auth-guard";
import { useSettingsStore } from "@/app/settings/store";
import {
  clearImageConversations,
  deleteImageConversation,
  getImageConversationStats,
  listImageConversations,
  renameImageConversation,
  saveImageConversation,
  saveImageConversations,
  resetImageConversationStorage,
  type ImageConversation,
  type ImageConversationMode,
  type ImageTurn,
  type ImageTurnStatus,
  type StoredImage,
  type StoredReferenceImage,
} from "@/store/image-conversations";
import { getStoredAuthSession } from "@/store/auth";

import { useImageStorage } from "./hooks/use-image-storage";
import { useImageTasks } from "./hooks/use-image-tasks";
import { recoverConversationHistory, syncConversationImageTasks, deriveTurnStatus, pickFallbackConversationId } from "./helpers";

import {
  buildConversationTitle,
  buildReferenceImageFromResult,
  buildReferenceImageFromStoredImage,
  clampImageCount,
  createId,
  dataUrlToFile,
  fetchImageAsFile,
  filterImageModels,
  formatAvailableQuota,
  formatConversationTime,
  getResultsDistanceFromBottom,
  loadScrollPositions,
  normalizeStoredImageModel,
  parseImageSize,
  readFileAsDataUrl,
  saveScrollPositions,
} from "./utils";

const ACTIVE_CONVERSATION_STORAGE_KEY =
  "chatgpt2api:image_active_conversation_id";
const IMAGE_RATIO_STORAGE_KEY = "chatgpt2api:image_last_ratio";
const IMAGE_TIER_STORAGE_KEY = "chatgpt2api:image_last_tier";
const IMAGE_QUALITY_STORAGE_KEY = "chatgpt2api:image_last_quality";
const IMAGE_MODEL_STORAGE_KEY = "chatgpt2api:image_last_model";
const IMAGE_COUNT_STORAGE_KEY = "chatgpt2api:image_last_count";
const SCROLL_TO_LATEST_THRESHOLD = 160;

const activeConversationQueueIds = new Set<string>();
function ImagePageContent({ isAdmin }: { isAdmin: boolean }) {
  const didLoadQuotaRef = useRef(false);
    const loadCancelledRef = useRef(false);
  const resultsViewportRef = useRef<HTMLDivElement>(null);
  const lastConversationIdRef = useRef<string | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const scrollRafRef = useRef<number | null>(null);
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollPositionsRef = useRef<Map<string, number>>(loadScrollPositions());
  const isRestoringScrollRef = useRef(false);
  const scrollRestoreGenerationRef = useRef(0);

  const config = useSettingsStore((state) => state.config);


  
  useEffect(() => {
    

  return () => {
      const element = resultsViewportRef.current;
      const convId = lastConversationIdRef.current;
      if (element && convId) {
        scrollPositionsRef.current.set(convId, element.scrollTop);
        saveScrollPositions(scrollPositionsRef.current);
      }
      activeConversationQueueIds.clear();
    };
  }, []);

  const {
    conversations,
    conversationsRef,
    selectedConversation,
    selectedConversationId,
    setSelectedConversationId,
    isLoadingHistory,
    updateConversation,
    handleDeleteConversation,
    handleDeleteTurnPart,
    handleClearHistory,
    handleRenameConversation,
    loadHistory,
  } = useImageStorage();

  const {
    isSubmitting,
    isTaskCancelling,
    timeoutRetry,
    setTimeoutRetry,
    handleGenerateImage: hookHandleGenerateImage,
    handleCancelTask,
    handleContinueWait,
    runConversationQueue,
  } = useImageTasks({
    conversationsRef,
    updateConversation,
    setSelectedConversationId,
    loadQuota: () => loadQuota(),
    scrollResultsToLatest: () => scrollResultsToLatest(),
    imageTimeoutRetrySecs: Number(config?.image_timeout_retry_secs || 30),
  });

  const imageTimeoutRetrySecs = Number(config?.image_timeout_retry_secs || 30);

  const [imagePrompt, setImagePrompt] = useState(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      return params.get("prompt") || "";
    }
    return "";
  });

  const [imageCount, setImageCount] = useState(() => {
    if (typeof window !== "undefined") {
      const storedCount = window.localStorage.getItem(IMAGE_COUNT_STORAGE_KEY);
      if (storedCount) return clampImageCount(storedCount);
    }
    return "3";
  });

  const [isUploading, setIsUploading] = useState(false);

  const [imageRatio, setImageRatio] = useState(() => {
    if (typeof window !== "undefined") {
      return window.localStorage.getItem(IMAGE_RATIO_STORAGE_KEY) || "auto";
    }
    return "auto";
  });

  const [imageTier, setImageTier] = useState(() => {
    if (typeof window !== "undefined") {
      return window.localStorage.getItem(IMAGE_TIER_STORAGE_KEY) || "1k";
    }
    return "1k";
  });

  const [imageWidth, setImageWidth] = useState(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const qSize = params.get("size");
      if (qSize) {
        return parseImageSize(qSize).width;
      }
    }
    return "1024";
  });

  const [imageHeight, setImageHeight] = useState(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const qSize = params.get("size");
      if (qSize) {
        return parseImageSize(qSize).height;
      }
    }
    return "1024";
  });

  const [imageQuality, setImageQuality] = useState(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const qQuality = params.get("quality");
      if (qQuality) return qQuality;
      return window.localStorage.getItem(IMAGE_QUALITY_STORAGE_KEY) || "auto";
    }
    return "auto";
  });

  const [imageModel, setImageModel] = useState<ImageModel>(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const qModel = params.get("model");
      if (qModel) return qModel as ImageModel;
      return (window.localStorage.getItem(IMAGE_MODEL_STORAGE_KEY) as ImageModel) || "gpt-image-2";
    }
    return "gpt-image-2";
  });

  const [imageModels, setImageModels] = useState<ImageModel[]>(["gpt-image-2"]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [referenceImageFiles, setReferenceImageFiles] = useState<File[]>([]);
  const [referenceImages, setReferenceImages] = useState<
    StoredReferenceImage[]
  >([]);
  
  
  
  const [availableQuota, setAvailableQuota] = useState("加载中...");
  const [lightboxImages, setLightboxImages] = useState<ImageLightboxItem[]>([]);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const scrollToLatestBtnRef = useRef<HTMLButtonElement>(null);
  const composerShellRef = useRef<HTMLDivElement>(null);
  const composerViewportBaselineRef = useRef<number>(0);
  const [deleteConfirm, setDeleteConfirm] = useState<
    | { type: "one"; id: string }
    | { type: "prompt"; conversationId: string; turnId: string }
    | { type: "results"; conversationId: string; turnId: string }
    | { type: "all" }
    | null
  >(null);
  
  
  const [composerHeight, setComposerHeight] = useState(0);
  const [keyboardOffset, setKeyboardOffset] = useState(0);

  const parsedCount = useMemo(
    () => Number(clampImageCount(imageCount)),
    [imageCount],
  );
  
  const activeTaskCount = useMemo(
    () =>
      conversations.reduce((sum, conversation) => {
        const stats = getImageConversationStats(conversation);
        return sum + stats.queued + stats.running;
      }, 0),
    [conversations],
  );
  const deleteConfirmTitle =
    deleteConfirm?.type === "all"
      ? "清空历史记录"
      : deleteConfirm?.type === "prompt"
        ? "删除提示词记录"
        : deleteConfirm?.type === "results"
          ? "删除生成结果"
          : deleteConfirm?.type === "one"
            ? "删除对话"
            : "";
  const deleteConfirmDescription =
    deleteConfirm?.type === "all"
      ? "确认删除全部图片历史记录吗？删除后无法恢复。"
      : deleteConfirm?.type === "prompt"
        ? "确认删除这条提示词记录吗？对应生成结果会保留。"
        : deleteConfirm?.type === "results"
          ? "确认删除这条生成结果吗？对应提示词记录会保留。"
          : deleteConfirm?.type === "one"
            ? "确认删除这条图片对话吗？删除后无法恢复。"
            : "";

  
  useEffect(() => {
    const element = composerShellRef.current;
    if (!element) {
      return;
    }

    const updateHeight = () => {
      const nextHeight = Math.ceil(element.getBoundingClientRect().height);
      setComposerHeight((current) => (current === nextHeight ? current : nextHeight));
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    

  return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) {
      return;
    }

    const updateKeyboardOffset = () => {
      const currentHeight = viewport.height;
      if (currentHeight > composerViewportBaselineRef.current) {
        composerViewportBaselineRef.current = currentHeight;
      }
      if (composerViewportBaselineRef.current === 0) {
        composerViewportBaselineRef.current = currentHeight;
      }

      const nextOffset = Math.max(
        0,
        composerViewportBaselineRef.current - currentHeight - viewport.offsetTop,
      );
      setKeyboardOffset((current) =>
        Math.abs(current - nextOffset) < 1 ? current : nextOffset,
      );
    };

    updateKeyboardOffset();
    viewport.addEventListener("resize", updateKeyboardOffset);
    viewport.addEventListener("scroll", updateKeyboardOffset);
    window.addEventListener("orientationchange", updateKeyboardOffset);

    

  return () => {
      viewport.removeEventListener("resize", updateKeyboardOffset);
      viewport.removeEventListener("scroll", updateKeyboardOffset);
      window.removeEventListener("orientationchange", updateKeyboardOffset);
    };
  }, []);


  const scrollResultsToLatest = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const element = resultsViewportRef.current;
      if (!element) {
        return;
      }

      shouldStickToBottomRef.current = true;
      const btn = scrollToLatestBtnRef.current;
      if (btn) btn.style.display = "none";
      element.scrollTo({
        top: element.scrollHeight,
        behavior,
      });
    },
    [],
  );

  const handleResultsScroll = useCallback(() => {
    if (scrollRafRef.current !== null) {
      return;
    }

    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const element = resultsViewportRef.current;
      if (!element) {
        return;
      }

      // 恢复滚动位置期间不处理滚动事件
      if (isRestoringScrollRef.current) {
        return;
      }

      // 保存当前会话的滚动位置（debounce 300ms 写入 sessionStorage）
      const convId = lastConversationIdRef.current;
      if (convId) {
        scrollPositionsRef.current.set(convId, element.scrollTop);
        if (scrollSaveTimerRef.current)
          clearTimeout(scrollSaveTimerRef.current);
        scrollSaveTimerRef.current = setTimeout(() => {
          scrollSaveTimerRef.current = null;
          saveScrollPositions(scrollPositionsRef.current);
        }, 300);
      }

      const isAwayFromLatest =
        getResultsDistanceFromBottom(element) > SCROLL_TO_LATEST_THRESHOLD;
      shouldStickToBottomRef.current = !isAwayFromLatest;
      // 直接操作 DOM 控制按钮显隐，避免 setState 触发全组件重渲染
      const btn = scrollToLatestBtnRef.current;
      if (btn) {
        if (isAwayFromLatest) {
          btn.style.display = "";
        } else {
          btn.style.display = "none";
        }
      }
    });
  }, []);

  useEffect(() => {
    

  return () => {
      if (scrollRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRafRef.current);
      }
      if (scrollSaveTimerRef.current !== null) {
        clearTimeout(scrollSaveTimerRef.current);
        saveScrollPositions(scrollPositionsRef.current);
      }
    };
  }, []);


  useEffect(() => {
    let cancelled = false;

    const loadImageModels = async () => {
      try {
        const data = await fetchModels();
        const available = filterImageModels(
          Array.isArray(data.data) ? data.data : [],
        );
        if (cancelled || available.length === 0) {
          return;
        }
        setImageModels(available);
        const storedModel =
          typeof window !== "undefined"
            ? window.localStorage.getItem(IMAGE_MODEL_STORAGE_KEY)
            : null;
        setImageModel((current) => {
          if (available.includes(current)) {
            return current;
          }
          return normalizeStoredImageModel(storedModel, available);
        });
      } catch {
        if (!cancelled) {
          setImageModels(["gpt-image-2"]);
        }
      }
    };

    void loadImageModels();
    

  return () => {
      cancelled = true;
    };
  }, []);

  const loadQuota = useCallback(async () => {
    if (!isAdmin) {
      setAvailableQuota("--");
      return;
    }
    try {
      const data = await fetchAccounts();
      setAvailableQuota(formatAvailableQuota(data.items));
    } catch {
      setAvailableQuota((prev) => (prev === "加载中..." ? "--" : prev));
    }
  }, [isAdmin]);

  useEffect(() => {
    if (didLoadQuotaRef.current) {
      return;
    }
    didLoadQuotaRef.current = true;

    const handleFocus = () => {
      void loadQuota();
    };

    void loadQuota();
    window.addEventListener("focus", handleFocus);
    

  return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, [isAdmin, loadQuota]);

  // 切换会话时保存旧会话滚动位置，并隐藏容器防止闪烁
  useLayoutEffect(() => {
    if (!selectedConversation) {
      lastConversationIdRef.current = null;
      shouldStickToBottomRef.current = true;
      const btn = scrollToLatestBtnRef.current;
      if (btn) btn.style.display = "none";
      return;
    }

    const element = resultsViewportRef.current;
    if (!element) {
      return;
    }

    const didSwitchConversation =
      lastConversationIdRef.current !== selectedConversation.id;

    if (didSwitchConversation) {
      // 递增 generation，使之前未完成的 rAF 回调失效
      scrollRestoreGenerationRef.current += 1;

      // 先保存旧会话的滚动位置（lastConversationIdRef 还是旧值）
      const oldConvId = lastConversationIdRef.current;
      if (oldConvId) {
        scrollPositionsRef.current.set(oldConvId, element.scrollTop);
        saveScrollPositions(scrollPositionsRef.current);
      }
      // 更新为新会话 ID
      lastConversationIdRef.current = selectedConversation.id;

      // 如果有保存的滚动位置，隐藏容器防止用户看到 scrollTop=0 的内容
      const savedScrollTop = scrollPositionsRef.current.get(
        selectedConversation.id,
      );
      if (savedScrollTop != null && savedScrollTop > 0) {
        element.style.visibility = "hidden";
        isRestoringScrollRef.current = true;
      }
    }
  }, [selectedConversation?.id]);

  // 恢复滚动位置或跟随最新内容
  useEffect(() => {
    if (!selectedConversation) {
      return;
    }

    const element = resultsViewportRef.current;
    if (!element) {
      return;
    }

    const savedScrollTop = scrollPositionsRef.current.get(
      selectedConversation.id,
    );

    if (savedScrollTop != null && savedScrollTop > 0) {
      // 捕获当前 generation，用于检测是否已被新的切换取代
      const generation = scrollRestoreGenerationRef.current;
      // 容器已在 useLayoutEffect 中设为 visibility:hidden，用户看不到滚动过程
      requestAnimationFrame(() => {
        // 如果 generation 已变，说明用户又切换了，放弃本次恢复
        if (scrollRestoreGenerationRef.current !== generation) return;
        element.scrollTop = savedScrollTop;
        // 再等一帧确保 scrollTop 生效后再显示容器
        requestAnimationFrame(() => {
          // 再次检查 generation
          if (scrollRestoreGenerationRef.current !== generation) return;
          const isAwayFromLatest =
            getResultsDistanceFromBottom(element) > SCROLL_TO_LATEST_THRESHOLD;
          shouldStickToBottomRef.current = !isAwayFromLatest;
          const btn = scrollToLatestBtnRef.current;
          if (btn) btn.style.display = isAwayFromLatest ? "" : "none";
          // 显示容器 — 用户直接看到正确位置的内容
          element.style.visibility = "";
          isRestoringScrollRef.current = false;
        });
      });
      // 恢复后清除保存的位置，下次内容更新时走正常的 shouldFollowLatest 逻辑
      scrollPositionsRef.current.delete(selectedConversation.id);
      return;
    }

    // 无保存位置，按正常逻辑处理
    const shouldFollowLatest =
      shouldStickToBottomRef.current ||
      getResultsDistanceFromBottom(element) <= SCROLL_TO_LATEST_THRESHOLD;

    if (shouldFollowLatest) {
      requestAnimationFrame(() => scrollResultsToLatest("smooth"));
      return;
    }

    const btn = scrollToLatestBtnRef.current;
    if (btn) btn.style.display = "";
  }, [
    selectedConversation?.id,
    selectedConversation?.updatedAt,
    selectedConversation?.turns.length,
    scrollResultsToLatest,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (selectedConversationId) {
      window.localStorage.setItem(
        ACTIVE_CONVERSATION_STORAGE_KEY,
        selectedConversationId,
      );
    } else {
      window.localStorage.removeItem(ACTIVE_CONVERSATION_STORAGE_KEY);
    }
  }, [selectedConversationId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(IMAGE_RATIO_STORAGE_KEY, imageRatio);
    window.localStorage.setItem(IMAGE_TIER_STORAGE_KEY, imageTier);
    window.localStorage.setItem(IMAGE_QUALITY_STORAGE_KEY, imageQuality);
    window.localStorage.setItem(IMAGE_MODEL_STORAGE_KEY, imageModel);
  }, [imageRatio, imageTier, imageQuality, imageModel]);

  useEffect(() => {
    if (typeof window !== "undefined" && parsedCount > 0) {
      window.localStorage.setItem(IMAGE_COUNT_STORAGE_KEY, String(parsedCount));
    }
  }, [parsedCount]);


  const clearComposerInputs = useCallback(() => {
    setImagePrompt("");
    setReferenceImageFiles([]);
    setReferenceImages([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const resetComposer = useCallback(() => {
    clearComposerInputs();
  }, [clearComposerInputs]);

  const handleCreateDraft = () => {
    shouldStickToBottomRef.current = true;
    const btn = scrollToLatestBtnRef.current;
    if (btn) btn.style.display = "none";
    setSelectedConversationId(null);
    resetComposer();
    textareaRef.current?.focus();
  };

  const openDeleteConversationConfirm = (id: string) => {
    setIsHistoryOpen(false);
    setDeleteConfirm({ type: "one", id });
  };

  const openDeletePromptConfirm = (conversationId: string, turnId: string) => {
    setDeleteConfirm({ type: "prompt", conversationId, turnId });
  };

  const openDeleteResultsConfirm = (conversationId: string, turnId: string) => {
    setDeleteConfirm({ type: "results", conversationId, turnId });
  };

  const openClearHistoryConfirm = () => {
    setIsHistoryOpen(false);
    setDeleteConfirm({ type: "all" });
  };

  const handleConfirmDelete = async () => {
    const target = deleteConfirm;
    setDeleteConfirm(null);
    if (!target) {
      return;
    }
    if (target.type === "all") {
      await handleClearHistory();
      return;
    }
    if (target.type === "prompt" || target.type === "results") {
      await handleDeleteTurnPart(
        target.conversationId,
        target.turnId,
        target.type,
      );
      return;
    }
    await handleDeleteConversation(target.id);
  };

  const appendReferenceImages = useCallback(async (files: File[]) => {
    if (files.length === 0) {
      return;
    }

    try {
      const previews = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          type: file.type || "image/png",
          dataUrl: await readFileAsDataUrl(file),
        })),
      );

      setReferenceImageFiles((prev) => [...prev, ...files]);
      setReferenceImages((prev) => [...prev, ...previews]);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取参考图失败";
      toast.error(message);
    }
  }, []);

  const handleReferenceImageChange = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        return;
      }

      await appendReferenceImages(files);
    },
    [appendReferenceImages],
  );

  const handleRemoveReferenceImage = useCallback((index: number) => {
    setReferenceImageFiles((prev) => {
      const next = prev.filter((_, currentIndex) => currentIndex !== index);
      if (next.length === 0 && fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return next;
    });
    setReferenceImages((prev) =>
      prev.filter((_, currentIndex) => currentIndex !== index),
    );
  }, []);

  const handleContinueEdit = useCallback(
    async (
      conversationId: string,
      image: StoredImage | StoredReferenceImage,
    ) => {
      try {
        const nextReference =
          "dataUrl" in image
            ? {
                referenceImage: image,
                file: dataUrlToFile(image.dataUrl, image.name, image.type),
              }
            : await buildReferenceImageFromStoredImage(
                image,
                `conversation-${conversationId}-${Date.now()}.png`,
              );
        if (!nextReference) {
          return;
        }

        setSelectedConversationId(conversationId);

        setReferenceImages((prev) => [...prev, nextReference.referenceImage]);
        setReferenceImageFiles((prev) => [...prev, nextReference.file]);
        setImagePrompt("");
        textareaRef.current?.focus();
        toast.success("已加入当前参考图，继续输入描述即可编辑");
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "读取结果图失败";
        toast.error(message);
      }
    },
    [],
  );

  const handleReuseTurnConfig = useCallback(
    async (conversationId: string, turnId: string) => {
      const conversation = conversationsRef.current.find(
        (item) => item.id === conversationId,
      );
      const turn = conversation?.turns.find((item) => item.id === turnId);
      if (!conversation || !turn || !turn.prompt.trim()) {
        return;
      }

      setSelectedConversationId(conversationId);
      setImagePrompt(turn.prompt);
      setImageCount(String(Math.max(1, turn.count || turn.images.length || 1)));
      setImageRatio(turn.ratio);
      setImageTier(turn.tier);
      const parsedSize = parseImageSize(turn.size);
      setImageWidth(parsedSize.width);
      setImageHeight(parsedSize.height);
      setImageQuality(turn.quality);
      setImageModel(turn.model);
      setReferenceImages(turn.referenceImages);
      setReferenceImageFiles(
        turn.referenceImages.map((image) =>
          dataUrlToFile(image.dataUrl, image.name, image.type),
        ),
      );
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      textareaRef.current?.focus();
      toast.success("已复用这条提示词配置");
    },
    [],
  );

  const openLightbox = useCallback(
    (images: ImageLightboxItem[], index: number) => {
      if (images.length === 0) {
        return;
      }

      setLightboxImages(images);
      setLightboxIndex(Math.max(0, Math.min(index, images.length - 1)));
      setLightboxOpen(true);
    },
    [],
  );

  const createLoadingImages = (turnId: string, count: number) =>
    Array.from({ length: count }, (_, index) => {
      const imageId = `${turnId}-${index}`;
      return {
        id: imageId,
        taskId: imageId,
        status: "loading" as const,
      };
    });


  /* eslint-enable react-hooks/preserve-manual-memoization */

  const handleRegenerateTurn = useCallback(
    async (conversationId: string, turnId: string) => {
      const conversation = conversationsRef.current.find(
        (item) => item.id === conversationId,
      );
      const sourceTurn = conversation?.turns.find((turn) => turn.id === turnId);
      if (!conversation || !sourceTurn || !sourceTurn.prompt.trim()) {
        return;
      }

      const now = new Date().toISOString();
      const nextTurnId = createId();
      const count = Math.max(
        1,
        sourceTurn.count || sourceTurn.images.length || 1,
      );
      const nextTurn: ImageTurn = {
        id: nextTurnId,
        prompt: sourceTurn.prompt,
        model: sourceTurn.model,
        mode: sourceTurn.mode,
        referenceImages: sourceTurn.referenceImages,
        count,
        size: sourceTurn.size,
        ratio: sourceTurn.ratio,
        tier: sourceTurn.tier,
        quality: sourceTurn.quality,
        images: createLoadingImages(nextTurnId, count),
        createdAt: now,
        status: "queued",
      };
      const nextConversation = {
        ...conversation,
        updatedAt: now,
        turns: [...conversation.turns, nextTurn],
      };

      setSelectedConversationId(conversationId);
      await updateConversation(nextConversation.id, () => nextConversation);
      void runConversationQueue(conversationId);
      toast.success("已加入重新生成队列");
    },
    [runConversationQueue],
  );

  const handleRetryImage = useCallback(
    async (conversationId: string, turnId: string, imageId: string) => {
      const conversation = conversationsRef.current.find(
        (item) => item.id === conversationId,
      );
      if (!conversation) {
        return;
      }

      const now = new Date().toISOString();
      const retryImageId = `${turnId}-${createId()}`;
      const nextConversation = {
        ...conversation,
        updatedAt: now,
        turns: conversation.turns.map((turn) => {
          if (turn.id !== turnId) {
            return turn;
          }
          if (!turn.prompt.trim()) {
            return turn;
          }

          const images = turn.images.map((image) =>
            image.id === imageId
              ? {
                  id: retryImageId,
                  taskId: retryImageId,
                  status: "loading" as const,
                }
              : image,
          );
          const derived = deriveTurnStatus({
            ...turn,
            status: "queued",
            images,
          });
          return {
            ...turn,
            ...derived,
            images,
          };
        }),
      };

      setSelectedConversationId(conversationId);
      await updateConversation(nextConversation.id, () => nextConversation);
      void runConversationQueue(conversationId);
    },
    [runConversationQueue],
  );

  const handleTimeoutRetryContinue = useCallback(async () => {
    if (!timeoutRetry) return;
    const { conversationId, taskId } = timeoutRetry;
    try {
      await resumeImagePoll(taskId, imageTimeoutRetrySecs);
      // 将对应图片的状态重置为 loading，并清除错误
      void updateConversation(conversationId, (current) => {
        const conversation =
          current ??
          conversationsRef.current.find((c) => c.id === conversationId);
        if (!conversation) return current!;
        return {
          ...conversation,
          updatedAt: new Date().toISOString(),
          turns: conversation.turns.map((turn) => {
            const hasLoading = turn.images.some(
              (image) => image.taskId === taskId,
            );
            if (!hasLoading) return turn;
            return {
              ...turn,
              status: "generating" as const,
              error: undefined,
              images: turn.images.map((image) =>
                image.taskId === taskId
                  ? {
                      ...image,
                      status: "loading" as const,
                      error: undefined,
                      taskStatus: "running" as const,
                      startTime: image.startTime || Date.now(),
                    }
                  : image,
              ),
            };
          }),
        };
      });
      // 清除重试状态
      setTimeoutRetry(null);
      void runConversationQueue(conversationId);
      toast.info(`已继续等待 ${imageTimeoutRetrySecs} 秒`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "续轮询失败";
      toast.error(msg);
      setTimeoutRetry(null);
    }
  }, [timeoutRetry, updateConversation, imageTimeoutRetrySecs, runConversationQueue]);

  const handleTimeoutRetryCancel = useCallback(() => {
    if (!timeoutRetry) return;
    const { conversationId: convId, taskId, taskError } = timeoutRetry;
    // 将超时错误应用到对应图片
    void updateConversation(convId, (current) => {
      const conversation =
        current ?? conversationsRef.current.find((c) => c.id === convId);
      if (!conversation) return current!;
      return {
        ...conversation,
        updatedAt: new Date().toISOString(),
        turns: conversation.turns.map((turn) => {
          const hasLoading = turn.images.some(
            (image) => image.status === "loading" && image.taskId === taskId,
          );
          if (!hasLoading) return turn;
          return {
            ...turn,
            status: "error" as const,
            error: taskError,
            images: turn.images.map((image) =>
              image.taskId === taskId
                ? { ...image, status: "error" as const, error: taskError }
                : image,
            ),
          };
        }),
      };
    });
    setTimeoutRetry(null);
    toast.error(taskError);
  }, [timeoutRetry, updateConversation]);



  const handleCancelImage = useCallback(
    async (conversationId: string, taskId: string) => {
      await handleCancelTask(conversationId, taskId);
    },
    [handleCancelTask],
  );

  const handleDismissErrors = useCallback(
    async (conversationId: string, turnId: string) => {
      await updateConversation(conversationId, (current) => {
        const conversation =
          current ??
          conversationsRef.current.find((c) => c.id === conversationId);
        if (!conversation) return current!;
        return {
          ...conversation,
          updatedAt: new Date().toISOString(),
          turns: conversation.turns.map((turn) => {
            if (turn.id !== turnId) return turn;
            const successImages = turn.images.filter(
              (image) => image.status !== "error",
            );
            const derived = deriveTurnStatus({
              ...turn,
              images: successImages,
            });
            return {
              ...turn,
              ...derived,
              count: successImages.length,
              images: successImages,
            };
          }),
        };
      });
    },
    [updateConversation],
  );

  useEffect(() => {
    for (const conversation of conversations) {
      if (
        !activeConversationQueueIds.has(conversation.id) &&
        conversation.turns.some(
          (turn) =>
            !turn.resultsDeleted &&
            (turn.status === "queued" || turn.status === "generating") &&
            turn.images.some((image) => image.status === "loading"),
        )
      ) {
        void runConversationQueue(conversation.id);
      }
    }
  }, [conversations, runConversationQueue]);

  const handleSubmit = async () => {
    if (isSubmitting) {
      return;
    }

    const prompt = imagePrompt.trim();
    if (!prompt) {
      toast.error("请输入提示词");
      return;
    }

    setIsUploading(true);
    try {
      const effectiveImageMode: ImageConversationMode =
        referenceImageFiles.length > 0 ? "edit" : "generate";

      const targetConversation = selectedConversationId
        ? (conversationsRef.current.find(
            (conversation) => conversation.id === selectedConversationId,
          ) ?? null)
        : null;
      const now = new Date().toISOString();
      const conversationId = targetConversation?.id ?? createId();
      const turnId = createId();
      const imageSize =
        imageRatio === "auto"
          ? ""
          : `${imageWidth || 1024}x${imageHeight || 1024}`;
      const draftTurn: ImageTurn = {
        id: turnId,
        prompt,
        model: imageModel,
        mode: effectiveImageMode,
        referenceImages: effectiveImageMode === "edit" ? referenceImages : [],
        count: parsedCount,
        size: imageSize,
        ratio: imageRatio,
        tier: imageTier,
        quality: imageQuality,
        images: createLoadingImages(turnId, parsedCount),
        createdAt: now,
        status: "queued",
      };

      const baseConversation: ImageConversation = targetConversation
        ? {
            ...targetConversation,
            updatedAt: now,
            turns: [...targetConversation.turns, draftTurn],
          }
        : {
            id: conversationId,
            title: buildConversationTitle(prompt),
            createdAt: now,
            updatedAt: now,
            turns: [draftTurn],
          };

      shouldStickToBottomRef.current = true;
      const btn = scrollToLatestBtnRef.current;
      if (btn) btn.style.display = "none";
      setSelectedConversationId(conversationId);
      clearComposerInputs();

      await updateConversation(baseConversation.id, () => baseConversation);
      void runConversationQueue(conversationId);

      const targetStats = getImageConversationStats(baseConversation);
      if (targetStats.running > 0 || targetStats.queued > 1) {
        toast.success("已加入当前对话队列");
      } else if (!targetConversation) {
        toast.success("已创建新对话并开始处理");
      } else {
        toast.success("已发送到当前对话");
      }
    } finally {
      setIsUploading(false);
    }
  };

  

  return (
    <>
      <section className="mx-auto grid h-[calc(100dvh-48px-env(safe-area-inset-top))] sm:h-[calc(100dvh-56px-env(safe-area-inset-top))] min-h-0 w-full max-w-[1400px] grid-cols-1 gap-0 overflow-hidden px-0 pb-0 sm:gap-3 sm:px-3 sm:pb-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <div className="hidden h-full min-h-0 border-r border-stone-200/30 dark:border-stone-800/30 bg-stone-50/40 dark:bg-stone-950/20 backdrop-blur-md pr-3 lg:block">
          <ImageSidebar
            conversations={conversations}
            isLoadingHistory={isLoadingHistory}
            selectedConversationId={selectedConversationId}
            onCreateDraft={handleCreateDraft}
            onClearHistory={openClearHistoryConfirm}
            onSelectConversation={setSelectedConversationId}
            onDeleteConversation={openDeleteConversationConfirm}
            onRenameConversation={handleRenameConversation}
            formatConversationTime={formatConversationTime}
          />
        </div>

        <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
          <DialogContent className="flex h-[84dvh] w-[100vw] max-w-none flex-col overflow-hidden rounded-t-[22px] border-0 border-t border-stone-200/55 bg-white p-0 shadow-[0_-10px_30px_-28px_rgba(15,23,42,0.22)] !bottom-0 !left-0 !right-0 !top-auto !translate-x-0 !translate-y-0 sm:!bottom-auto sm:!left-[50%] sm:!right-auto sm:!top-[50%] sm:!translate-x-[-50%] sm:!translate-y-[-50%] sm:h-[min(82dvh,760px)] sm:w-[92vw] sm:max-w-[460px] sm:rounded-[32px] sm:border-white/80 sm:shadow-[0_24px_80px_-42px_rgba(15,23,42,0.38)]">
            <div className="mx-auto mt-2 h-1.5 w-12 shrink-0 rounded-full bg-stone-200 sm:hidden" />
            <DialogHeader className="sticky top-0 z-10 border-b border-stone-100 bg-white/96 px-3 pt-2 pb-1.5 backdrop-blur-sm sm:static sm:border-0 sm:bg-transparent sm:px-8 sm:pt-7 sm:pb-4 sm:backdrop-blur-0">
              <DialogTitle className="flex items-center gap-2 text-sm font-semibold tracking-tight sm:text-xl">
                <History className="size-4" />
                历史记录
              </DialogTitle>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:px-8 sm:pb-8">
              <ImageSidebar
                conversations={conversations}
                isLoadingHistory={isLoadingHistory}
                selectedConversationId={selectedConversationId}
                onCreateDraft={() => {
                  handleCreateDraft();
                  setIsHistoryOpen(false);
                }}
                onClearHistory={openClearHistoryConfirm}
                onSelectConversation={(id) => {
                  setSelectedConversationId(id);
                  setIsHistoryOpen(false);
                }}
                onDeleteConversation={openDeleteConversationConfirm}
                onRenameConversation={handleRenameConversation}
                formatConversationTime={formatConversationTime}
                hideActionButtons
              />
            </div>
          </DialogContent>
        </Dialog>

        <div className="flex min-h-0 flex-col gap-2 sm:gap-3">
          <div className="flex items-center justify-between rounded-xl border border-stone-200/40 dark:border-stone-850/40 bg-white/70 dark:bg-stone-900/60 px-3 py-1.5 shadow-[0_6px_14px_-18px_rgba(25,33,61,0.12)] backdrop-blur-md sm:hidden">
            <div className="min-w-0">
              <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                Dual公益站
              </div>
              <div className="truncate text-[13px] font-semibold tracking-tight text-stone-950 dark:text-stone-100">
                画图
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                className="h-7 shrink-0 rounded-lg border-stone-200 bg-white px-2.5 text-[11px] text-stone-700 shadow-none"
                onClick={handleCreateDraft}
              >
                <Plus className="size-3 mr-1" />
                新创作
              </Button>
              <Button
                variant="outline"
                className="h-7 shrink-0 rounded-lg border-stone-200 bg-white px-2.5 text-[11px] text-stone-700 shadow-none"
                onClick={() => setIsHistoryOpen(true)}
              >
                <History className="size-3 mr-1" />
                历史
              </Button>
            </div>
          </div>

          <div className="hidden mb-1 px-1 sm:block sm:mb-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
                  画图创作
                </h1>
                <span className="rounded-full bg-stone-900/5 px-2.5 py-0.5 text-[11px] font-medium text-stone-500 backdrop-blur-md dark:bg-white/10 dark:text-stone-400">
                  AI Image Studio
                </span>
              </div>
              <div className="hidden items-center gap-2 sm:flex">
                <Button
                  variant="ghost"
                  className="h-8 rounded-[14px] bg-stone-900/5 px-4 text-[13px] font-medium text-stone-700 shadow-none backdrop-blur-md transition-all hover:bg-white hover:shadow-sm active:scale-95 dark:bg-white/10 dark:text-stone-200 dark:hover:bg-white/20"
                  onClick={handleCreateDraft}
                >
                  <Plus className="mr-1.5 size-3.5" />
                  新创作
                </Button>
                <Button
                  variant="ghost"
                  className="h-8 w-8 shrink-0 rounded-[14px] bg-stone-900/5 p-0 text-stone-500 shadow-none backdrop-blur-md transition-all hover:bg-red-50 hover:text-red-600 hover:shadow-sm active:scale-95 disabled:opacity-50 dark:bg-white/10 dark:text-stone-400 dark:hover:bg-red-950/50 dark:hover:text-red-400"
                  onClick={openClearHistoryConfirm}
                  disabled={conversations.length === 0}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          </div>

          <div className="relative min-h-0 flex-1">
            <div
              ref={resultsViewportRef}
              onScroll={handleResultsScroll}
              className="hide-scrollbar h-full overscroll-contain overflow-y-auto px-0.5 py-0.5 max-sm:pb-4 sm:px-4 sm:py-2"
              style={{
                contain: "layout style paint",
                paddingBottom:
                  composerHeight > 0 ? `${composerHeight + 32}px` : undefined,
              }}
            >
              <ImageResults
                selectedConversation={selectedConversation}
                onOpenLightbox={openLightbox}
                onContinueEdit={handleContinueEdit}
                onDeletePrompt={openDeletePromptConfirm}
                onDeleteResults={openDeleteResultsConfirm}
                onReuseTurnConfig={handleReuseTurnConfig}
                onRegenerateTurn={handleRegenerateTurn}
                onRetryImage={handleRetryImage}
                onCancelImage={handleCancelImage}
                isCancellingTask={isTaskCancelling}
                onTimeoutRetryContinue={handleTimeoutRetryContinue}
                onDismissErrors={handleDismissErrors}
                formatConversationTime={formatConversationTime}
              />
            </div>

            <button
              ref={scrollToLatestBtnRef}
              type="button"
              aria-label="滚动到最新消息"
              title="滚动到最新消息"
              onClick={() => scrollResultsToLatest("smooth")}
              className="absolute bottom-2.5 left-1/2 z-20 inline-flex size-8 -translate-x-1/2 items-center justify-center rounded-full border border-stone-200 bg-white/95 text-stone-700 shadow-lg shadow-stone-200/60 backdrop-blur transition hover:-translate-y-0.5 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 dark:border-white/10 dark:bg-stone-800/95 dark:text-stone-100 dark:shadow-black/40 dark:hover:bg-stone-700"
              style={{ display: "none" }}
            >
              <ArrowDown className="size-4" />
            </button>
          </div>

          <div
            ref={composerShellRef}
            className="shrink-0 flex justify-center px-2 pb-2 pt-2 sm:px-0 sm:pb-0 sm:pt-4 relative z-30"
            style={{
              paddingBottom:
                keyboardOffset > 0
                  ? `calc(env(safe-area-inset-bottom) + ${keyboardOffset}px + 0.5rem)`
                  : "calc(env(safe-area-inset-bottom) + 0.5rem)",
            }}
          >
            <div className="w-full max-w-[940px]">
              <ImageComposer
                prompt={imagePrompt}
                imageCount={imageCount}
                imageRatio={imageRatio}
                imageTier={imageTier}
                imageWidth={imageWidth}
                imageHeight={imageHeight}
                imageQuality={imageQuality}
                imageModel={imageModel}
                imageModels={imageModels}
                availableQuota={availableQuota}
                activeTaskCount={activeTaskCount}
                referenceImages={referenceImages}
                isSubmitting={isSubmitting}
                textareaRef={textareaRef}
                fileInputRef={fileInputRef}
                onPromptChange={setImagePrompt}
                onImageCountChange={(value) =>
                  setImageCount(value ? clampImageCount(value) : "")
                }
                onImageRatioChange={setImageRatio}
                onImageTierChange={setImageTier}
                onImageWidthChange={setImageWidth}
                onImageHeightChange={setImageHeight}
                onImageQualityChange={setImageQuality}
                onImageModelChange={setImageModel}
                onSubmit={handleSubmit}
                onPickReferenceImage={() => fileInputRef.current?.click()}
                onReferenceImageChange={handleReferenceImageChange}
                onRemoveReferenceImage={handleRemoveReferenceImage}
              />
            </div>
          </div>
        </div>
      </section>

      <ImageLightbox
        images={lightboxImages}
        currentIndex={lightboxIndex}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        onIndexChange={setLightboxIndex}
      />

      {deleteConfirm ? (
        <Dialog
          open
          onOpenChange={(open) => (!open ? setDeleteConfirm(null) : null)}
        >
          <DialogContent
            showCloseButton={false}
            className="w-[92vw] max-w-[420px] rounded-[20px] border-stone-200/70 p-4 shadow-[0_18px_50px_-34px_rgba(15,23,42,0.3)] sm:rounded-2xl sm:p-6"
          >
            <DialogHeader className="gap-1.5 sm:gap-2">
              <DialogTitle>{deleteConfirmTitle}</DialogTitle>
              <DialogDescription className="text-[13px] leading-6 sm:text-sm">
                {deleteConfirmDescription}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                className="h-9 rounded-full px-4"
                onClick={() => setDeleteConfirm(null)}
              >
                取消
              </Button>
              <Button
                className="h-9 rounded-full bg-rose-600 px-4 text-white hover:bg-rose-700"
                onClick={() => void handleConfirmDelete()}
              >
                确认删除
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

export default function ImagePage() {
  const { isCheckingAuth, session } = useAuthGuard();

  if (isCheckingAuth || !session) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return <ImagePageContent isAdmin={session.role === "admin"} />;
}
