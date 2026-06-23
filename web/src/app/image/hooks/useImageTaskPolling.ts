import { useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";
import {
  fetchImageTasks,
  createImageGenerationTask,
  createImageEditTask,
  type ImageTask,
} from "@/lib/api";
import type { ImageConversation, ImageTurn } from "@/store/image-conversations";
import { dataUrlToFile, taskDataToStoredImage, deriveTurnStatus } from "@/app/image/utils/image-utils";

interface TimeoutRetryData {
  conversationId: string;
  taskId: string;
  taskError: string;
}

interface UseImageTaskPollingProps {
  conversationsRef: React.MutableRefObject<ImageConversation[]>;
  updateConversation: (
    id: string,
    updater: (current: ImageConversation | null) => ImageConversation,
  ) => Promise<void>;
  setTimeoutRetry: (data: TimeoutRetryData | null) => void;
  loadQuota: () => Promise<void>;
  onPollingStateChange?: (activeIds: string[]) => void;
}

export function useImageTaskPolling({
  conversationsRef,
  updateConversation,
  setTimeoutRetry,
  loadQuota,
  onPollingStateChange,
}: UseImageTaskPollingProps) {
  const activeConversationQueueIdsRef = useRef<Set<string>>(new Set());
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

  const applyTasks = async (conversationId: string, activeTurnId: string, tasks: ImageTask[]) => {
    const taskMap = new Map(tasks.map((task) => [task.id, task]));
    await updateConversation(conversationId, (current) => {
      const snapshot = conversationsRef.current.find((c) => c.id === conversationId);
      const conversation = current ?? snapshot;
      if (!conversation) return current as unknown as ImageConversation;

      const turns = conversation.turns.map((turn) => {
        if (turn.id !== activeTurnId) return turn;
        const images = turn.images.map((image) => {
          const taskId = image.taskId || image.id;
          const task = taskMap.get(taskId);
          return task ? taskDataToStoredImage({ ...image, taskId }, task) : image;
        });
        const derived = deriveTurnStatus({ ...turn, images });
        return {
          ...turn,
          ...derived,
          images,
        };
      });

      return {
        ...conversation,
        updatedAt: new Date().toISOString(),
        turns,
      };
    });
  };

  const executePolling = async (conversationId: string, activeTurnId: string, abortSignal: AbortSignal) => {
    let consecutiveErrors = 0;
    const retryingTaskIdsRef = new Set<string>();

    const checkAndPoll = async () => {
      if (abortSignal.aborted) return;

      const latestConversation = conversationsRef.current.find((c) => c.id === conversationId);
      const latestTurn = latestConversation?.turns.find((t) => t.id === activeTurnId);
      
      const loadingTaskIds =
        latestTurn?.images.flatMap((image) =>
          image.status === "loading" && image.taskId ? [image.taskId] : [],
        ) || [];

      if (loadingTaskIds.length === 0) {
        // 完成轮询
        activeConversationQueueIdsRef.current.delete(conversationId);
        onPollingStateChange?.(Array.from(activeConversationQueueIdsRef.current));
        await loadQuota();
        return;
      }

      try {
        const taskList = await fetchImageTasks(loadingTaskIds);
        consecutiveErrors = 0;

        if (abortSignal.aborted) return;

        if (taskList.items.length > 0) {
          const timeoutTask = taskList.items.find(
            (task) =>
              task.status === "error" &&
              task.error?.includes("超时") &&
              task.conversation_id &&
              !retryingTaskIdsRef.has(task.id),
          );

          if (timeoutTask && timeoutTask.conversation_id) {
            retryingTaskIdsRef.add(timeoutTask.id);
            setTimeoutRetry({
              conversationId,
              taskId: timeoutTask.id,
              taskError: timeoutTask.error || "生图超时",
            });
            await applyTasks(conversationId, activeTurnId, [timeoutTask]);
          } else {
            await applyTasks(conversationId, activeTurnId, taskList.items);
          }
        }

        if (taskList.missing_ids.length > 0 && latestTurn) {
          const missingImages = latestTurn.images.filter(
            (image) =>
              image.status === "loading" &&
              image.taskId &&
              taskList.missing_ids.includes(image.taskId),
          );

          const referenceFiles = latestTurn.referenceImages.map((image, index) =>
            dataUrlToFile(
              image.dataUrl,
              image.name || `${latestTurn.id}-${index + 1}.png`,
              image.type,
            ),
          );

          const resubmitted = await Promise.all(
            missingImages.map((image) =>
              latestTurn.mode === "edit"
                ? createImageEditTask(
                    image.taskId || image.id,
                    referenceFiles,
                    latestTurn.prompt,
                    latestTurn.model,
                    latestTurn.size,
                    latestTurn.quality,
                  )
                : createImageGenerationTask(
                    image.taskId || image.id,
                    latestTurn.prompt,
                    latestTurn.model,
                    latestTurn.size,
                    latestTurn.quality,
                  ),
            ),
          );
          if (abortSignal.aborted) return;
          if (resubmitted.length > 0) {
            await applyTasks(conversationId, activeTurnId, resubmitted);
          }
        }
      } catch (pollError) {
        if (!abortSignal.aborted) {
          consecutiveErrors += 1;
          if (consecutiveErrors >= 10) {
            throw pollError;
          }
        }
      }

      // 递归调度下一次轮询，避免 while(true)
      if (!abortSignal.aborted) {
        setTimeout(checkAndPoll, 2000);
      }
    };

    // 启动循环
    setTimeout(checkAndPoll, 2000);
  };

  const startPolling = useCallback(
    async (conversationId: string) => {
      if (activeConversationQueueIdsRef.current.has(conversationId)) {
        return;
      }

      const snapshot = conversationsRef.current.find((c) => c.id === conversationId);
      const activeTurn = snapshot?.turns.find(
        (turn) =>
          (turn.status === "queued" || turn.status === "generating") &&
          turn.images.some((image) => image.status === "loading"),
      );

      if (!snapshot || !activeTurn) {
        return;
      }

      activeConversationQueueIdsRef.current.add(conversationId);
      onPollingStateChange?.(Array.from(activeConversationQueueIdsRef.current));

      // 取消旧的轮询（如果有的话）
      const oldController = abortControllersRef.current.get(conversationId);
      if (oldController) {
        oldController.abort();
      }
      const newController = new AbortController();
      abortControllersRef.current.set(conversationId, newController);

      try {
        const referenceFiles = activeTurn.referenceImages.map((image, index) =>
          dataUrlToFile(
            image.dataUrl,
            image.name || `${activeTurn.id}-${index + 1}.png`,
            image.type,
          ),
        );

        if (activeTurn.mode === "edit" && referenceFiles.length === 0) {
          throw new Error("未找到可编辑的参考图");
        }

        const pendingImages = activeTurn.images.filter((image) => image.status === "loading");

        const submitted = await Promise.all(
          pendingImages.map((image) => {
            const taskId = image.taskId || image.id;
            return activeTurn.mode === "edit"
              ? createImageEditTask(
                  taskId,
                  referenceFiles,
                  activeTurn.prompt,
                  activeTurn.model,
                  activeTurn.size,
                  activeTurn.quality,
                )
              : createImageGenerationTask(
                  taskId,
                  activeTurn.prompt,
                  activeTurn.model,
                  activeTurn.size,
                  activeTurn.quality,
                );
          }),
        );

        if (newController.signal.aborted) return;
        
        await applyTasks(conversationId, activeTurn.id, submitted);

        // 将死循环换为带有中止信号的定时递归轮询
        await executePolling(conversationId, activeTurn.id, newController.signal);
      } catch (error) {
        if (newController.signal.aborted) return;
        
        const message = error instanceof Error ? error.message : "生图失败";
        await updateConversation(conversationId, (current) => {
          const conversation = current ?? snapshot;
          return {
            ...conversation,
            updatedAt: new Date().toISOString(),
            turns: conversation.turns.map((turn) =>
              turn.id === activeTurn.id
                ? {
                    ...turn,
                    status: "error",
                    error: message,
                    images: turn.images.map((image) =>
                      image.status === "loading" ? { ...image, status: "error", error: message } : image,
                    ),
                  }
                : turn,
            ),
          };
        });
        toast.error(message);

        activeConversationQueueIdsRef.current.delete(conversationId);
        onPollingStateChange?.(Array.from(activeConversationQueueIdsRef.current));
      }
    },
    [conversationsRef, updateConversation, setTimeoutRetry, loadQuota, onPollingStateChange],
  );

  const stopPolling = useCallback((conversationId: string) => {
    const controller = abortControllersRef.current.get(conversationId);
    if (controller) {
      controller.abort();
      abortControllersRef.current.delete(conversationId);
    }
    activeConversationQueueIdsRef.current.delete(conversationId);
    onPollingStateChange?.(Array.from(activeConversationQueueIdsRef.current));
  }, [onPollingStateChange]);

  const stopAllPolling = useCallback(() => {
    abortControllersRef.current.forEach((controller) => controller.abort());
    abortControllersRef.current.clear();
    activeConversationQueueIdsRef.current.clear();
    onPollingStateChange?.(Array.from(activeConversationQueueIdsRef.current));
  }, [onPollingStateChange]);

  // 组件卸载时自动清理所有轮询
  useEffect(() => {
    return stopAllPolling;
  }, [stopAllPolling]);

  return {
    startPolling,
    stopPolling,
    stopAllPolling,
  };
}
