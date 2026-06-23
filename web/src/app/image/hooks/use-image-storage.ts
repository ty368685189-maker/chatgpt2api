import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  clearImageConversations,
  deleteImageConversation,
  listImageConversations,
  renameImageConversation,
  saveImageConversation,
  type ImageConversation,
  type ImageTurn,
} from "@/store/image-conversations";

import { getStoredAuthSession } from "@/store/auth";
import { resetImageConversationStorage } from "@/store/image-conversations";
import { recoverConversationHistory } from "../helpers";

import { pickFallbackConversationId, sortImageConversations } from "../helpers";

const ACTIVE_CONVERSATION_STORAGE_KEY =
  "chatgpt2api:image_active_conversation_id";

export function useImageStorage() {
  const [conversations, setConversations] = useState<ImageConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const conversationsRef = useRef<ImageConversation[]>([]);

  const selectedConversation =
    conversations.find((item) => item.id === selectedConversationId) ?? null;

  // Sync ref with state
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  
  const loadHistory = useCallback(async () => {
    try {
      const session = await getStoredAuthSession();
      if (session?.subjectId) {
        resetImageConversationStorage(session.subjectId);
      }
      
      const items = await listImageConversations();
      const normalizedItems = await recoverConversationHistory(items);
      const sorted = sortImageConversations(normalizedItems);
      
      conversationsRef.current = sorted;
      setConversations(sorted);
      
      const activeId = window.localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY);
      if (activeId && sorted.some((item) => item.id === activeId)) {
        setSelectedConversationId(activeId);
      } else {
        const fallbackId = pickFallbackConversationId(sorted);
        if (fallbackId) {
          setSelectedConversationId(fallbackId);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取会话记录失败";
      toast.error(message);
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  // Sync active id to localStorage
  useEffect(() => {
    if (selectedConversationId) {
      window.localStorage.setItem(
        ACTIVE_CONVERSATION_STORAGE_KEY,
        selectedConversationId,
      );
    } else {
      window.localStorage.removeItem(ACTIVE_CONVERSATION_STORAGE_KEY);
    }
  }, [selectedConversationId]);

  // Handle selected conversation deleted
  useEffect(() => {
    if (
      selectedConversationId &&
      !conversations.some(
        (conversation) => conversation.id === selectedConversationId,
      )
    ) {
      setSelectedConversationId(pickFallbackConversationId(conversations));
    }
  }, [conversations, selectedConversationId]);

  const persistConversation = async (conversation: ImageConversation) => {
    const nextConversations = sortImageConversations([
      conversation,
      ...conversationsRef.current.filter((item) => item.id !== conversation.id),
    ]);
    conversationsRef.current = nextConversations;
    setConversations(nextConversations);
    await saveImageConversation(conversation);
  };

  const updateConversation = useCallback(
    async (
      conversationId: string,
      updater: (current: ImageConversation | null) => ImageConversation,
      options: { persist?: boolean } = {},
    ) => {
      const current =
        conversationsRef.current.find((item) => item.id === conversationId) ??
        null;
      const nextConversation = updater(current);
      const nextConversations = sortImageConversations([
        nextConversation,
        ...conversationsRef.current.filter(
          (item) => item.id !== conversationId,
        ),
      ]);
      conversationsRef.current = nextConversations;
      setConversations(nextConversations);
      if (options.persist !== false) {
        await saveImageConversation(nextConversation);
      }
    },
    [],
  );

  const handleDeleteConversation = async (id: string) => {
    const nextConversations = conversations.filter((item) => item.id !== id);
    conversationsRef.current = nextConversations;
    setConversations(nextConversations);
    if (selectedConversationId === id) {
      setSelectedConversationId(pickFallbackConversationId(nextConversations));
    }

    try {
      await deleteImageConversation(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除会话失败";
      toast.error(message);
      const items = await listImageConversations();
      conversationsRef.current = items;
      setConversations(items);
    }
  };

  const handleDeleteTurnPart = async (
    conversationId: string,
    turnId: string,
    part: "prompt" | "results",
  ) => {
    const conversation = conversationsRef.current.find(
      (item) => item.id === conversationId,
    );
    if (!conversation) {
      return;
    }

    const turns = conversation.turns
      .map((turn) => {
        if (turn.id !== turnId) {
          return turn;
        }
        const nextTurn = {
          ...turn,
          prompt: part === "prompt" ? "" : turn.prompt,
          promptDeleted: part === "prompt" ? true : turn.promptDeleted,
          resultsDeleted: part === "results" ? true : turn.resultsDeleted,
          status:
            part === "results" && turn.status === "generating"
              ? ("error" as const)
              : turn.status,
          images:
            part === "results"
              ? turn.images.map((image) => ({
                  id: image.id,
                  status: "error" as const,
                  error: "生成结果已删除",
                }))
              : turn.images,
        };
        return nextTurn.promptDeleted && nextTurn.resultsDeleted
          ? null
          : nextTurn;
      })
      .filter((turn): turn is ImageTurn => Boolean(turn));

    if (turns.length === 0) {
      await handleDeleteConversation(conversationId);
      return;
    }

    const nextConversation = {
      ...conversation,
      updatedAt: new Date().toISOString(),
      turns,
    };
    await persistConversation(nextConversation);
  };

  const handleClearHistory = async () => {
    try {
      await clearImageConversations();
      conversationsRef.current = [];
      setConversations([]);
      setSelectedConversationId(null);
      toast.success("已清空历史记录");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "清空历史记录失败";
      toast.error(message);
    }
  };

  const handleRenameConversation = async (id: string, title: string) => {
    const nextConversations = conversations.map((item) =>
      item.id === id
        ? { ...item, title, updatedAt: new Date().toISOString() }
        : item,
    );
    conversationsRef.current = sortImageConversations(nextConversations);
    setConversations(conversationsRef.current);
    try {
      await renameImageConversation(id, title);
    } catch (error) {
      const message = error instanceof Error ? error.message : "重命名失败";
      toast.error(message);
    }
  };

  return {
    conversations,
    conversationsRef,
    setConversations,
    selectedConversation,
    selectedConversationId,
    setSelectedConversationId,
    isLoadingHistory,
    persistConversation,
    updateConversation,
    handleDeleteConversation,
    handleDeleteTurnPart,
    handleClearHistory,
    handleRenameConversation,
    loadHistory,
  };
}
