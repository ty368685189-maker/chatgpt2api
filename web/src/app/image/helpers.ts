import { saveImageConversations } from "@/store/image-conversations";
import type { ImageConversation, ImageTurn, StoredImage } from "@/store/image-conversations";
import type { ImageTask } from "@/lib/api";
import { fetchImageTasks } from "@/lib/api";

export function taskDataToStoredImage(
  image: StoredImage,
  task: ImageTask,
): StoredImage {
  if (task.status === "success") {
    const first = task.data?.[0];
    if (!first?.b64_json && !first?.url) {
      return {
        ...image,
        taskId: task.id,
        status: "error",
        taskStatus: undefined,
        progress: undefined,
        error: "未返回图片数据",
      };
    }
    return {
      ...image,
      taskId: task.id,
      status: "success",
      taskStatus: undefined,
      progress: undefined,
      b64_json: first.b64_json,
      url: first.url,
      revised_prompt: first.revised_prompt,
      error: undefined,
      durationMs: task.duration_ms,
    };
  }

  if (task.status === "error") {
    return {
      ...image,
      taskId: task.id,
      status: "error",
      taskStatus: undefined,
      progress: undefined,
      error: task.error || "生成失败",
      durationMs: task.duration_ms,
    };
  }

  if (task.status === "cancelled") {
    return {
      ...image,
      taskId: task.id,
      status: "cancelled",
      taskStatus: undefined,
      progress: undefined,
      error: task.error || "任务已取消",
      durationMs: task.duration_ms,
    };
  }

  const newTaskStatus =
    task.status === "queued"
      ? "queued"
      : task.status === "running"
        ? "running"
        : image.taskStatus;
  const shouldSetStartTime = newTaskStatus === "running" && !image.startTime;
  const startTime = shouldSetStartTime ? Date.now() : image.startTime;
  const elapsedSecs =
    newTaskStatus === "running" && typeof task.elapsed_secs === "number"
      ? task.elapsed_secs
      : undefined;

  return {
    ...image,
    taskId: task.id,
    status: "loading",
    taskStatus: newTaskStatus,
    progress: task.progress || image.progress,
    error: undefined,
    startTime,
    elapsedSecs,
    elapsedUpdatedAt: elapsedSecs != null ? Date.now() : undefined,
  };
}

export function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function pickFallbackConversationId(conversations: ImageConversation[]) {
  const activeConversation = conversations.find((conversation) =>
    conversation.turns.some(
      (turn) => turn.status === "queued" || turn.status === "generating",
    ),
  );
  return activeConversation?.id ?? conversations[0]?.id ?? null;
}

export function sortImageConversations(conversations: ImageConversation[]) {
  return [...conversations].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export function deriveTurnStatus(
  turn: ImageTurn,
): Pick<ImageTurn, "status" | "error"> {
  const loadingCount = turn.images.filter(
    (image) => image.status === "loading",
  ).length;
  const failedCount = turn.images.filter(
    (image) => image.status === "error" || image.status === "cancelled",
  ).length;
  const successCount = turn.images.filter(
    (image) => image.status === "success",
  ).length;
  if (loadingCount > 0) {
    const hasRunning = turn.images.some(
      (image) => image.taskStatus === "running",
    );
    if (hasRunning) {
      return { status: "generating", error: undefined };
    }
    return {
      status: turn.status === "queued" ? "queued" : "generating",
      error: undefined,
    };
  }
  if (failedCount > 0) {
    return { status: "error", error: `其中 ${failedCount} 张未成功生成` };
  }
  if (successCount > 0) {
    return { status: "success", error: undefined };
  }
  return { status: "success", error: undefined };
}

export async function syncConversationImageTasks(items: ImageConversation[]) {
  const taskIds = Array.from(
    new Set(
      items.flatMap((conversation) =>
        conversation.turns.flatMap((turn) =>
          turn.resultsDeleted
            ? []
            : turn.images.flatMap((image) =>
                image.status === "loading" ||
                (image.status === "error" && image.taskId)
                  ? [image.taskId!]
                  : [],
              ),
        ),
      ),
    ),
  );
  if (taskIds.length === 0) {
    return items;
  }

  let taskList: Awaited<ReturnType<typeof fetchImageTasks>>;
  try {
    taskList = await fetchImageTasks(taskIds);
  } catch {
    return items;
  }
  const taskMap = new Map(taskList.items.map((task) => [task.id, task]));
  let changed = false;
  const normalized = items.map((conversation) => {
    const turns = conversation.turns.map((turn) => {
      let turnChanged = false;
      const images = turn.images.map((image) => {
        if (!image.taskId) {
          return image;
        }
        if (image.status !== "loading" && image.status !== "error") {
          return image;
        }
        const task = taskMap.get(image.taskId);
        if (!task) {
          return image;
        }
        const nextImage = taskDataToStoredImage(image, task);
        if (nextImage !== image) {
          turnChanged = true;
        }
        return nextImage;
      });
      if (!turnChanged) {
        return turn;
      }
      changed = true;
      const derived = deriveTurnStatus({ ...turn, images });
      return {
        ...turn,
        ...derived,
        images,
      };
    });
    if (
      turns === conversation.turns ||
      !turns.some((turn, index) => turn !== conversation.turns[index])
    ) {
      return conversation;
    }
    return {
      ...conversation,
      turns,
      updatedAt: new Date().toISOString(),
    };
  });

  if (changed) {
    await saveImageConversations(normalized);
  }
  return normalized;
}

export async function recoverConversationHistory(items: ImageConversation[]) {
  let changed = false;
  const normalized = items.map((conversation) => {
    const turns = conversation.turns.map((turn) => {
      if (
        turn.status !== "queued" &&
        turn.status !== "generating" &&
        turn.status !== "error"
      ) {
        return turn;
      }

      let turnChanged = false;
      const images = turn.images.map((image) => {
        if (image.status !== "loading" || image.taskId) {
          return image;
        }
        turnChanged = true;
        return {
          ...image,
          status: "error" as const,
          error: "页面刷新或任务中断，未找到可恢复的任务 ID",
        };
      });
      const derived = deriveTurnStatus({ ...turn, images });
      if (
        !turnChanged &&
        derived.status === turn.status &&
        derived.error === turn.error
      ) {
        return turn;
      }
      changed = true;
      return {
        ...turn,
        ...derived,
        images,
      };
    });

    if (!turns.some((turn, index) => turn !== conversation.turns[index])) {
      return conversation;
    }

    return {
      ...conversation,
      turns,
      updatedAt: new Date().toISOString(),
    };
  });

  if (changed) {
    await saveImageConversations(normalized);
  }

  return syncConversationImageTasks(normalized);
}
