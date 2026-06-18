import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "border-input file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground flex h-11 w-full min-w-0 rounded-2xl border bg-white px-4 py-2 text-sm text-foreground shadow-sm transition-[color,box-shadow] outline-none appearance-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 focus-visible:border-stone-300 focus-visible:ring-[3px] focus-visible:ring-stone-200/80 dark:bg-stone-900 dark:focus-visible:border-stone-600 dark:focus-visible:ring-stone-700/60 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
