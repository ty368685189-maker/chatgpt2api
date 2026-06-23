import { useRef, useCallback, useEffect } from "react";
import type { ImageConversation } from "@/store/image-conversations";

const SCROLL_POSITIONS_STORAGE_KEY = "chatgpt2api_image_scroll_positions";
const SCROLL_TO_LATEST_THRESHOLD = 150;

function loadScrollPositions(): Map<string, number> {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = window.sessionStorage.getItem(SCROLL_POSITIONS_STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, number>;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

function saveScrollPositions(positions: Map<string, number>) {
  if (typeof window === "undefined") return;
  try {
    const obj = Object.fromEntries(positions);
    window.sessionStorage.setItem(
      SCROLL_POSITIONS_STORAGE_KEY,
      JSON.stringify(obj),
    );
  } catch (error) {
    console.error("Failed to save scroll positions", error);
  }
}

function getResultsDistanceFromBottom(element: HTMLElement): number {
  return element.scrollHeight - element.scrollTop - element.clientHeight;
}

export function useImageScrollManager(
  selectedConversationId: string | null,
) {
  const resultsViewportRef = useRef<HTMLDivElement>(null);
  const scrollToLatestBtnRef = useRef<HTMLButtonElement>(null);
  const scrollRafRef = useRef<number | null>(null);
  const scrollPositionsRef = useRef<Map<string, number>>(loadScrollPositions());
  const scrollSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isRestoringScrollRef = useRef(false);
  const scrollRestoreGenerationRef = useRef(0);
  const shouldStickToBottomRef = useRef(true);

  // 用一个 ref 存储最新的 convId 以供闭包使用
  const lastConversationIdRef = useRef<string | null>(selectedConversationId);
  useEffect(() => {
    lastConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

  const scrollResultsToLatest = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const element = resultsViewportRef.current;
      if (!element) return;

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
    if (scrollRafRef.current !== null) return;

    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const element = resultsViewportRef.current;
      if (!element) return;

      if (isRestoringScrollRef.current) return;

      const convId = lastConversationIdRef.current;
      if (convId) {
        scrollPositionsRef.current.set(convId, element.scrollTop);
        if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current);
        scrollSaveTimerRef.current = setTimeout(() => {
          scrollSaveTimerRef.current = null;
          saveScrollPositions(scrollPositionsRef.current);
        }, 300);
      }

      const isAwayFromLatest = getResultsDistanceFromBottom(element) > SCROLL_TO_LATEST_THRESHOLD;
      shouldStickToBottomRef.current = !isAwayFromLatest;
      const btn = scrollToLatestBtnRef.current;
      if (btn) {
        btn.style.display = isAwayFromLatest ? "" : "none";
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

  return {
    resultsViewportRef,
    scrollToLatestBtnRef,
    handleResultsScroll,
    scrollResultsToLatest,
    scrollPositionsRef,
    isRestoringScrollRef,
    scrollRestoreGenerationRef,
    shouldStickToBottomRef,
    saveScrollPositions,
  };
}
