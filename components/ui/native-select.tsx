import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { ChevronDownIcon } from "lucide-react"

import { cn } from "@/lib/utils"

const nativeSelectVariants = cva(
  "flex w-full appearance-none rounded-[var(--ds-input-radius)] border border-input bg-background text-foreground shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-[var(--ds-focus-ring-width)] focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      size: {
        default: "h-[var(--ds-input-h)] px-3 py-1 text-sm",
        sm: "h-[var(--ds-button-h-sm)] px-2 py-1 text-xs",
        lg: "h-[var(--ds-button-h-lg)] px-4 py-2 text-sm",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

function NativeSelect({
  className,
  size,
  children,
  ...props
}: Omit<React.ComponentProps<"select">, "size"> & VariantProps<typeof nativeSelectVariants>) {
  return (
    <div data-slot="native-select" className="relative">
      <select
        className={cn(nativeSelectVariants({ size, className }), "pr-8")}
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  )
}

export { NativeSelect, nativeSelectVariants }
