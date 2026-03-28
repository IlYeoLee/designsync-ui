import * as React from "react"

import { cn } from "@/lib/utils"

function Item({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item"
      className={cn(
        "flex items-start gap-[var(--ds-internal-gap)] rounded-[var(--ds-element-radius)] p-[var(--ds-internal-gap)] transition-colors",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

function ItemMedia({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-media"
      className={cn("flex shrink-0 items-center justify-center", className)}
      {...props}
    >
      {children}
    </div>
  )
}

function ItemContent({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-content"
      className={cn("flex flex-1 flex-col gap-0.5 min-w-0", className)}
      {...props}
    >
      {children}
    </div>
  )
}

function ItemTitle({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="item-title"
      className={cn("text-sm font-medium text-foreground leading-tight", className)}
      {...props}
    />
  )
}

function ItemDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="item-description"
      className={cn("text-xs text-muted-foreground leading-normal", className)}
      {...props}
    />
  )
}

function ItemActions({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-actions"
      className={cn("ml-auto flex shrink-0 items-center gap-1", className)}
      {...props}
    >
      {children}
    </div>
  )
}

export { Item, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions }
