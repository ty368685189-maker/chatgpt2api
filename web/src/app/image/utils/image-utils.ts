import { type StoredImage, type ImageTurn } from "@/store/image-conversations";
import webConfig from "@/constants/common-env";
import { type Account, type ImageTask } from "@/lib/api";

// 管理 Blob URL，包含最大数量限制避免内存泄漏
class B64BlobUrlManager {
  private cache = new Map<string, string>();
  private readonly MAX_CACHE_SIZE = 100;

  get(b64Json: string): string {
    let url = this.cache.get(b64Json);
    if (url) return url;

    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        const oldUrl = this.cache.get(firstKey);
        if (oldUrl) URL.revokeObjectURL(oldUrl);
        this.cache.delete(firstKey);
      }
    }

    const binary = atob(b64Json);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: "image/png" });
    url = URL.createObjectURL(blob);
    this.cache.set(b64Json, url);
    return url;
  }
}

export const b64BlobUrlManager = new B64BlobUrlManager();

export function getStoredImageSrc(image: StoredImage) {
  if (image.b64_json) {
    return b64BlobUrlManager.get(image.b64_json);
  }
  return image.url || "";
}

export function parseImageSize(size: string) {
  const match = size.match(/^(\d+)x(\d+)$/);
  return match
    ? { width: match[1], height: match[2] }
    : { width: "1024", height: "1024" };
}

export function clampImageCount(value: string) {
  return String(Math.min(100, Math.max(1, Math.floor(Number(value) || 1))));
}

export function formatAvailableQuota(accounts: Account[]) {
  const availableAccounts = accounts.filter((account) => account.status !== "禁用");
  return String(
    availableAccounts.reduce((sum, account) => sum + Math.max(0, account.quota), 0),
  );
}

export function buildConversationTitle(prompt: string) {
  const trimmed = prompt.trim();
  if (trimmed.length <= 12) {
    return trimmed;
  }
  return `${trimmed.slice(0, 12)}...`;
}

export function formatConversationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取参考图失败"));
    reader.readAsDataURL(file);
  });
}

export function dataUrlToFile(dataUrl: string, fileName: string, mimeType?: string) {
  const [header, content] = dataUrl.split(",", 2);
  const matchedMimeType = header.match(/data:(.*?);base64/)?.[1];
  const binary = atob(content || "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], fileName, {
    type: mimeType || matchedMimeType || "image/png",
  });
}

export async function getStoredImageBlob(image: StoredImage) {
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

export function deriveTurnStatus(turn: ImageTurn): Pick<ImageTurn, "status" | "error"> {
  const loadingCount = turn.images.filter((image) => image.status === "loading").length;
  const failedCount = turn.images.filter(
    (image) => image.status === "error" || image.status === "cancelled",
  ).length;
  const successCount = turn.images.filter((image) => image.status === "success").length;
  
  if (loadingCount > 0) {
    const hasRunning = turn.images.some((image) => image.taskStatus === "running");
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
  return { status: "success", error: undefined };
}

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
  // elapsedSecs 仅使用后端返回的值，确保计时从 image_stream_resolve_start 开始
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
