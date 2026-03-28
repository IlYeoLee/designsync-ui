"use client"

import * as React from "react"
import { CheckIcon, ChevronsUpDown, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/registry/new-york/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/registry/new-york/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/registry/new-york/ui/popover"
import { Badge } from "@/registry/new-york/ui/badge"

/* ─────────────────────────────────────────────────────────────────────────────
 * Combobox — Autocomplete select with search, single or multi-select.
 *
 * Composes existing shadcn components: Popover, Command, Button, Badge.
 *
 * Usage (single):
 *   <Combobox
 *     options={[{ value: "react", label: "React" }, ...]}
 *     value={value}
 *     onValueChange={setValue}
 *     placeholder="Select framework..."
 *     searchPlaceholder="Search..."
 *     emptyMessage="No results."
 *   />
 *
 * Usage (multi):
 *   <Combobox
 *     options={options}
 *     value={values}
 *     onValueChange={setValues}
 *     multiple
 *   />
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ComboboxOption {
  value: string
  label: string
  disabled?: boolean
}

interface ComboboxSingleProps {
  multiple?: false
  value?: string
  onValueChange?: (value: string) => void
}

interface ComboboxMultiProps {
  multiple: true
  value?: string[]
  onValueChange?: (value: string[]) => void
}

type ComboboxProps = (ComboboxSingleProps | ComboboxMultiProps) & {
  options: ComboboxOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  className?: string
  disabled?: boolean
}

function Combobox({
  options,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyMessage = "No results.",
  className,
  disabled,
  ...props
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false)

  const isMulti = props.multiple === true

  // Normalize value
  const selectedValues: string[] = isMulti
    ? (props.value as string[]) ?? []
    : props.value
      ? [props.value as string]
      : []

  function handleSelect(optionValue: string) {
    if (isMulti) {
      const current = (props.value as string[]) ?? []
      const next = current.includes(optionValue)
        ? current.filter((v) => v !== optionValue)
        : [...current, optionValue]
      ;(props.onValueChange as (v: string[]) => void)?.(next)
    } else {
      const isSame = (props.value as string) === optionValue
      ;(props.onValueChange as (v: string) => void)?.(isSame ? "" : optionValue)
      setOpen(false)
    }
  }

  function handleRemove(optionValue: string) {
    if (isMulti) {
      const current = (props.value as string[]) ?? []
      ;(props.onValueChange as (v: string[]) => void)?.(
        current.filter((v) => v !== optionValue)
      )
    }
  }

  // Display label
  const displayLabel = isMulti
    ? null
    : options.find((o) => o.value === (props.value as string))?.label

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          data-slot="combobox"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal rounded-[var(--ds-input-radius)]",
            !displayLabel && !selectedValues.length && "text-muted-foreground",
            className
          )}
        >
          {isMulti ? (
            selectedValues.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {selectedValues.map((v) => {
                  const opt = options.find((o) => o.value === v)
                  return (
                    <Badge key={v} variant="secondary" className="gap-0.5 pr-0.5">
                      {opt?.label ?? v}
                      <button
                        type="button"
                        className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRemove(v)
                        }}
                      >
                        <XIcon className="size-3" />
                        <span className="sr-only">Remove</span>
                      </button>
                    </Badge>
                  )
                })}
              </div>
            ) : (
              placeholder
            )
          ) : (
            displayLabel ?? placeholder
          )}
          <ChevronsUpDown className="ml-auto size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  keywords={[option.label]}
                  disabled={option.disabled}
                  onSelect={() => handleSelect(option.value)}
                >
                  {option.label}
                  <CheckIcon
                    className={cn(
                      "ml-auto size-4",
                      selectedValues.includes(option.value)
                        ? "opacity-100"
                        : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export { Combobox, type ComboboxOption as ComboboxOptionType }
