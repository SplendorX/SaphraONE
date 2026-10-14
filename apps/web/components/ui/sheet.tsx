"use client"

import * as React from "react"
import { Dialog as SheetPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "fixed z-50 flex flex-col gap-4 bg-popover bg-clip-padding text-sm text-popover-foreground shadow-lg transition duration-200 ease-in-out data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-[side=bottom]:data-open:slide-in-from-bottom-10 data-[side=left]:data-open:slide-in-from-left-10 data-[side=right]:data-open:slide-in-from-right-10 data-[side=top]:data-open:slide-in-from-top-10 data-closed:animate-out data-closed:fade-out-0 data-[side=bottom]:data-closed:slide-out-to-bottom-10 data-[side=left]:data-closed:slide-out-to-left-10 data-[side=right]:data-closed:slide-out-to-right-10 data-[side=top]:data-closed:slide-out-to-top-10",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close data-slot="sheet-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-3 right-3"
              size="icon-sm"
            >
              <XIcon
              />
              <span className="sr-only">Close</span>
            </Button>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

/** Pulled down this far (of the sheet's height), or flicked, a sheet closes. */
const grabberCloseFraction = 0.25
const grabberFlickVelocity = 0.6 // px per ms

/**
 * The handle at the top of a bottom sheet. Hold it and the sheet follows the
 * finger down; let go past a quarter of its height (or with a flick) and it
 * closes, otherwise it springs back. `className` styles the visible bar.
 */
function SheetGrabber({ className }: { className?: string }) {
  const closeRef = React.useRef<HTMLButtonElement>(null)
  const drag = React.useRef<{
    content: HTMLElement
    lastT: number
    lastY: number
    offset: number
    startY: number
    velocity: number
  } | null>(null)

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const content = event.currentTarget.closest<HTMLElement>('[data-slot="sheet-content"]')
    if (!content || (event.pointerType === "mouse" && event.button !== 0)) return
    event.currentTarget.setPointerCapture(event.pointerId)
    content.style.transition = "none"
    drag.current = {
      content,
      lastT: event.timeStamp,
      lastY: event.clientY,
      offset: 0,
      startY: event.clientY,
      velocity: 0,
    }
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current
    if (!state) return
    const delta = event.clientY - state.startY
    // Down follows the finger; up gives a little, then stops.
    state.offset = delta > 0 ? delta : delta / 6
    const elapsed = event.timeStamp - state.lastT
    if (elapsed > 0) state.velocity = (event.clientY - state.lastY) / elapsed
    state.lastY = event.clientY
    state.lastT = event.timeStamp
    state.content.style.transform = `translateY(${state.offset}px)`
  }

  function onPointerEnd() {
    const state = drag.current
    drag.current = null
    if (!state) return
    const { content, offset, velocity } = state
    const closing =
      offset > content.offsetHeight * grabberCloseFraction ||
      (offset > 24 && velocity > grabberFlickVelocity)
    content.style.transition = "transform 180ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease"
    if (!closing) {
      content.style.transform = ""
      window.setTimeout(() => {
        content.style.transition = ""
      }, 200)
      return
    }
    // Off the bottom and faded, so the sheet's own exit animation (which
    // starts from here) has nothing left to show.
    content.style.transform = "translateY(100%)"
    content.style.opacity = "0"
    window.setTimeout(() => {
      closeRef.current?.click()
      // Still on screen if the host kept it open: put it back.
      window.setTimeout(() => {
        content.style.transition = ""
        content.style.transform = ""
        content.style.opacity = ""
      }, 400)
    }, 170)
  }

  return (
    <>
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-0 z-20 flex h-8 w-40 -translate-x-1/2 cursor-grab touch-none select-none justify-center pt-2 active:cursor-grabbing"
        data-slot="sheet-grabber"
        onPointerCancel={onPointerEnd}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
      >
        <span
          className={cn(
            "pointer-events-none h-1.5 w-10 rounded-full bg-foreground/20",
            className
          )}
        />
      </div>
      <SheetPrimitive.Close asChild>
        <button aria-hidden="true" hidden ref={closeRef} tabIndex={-1} type="button" />
      </SheetPrimitive.Close>
    </>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-0.5 p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        "font-heading text-base font-medium text-foreground",
        className
      )}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  SheetGrabber,
}
