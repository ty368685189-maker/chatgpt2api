import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  createImageEditTask,
  createImageGenerationTask,
  cancelImageTask,
  fetchImageTasks,
  resumeImagePoll,
  type ImageTask,
} from "@/lib/api";
import type { ImageConversation, ImageTurn } from "@/store/image-conversations";
import { taskDataToStoredImage, sleep, deriveTurnStatus, } from "../helpers"
import { dataUrlToFile, createId } from "../utils";;

const activeConversationQueueIds = new Set<string>();
let pollAbortController: AbortController | null = null;

interface UseImageTasksProps {
  conversationsRef: React.MutableRefObject<ImageConversation[]>;
  updateConversation: (
    id: string,
    updater: (current: ImageConversation | null) => ImageConversation,
  ) => Promise<void>;
  setSelectedConversationId: (id: string | null) => void;
  loadQuota?: () => Promise<void>;
  scrollResultsToLatest?: () => void;
  imageTimeoutRetrySecs: number;
}

export function useImageTasks({
  conversationsRef,
  updateConversation,
  setSelectedConversationId,
  loadQuota,
  scrollResultsToLatest,
  imageTimeoutRetrySecs,
}: UseImageTasksProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cancellingTaskIds, setCancellingTaskIds] = useState<Set<string>>(new Set());
  const [timeoutRetry, setTimeoutRetry] = useState<{
    conversationId: string;
    taskId: string;
    taskError: string;
  } | null>(null);

  const isTaskCancelling = useCallback(
    (taskId: string) => cancellingTaskIds.has(taskId),
    [cancellingTaskIds],
  );

  const runConversationQueue = useCallback(
    async (conversationId: string) => {
      if (activeConversationQueueIds.has(conversationId)) {
        return;
      }

      const snapshot = conversationsRef.current.find(
        (conversation) => conversation.id === conversationId,
      );
      const activeTurn = snapshot?.turns.find(
        (turn) =>
          (turn.status === "queued" || turn.status === "generating") &&
          turn.images.some((image) => image.status === "loading"),
      );
      if (!snapshot || !activeTurn) {
        return;
      }

      activeConversationQueueIds.add(conversationId);
      const applyTasks = async (tasks: ImageTask[]) => {
        const taskMap = new Map(tasks.map((task) => [task.id, task]));
        await updateConversation(conversationId, (current) => {
          const conversation = current ?? snapshot;
          const turns = conversation.turns.map((turn) => {
            if (turn.id !== activeTurn.id) {
              return turn;
            }
            const images = turn.images.map((image) => {
              const taskId = image.taskId || image.id;
              const task = taskMap.get(taskId);
              return task
                ? taskDataToStoredImage({ ...image, taskId }, task)
                : image;
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

      try {
        const referenceFiles = activeTurn.referenceImages.map((image, index) =>
          dataUrlToFile(
            image.dataUrl,
            image.name || `${activeTurn.id}-${index + 1}.png`,
            image.type,
          ),
        );
        if (activeTurn.mode === "edit" && referenceFiles.length === 0) {
          throw new Error("未找到可用于继续编辑的参考图");
        }

        const pendingImages = activeTurn.images.filter(
          (image) => image.status === "loading",
        );
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
        await applyTasks(submitted);

        let consecutiveErrors = 0;
        const retryingTaskIdsRef = new Set<string>();
        while (true) {
          const latestConversation = conversationsRef.current.find(
            (conversation) => conversation.id === conversationId,
          );
          const latestTurn = latestConversation?.turns.find(
            (turn) => turn.id === activeTurn.id,
          );
          const loadingTaskIds =
            latestTurn?.images.flatMap((image) =>
              image.status === "loading" && image.taskId ? [image.taskId] : [],
            ) || [];
          if (loadingTaskIds.length === 0) {
            break;
          }

          await sleep(2000);
          try {
            const taskList = await fetchImageTasks(loadingTaskIds);
            consecutiveErrors = 0;
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
                await applyTasks([timeoutTask]);
              } else {
                await applyTasks(taskList.items);
              }
            }
            if (taskList.missing_ids.length > 0 && latestTurn) {
              const missingImages = latestTurn.images.filter(
                (image) =>
                  image.status === "loading" &&
                  image.taskId &&
                  taskList.missing_ids.includes(image.taskId),
              );
              const resubmitted = await Promise.all(
                missingImages.map((image) =>
                  activeTurn.mode === "edit"
                    ? createImageEditTask(
                        image.taskId || image.id,
                        referenceFiles,
                        activeTurn.prompt,
                        activeTurn.model,
                        activeTurn.size,
                        activeTurn.quality,
                      )
                    : createImageGenerationTask(
                        image.taskId || image.id,
                        activeTurn.prompt,
                        activeTurn.model,
                        activeTurn.size,
                        activeTurn.quality,
                      ),
                ),
              );
              if (resubmitted.length > 0) {
                await applyTasks(resubmitted);
              }
            }
          } catch (pollError) {
            consecutiveErrors += 1;
            if (consecutiveErrors >= 10) {
              throw pollError;
            }
          }
        }

        if (loadQuota) await loadQuota();
      } catch (error) {
        const message = error instanceof Error ? error.message : "生成图片失败";
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
                      image.status === "loading"
                        ? { ...image, status: "error", error: message }
                        : image,
                    ),
                  }
                : turn,
            ),
          };
        });
      } finally {
        activeConversationQueueIds.delete(conversationId);
      }
    },
    [conversationsRef, updateConversation, loadQuota],
  );

  const handleGenerateImage = useCallback(
    async (options: {
      prompt: string;
      model: any;
      size: string;
      quality: string;
      count: number;
      conversationId: string | null;
      mode: "generate" | "edit";
      referenceImages?: any[];
    }) => {
      const { prompt, model, size, quality, count, conversationId, mode, referenceImages } = options;
      if (!prompt.trim()) return;

      setIsSubmitting(true);
      try {
        const images = Array.from({ length: count }).map(() => {
          const id = createId();
          return {
            id,
            taskId: id,
            status: "loading" as const,
          };
        });

        const turnId = createId();
        const turn: ImageTurn = {
          id: turnId,
          mode,
          prompt: prompt.trim(),
          model,
          size,
          quality,
          ratio: "auto",
          tier: "1k",
          createdAt: new Date().toISOString(),
          status: "queued",
          count: images.length,
          images,
          referenceImages: referenceImages || [],
        };

        const targetConversationId = conversationId || createId();
        const snapshot = conversationsRef.current.find(
          (c) => c.id === targetConversationId,
        );

        if (snapshot) {
          await updateConversation(targetConversationId, (current) => {
            const currentConv = current ?? snapshot;
            return {
              ...currentConv,
              updatedAt: new Date().toISOString(),
              turns: [...currentConv.turns, turn],
            };
          });
        } else {
          await updateConversation(targetConversationId, () => ({
            id: targetConversationId,
            title: "",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            turns: [turn],
          }));
          setSelectedConversationId(targetConversationId);
        }

        if (scrollResultsToLatest) scrollResultsToLatest();
        void runConversationQueue(targetConversationId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "提交生图失败";
        toast.error(message);
      } finally {
        setIsSubmitting(false);
      }
    },
    [conversationsRef, updateConversation, setSelectedConversationId, scrollResultsToLatest, runConversationQueue],
  );

  const handleCancelTask = useCallback(
    async (conversationId: string, taskId: string) => {
      if (!taskId || cancellingTaskIds.has(taskId)) {
        return;
      }
      setCancellingTaskIds((current) => new Set(current).add(taskId));
      try {
        const cancelled = await cancelImageTask(taskId);
        await updateConversation(conversationId, (current) => {
          const conversation =
            current ??
            conversationsRef.current.find((c) => c.id === conversationId);
          if (!conversation) return current!;
          return {
            ...conversation,
            updatedAt: new Date().toISOString(),
            turns: conversation.turns.map((turn) => {
              const hasTask = turn.images.some((image) => image.taskId === taskId);
              if (!hasTask) return turn;
              const images = turn.images.map((image) =>
                image.taskId === taskId
                  ? {
                      ...image,
                      status: "cancelled" as const,
                      error: cancelled.error || "任务已取消",
                      taskStatus: undefined,
                    }
                  : image,
              );
              const derived = deriveTurnStatus({ ...turn, images });
              return {
                ...turn,
                ...derived,
                images,
                status: "error" as const,
                error: "任务已取消",
              };
            }),
          };
        });
        toast.info("已停止生图");
      } catch (err) {
        const message = err instanceof Error ? err.message : "停止失败";
        toast.error(message);
      } finally {
        setCancellingTaskIds((current) => {
          const next = new Set(current);
          next.delete(taskId);
          return next;
        });
      }
    },
    [cancellingTaskIds, updateConversation, conversationsRef],
  );

  const handleContinueWait = useCallback(
    async (conversationId: string, taskId: string) => {
      try {
        await resumeImagePoll(taskId, imageTimeoutRetrySecs);
        setTimeoutRetry(null);
        await updateConversation(conversationId, (current) => {
          const conversation =
            current ??
            conversationsRef.current.find((c) => c.id === conversationId);
          if (!conversation) return current!;
          return {
            ...conversation,
            turns: conversation.turns.map((turn) => {
              const hasTask = turn.images.some((image) => image.taskId === taskId);
              if (!hasTask) return turn;
              const images = turn.images.map((image) =>
                image.taskId === taskId
                  ? {
                      ...image,
                      status: "loading" as const,
                      error: undefined,
                      taskStatus: "running" as const,
                    }
                  : image,
              );
              const derived = deriveTurnStatus({ ...turn, images });
              return {
                ...turn,
                ...derived,
                images,
              };
            }),
          };
        });
        toast.success("已恢复等待，请耐心等待生图完成");
        void runConversationQueue(conversationId);
      } catch (err) {
        const message = err instanceof Error ? err.message : "恢复等待失败";
        toast.error(message);
      }
    },
    [conversationsRef, updateConversation, imageTimeoutRetrySecs, runConversationQueue],
  );

  useEffect(() => {
    const conversations = conversationsRef.current;
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
  }, [conversationsRef.current, runConversationQueue]);

  return {
    isSubmitting,
    isTaskCancelling,
    timeoutRetry,
    setTimeoutRetry,
    handleGenerateImage,
    handleCancelTask,
    handleContinueWait,
    runConversationQueue,
  };
}
