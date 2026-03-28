import * as React from "react"

import { cn } from "@/lib/utils"

function Kbd({
  className,
  children,
  ...props
}: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground select-none",
        className
      )}
      {...props}
    >
      {children}
    </kbd>
  )
}

export { Kbd }
