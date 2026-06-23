import { memo } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ImageHeaderProps {
  conversationsLength: number;
  handleCreateDraft: () => void;
  openClearHistoryConfirm: () => void;
}

export const ImageHeader = memo(function ImageHeader({
  conversationsLength,
  handleCreateDraft,
  openClearHistoryConfirm,
}: ImageHeaderProps) {
  return (
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
            className="h-8 rounded-full bg-stone-900/5 px-4 text-stone-700 shadow-none backdrop-blur-md transition-all hover:bg-stone-900/10 hover:scale-105 active:scale-95 dark:bg-white/10 dark:text-stone-200 dark:hover:bg-white/20"
            onClick={handleCreateDraft}
          >
            <Plus className="mr-1.5 size-3.5" />
            新创作
          </Button>
          <Button
            variant="ghost"
            className="h-8 w-8 rounded-full bg-stone-900/5 p-0 text-stone-500 shadow-none backdrop-blur-md transition-all hover:bg-red-50 hover:text-red-600 hover:scale-105 active:scale-95 disabled:opacity-50 dark:bg-white/10 dark:text-stone-400 dark:hover:bg-red-950/50 dark:hover:text-red-400"
            onClick={openClearHistoryConfirm}
            disabled={conversationsLength === 0}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
});
