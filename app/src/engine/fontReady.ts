// Explicit font-readiness gate. We only use system font stacks today (no @font-face
// network fetch), so in practice `fonts.ready` resolves almost immediately on the main
// thread — but the gate is what makes that a guarantee rather than an assumption, and
// it's what a future custom web font would need without any other code changing.
//
// Deliberately main-thread only: `WorkerGlobalScope.fonts` (the Worker-context
// FontFaceSet) is a newer, less consistently implemented API, and empirically its
// `.ready` promise never resolved in the GIF export worker in manual testing — hanging
// every export indefinitely. Workers never touch this gate; they render with whatever
// system font is already available, which is correct for a stack with no network font
// to wait for in the first place.
export function waitForFontsReady(): Promise<void> {
  if (typeof document !== 'undefined' && document.fonts && 'ready' in document.fonts) {
    return document.fonts.ready.then(() => undefined)
  }
  return Promise.resolve()
}
