import webConfig from "@/constants/common-env";
import type { Account, ImageModel, Model } from "@/lib/api";
import type { StoredImage, StoredReferenceImage } from "@/store/image-conversations";

export const SCROLL_POSITIONS_STORAGE_KEY = "chatgpt2api:image_scroll_positions";

export function loadScrollPositions(): Map<string, number> {
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

export function saveScrollPositions(positions: Map<string, number>) {
  if (typeof window === "undefined") return;
  try {
    const obj: Record<string, number> = {};
    positions.forEach((value, key) => {
      obj[key] = value;
    });
    window.sessionStorage.setItem(
      SCROLL_POSITIONS_STORAGE_KEY,
      JSON.stringify(obj),
    );
  } catch {
    // sessionStorage may be full or unavailable
  }
}

export function clampImageCount(value: string) {
  return String(Math.min(100, Math.max(1, Math.floor(Number(value) || 1))));
}

export function parseImageSize(size: string) {
  const match = size.match(/^(\d+)x(\d+)$/);
  return match
    ? { width: match[1], height: match[2] }
    : { width: "1024", height: "1024" };
}

export function getResultsDistanceFromBottom(element: HTMLElement) {
  return element.scrollHeight - element.scrollTop - element.clientHeight;
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

export function formatAvailableQuota(accounts: Account[]) {
  const availableAccounts = accounts.filter(
    (account) => account.status !== "禁用",
  );
  return String(
    availableAccounts.reduce(
      (sum, account) => sum + Math.max(0, account.quota),
      0,
    ),
  );
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

export function filterImageModels(items: Model[]): ImageModel[] {
  return items
    .map((item) => String(item.id || "").trim())
    .filter(
      (id, index, list) =>
        id.toLowerCase().includes("image") && list.indexOf(id) === index,
    );
}

export function normalizeStoredImageModel(
  value: string | null,
  availableModels: ImageModel[],
): ImageModel {
  const normalized = String(value || "").trim();
  if (normalized && availableModels.includes(normalized)) {
    return normalized;
  }
  return availableModels[0] || "gpt-image-2";
}

export function buildReferenceImageFromResult(
  image: StoredImage,
  fileName: string,
): StoredReferenceImage | null {
  if (!image.b64_json) {
    return null;
  }

  return {
    name: fileName,
    type: "image/png",
    dataUrl: `data:image/png;base64,${image.b64_json}`,
  };
}

export async function fetchImageAsFile(url: string, fileName: string) {
  let targetUrl = url;
  const filesIndex = url.indexOf("/files/");
  if (filesIndex !== -1) {
    const relativePath = url.substring(filesIndex);
    const baseUrl = webConfig.apiUrl.replace(/\/$/, "");
    targetUrl = `${baseUrl}${relativePath}`;
  }
  const response = await fetch(targetUrl);
  if (!response.ok) {
    throw new Error("读取结果图失败");
  }
  const blob = await response.blob();
  return new File([blob], fileName, { type: blob.type || "image/png" });
}

export async function buildReferenceImageFromStoredImage(
  image: StoredImage,
  fileName: string,
) {
  const direct = buildReferenceImageFromResult(image, fileName);
  if (direct) {
    return {
      referenceImage: direct,
      file: dataUrlToFile(direct.dataUrl, direct.name, direct.type),
    };
  }

  if (!image.url) {
    return null;
  }
  const file = await fetchImageAsFile(image.url, fileName);
  return {
    referenceImage: {
      name: file.name,
      type: file.type || "image/png",
      dataUrl: await readFileAsDataUrl(file),
    },
    file,
  };
}
