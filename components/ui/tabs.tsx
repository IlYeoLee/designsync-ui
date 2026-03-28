"use client"

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"
import { motion } from "framer-motion"

import { cn } from "@/lib/utils"

const TabsVariantContext = React.createContext<"pill" | "underline">("pill")
const TabsIdContext = React.createContext<string>("")

function Tabs({
  id,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root> & { id?: string }) {
  const autoId = React.useId()
  const tabsId = id || autoId
  return (
    <TabsIdContext.Provider value={tabsId}>
      <TabsPrimitive.Root data-slot="tabs" {...props} />
    </TabsIdContext.Provider>
  )
}

function TabsList({
  className,
  variant = "pill",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & {
  variant?: "pill" | "underline"
}) {
  return (
    <TabsVariantContext.Provider value={variant}>
      <TabsPrimitive.List
        data-slot="tabs-list"
        data-variant={variant}
        className={cn(
          "inline-flex items-center justify-center",
          variant === "pill" &&
            "bg-muted text-muted-foreground h-[var(--ds-input-h)] w-fit rounded-[var(--ds-card-radius)] p-1",
          variant === "underline" &&
            "relative w-full border-b border-border gap-0 bg-transparent p-0 rounded-none h-auto",
          className
        )}
        {...props}
      />
    </TabsVariantContext.Provider>
  )
}

function TabsTrigger({
  className,
  value,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const variant = React.useContext(TabsVariantContext)
  const tabsId = React.useContext(TabsIdContext)

  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      value={value}
      className={cn(
        "relative inline-flex items-center justify-center gap-1.5 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-[var(--ds-focus-ring-width)] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        variant === "pill" &&
          "rounded-[var(--ds-element-radius)] px-2 py-1 data-[state=active]:bg-background data-[state=active]:shadow-xs text-foreground focus-visible:border-ring focus-visible:outline-ring focus-visible:outline-1",
        variant === "underline" &&
          "px-4 py-2.5 rounded-none text-muted-foreground hover:text-foreground data-[state=active]:text-foreground",
        className
      )}
      {...props}
    >
      {children}
      {variant === "underline" && (
        <TabsUnderlineIndicator layoutId={`tabs-underline-${tabsId}`} />
      )}
    </TabsPrimitive.Trigger>
  )
}

/** Animated underline — visible only when parent trigger is active (via CSS) */
function TabsUnderlineIndicator({ layoutId }: { layoutId: string }) {
  return (
    <motion.div
      layoutId={layoutId}
      className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary hidden [[data-state=active]>&]:block"
      style={{ borderRadius: 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      data-slot="tabs-underline"
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
