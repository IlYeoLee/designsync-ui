import * as React from "react"

import { cn } from "@/lib/utils"

function Empty({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-[var(--ds-card-radius)] border border-dashed border-border p-[var(--ds-card-padding)] text-center",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

function EmptyIcon({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-icon"
      className={cn("text-muted-foreground [&_svg]:size-10", className)}
      {...props}
    >
      {children}
    </div>
  )
}

function EmptyTitle({
  className,
  ...props
}: React.ComponentProps<"h3">) {
  return (
    <h3
      data-slot="empty-title"
      className={cn("text-base font-semibold text-foreground", className)}
      {...props}
    />
  )
}

function EmptyDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="empty-description"
      className={cn("text-sm text-muted-foreground max-w-sm", className)}
      {...props}
    />
  )
}

function EmptyActions({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-actions"
      className={cn("mt-2 flex items-center gap-2", className)}
      {...props}
    />
  )
}

export { Empty, EmptyIcon, EmptyTitle, EmptyDescription, EmptyActions }
