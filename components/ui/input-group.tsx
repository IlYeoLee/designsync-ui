import * as React from "react"

import { cn } from "@/lib/utils"

function InputGroup({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group"
      className={cn(
        "flex items-center rounded-[var(--ds-input-radius)] border border-input bg-background shadow-xs focus-within:border-ring focus-within:ring-[var(--ds-focus-ring-width)] focus-within:ring-ring/50",
        "[&>input]:border-0 [&>input]:shadow-none [&>input]:focus-visible:ring-0 [&>input]:focus-visible:border-transparent",
        "[&>textarea]:border-0 [&>textarea]:shadow-none [&>textarea]:focus-visible:ring-0",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

function InputGroupAddon({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group-addon"
      className={cn(
        "flex items-center px-3 text-sm text-muted-foreground select-none shrink-0",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export { InputGroup, InputGroupAddon }
