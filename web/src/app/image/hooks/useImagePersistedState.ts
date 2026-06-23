import { useEffect, useState } from "react";
import type { ImageModel } from "@/lib/api";

const IMAGE_RATIO_STORAGE_KEY = "chatgpt2api_image_ratio";
const IMAGE_TIER_STORAGE_KEY = "chatgpt2api_image_tier";
const IMAGE_QUALITY_STORAGE_KEY = "chatgpt2api_image_quality";
const IMAGE_COUNT_STORAGE_KEY = "chatgpt2api_image_count";
const IMAGE_MODEL_STORAGE_KEY = "chatgpt2api_image_model";
const ACTIVE_CONVERSATION_STORAGE_KEY = "chatgpt2api_image_active_conversation";

export function useImagePersistedState(availableModels: ImageModel[]) {
  const [imageRatio, setImageRatio] = useState("1:1");
  const [imageTier, setImageTier] = useState("1k");
  const [imageQuality, setImageQuality] = useState("auto");
  const [imageCount, setImageCount] = useState("1");
  const [imageModel, setImageModel] = useState<ImageModel>(availableModels[0] || "gpt-image-2");
  const [lastConversationId, setLastConversationId] = useState<string | null>(null);

  // Initialize from localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      const ratio = window.localStorage.getItem(IMAGE_RATIO_STORAGE_KEY);
      if (ratio) setImageRatio(ratio);

      const tier = window.localStorage.getItem(IMAGE_TIER_STORAGE_KEY);
      if (tier) setImageTier(tier);

      const quality = window.localStorage.getItem(IMAGE_QUALITY_STORAGE_KEY);
      if (quality) setImageQuality(quality);

      const count = window.localStorage.getItem(IMAGE_COUNT_STORAGE_KEY);
      if (count) setImageCount(count);

      const model = window.localStorage.getItem(IMAGE_MODEL_STORAGE_KEY);
      const normalizedModel = (model || "").trim();
      if (normalizedModel && availableModels.includes(normalizedModel)) {
        setImageModel(normalizedModel);
      } else if (availableModels.length > 0) {
        setImageModel(availableModels[0]);
      }

      const activeId = window.localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY);
      if (activeId) setLastConversationId(activeId);
    }
  }, [availableModels]);

  // Sync to localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(IMAGE_RATIO_STORAGE_KEY, imageRatio);
      window.localStorage.setItem(IMAGE_TIER_STORAGE_KEY, imageTier);
      window.localStorage.setItem(IMAGE_QUALITY_STORAGE_KEY, imageQuality);
      window.localStorage.setItem(IMAGE_COUNT_STORAGE_KEY, imageCount);
      window.localStorage.setItem(IMAGE_MODEL_STORAGE_KEY, imageModel);
    }
  }, [imageRatio, imageTier, imageQuality, imageCount, imageModel]);

  const updateLastConversationId = (id: string | null) => {
    setLastConversationId(id);
    if (typeof window !== "undefined") {
      if (id) {
        window.localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, id);
      } else {
        window.localStorage.removeItem(ACTIVE_CONVERSATION_STORAGE_KEY);
      }
    }
  };

  return {
    imageRatio,
    setImageRatio,
    imageTier,
    setImageTier,
    imageQuality,
    setImageQuality,
    imageCount,
    setImageCount,
    imageModel,
    setImageModel,
    lastConversationId,
    updateLastConversationId,
  };
}
