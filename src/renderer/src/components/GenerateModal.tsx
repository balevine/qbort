import { useEffect } from 'react'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { GeneratePanel } from '@/components/GeneratePanel'
import { useGeneration } from '@/state/GenerationContext'

interface GenerateModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Dedicated modal for the generation flow: estimate → confirm → progress → result. */
export function GenerateModal({ open, onOpenChange }: GenerateModalProps) {
  const { phase, reset } = useGeneration()

  // Each time the modal opens, start fresh — unless a run is still in flight, in which
  // case we want to show its live progress.
  useEffect(() => {
    if (open && phase !== 'running') reset()
    // Only react to open transitions; reacting to `phase` would wipe the result on completion.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate Tickets</DialogTitle>
          <DialogDescription>Estimate the cost, then run generation in batches.</DialogDescription>
        </DialogHeader>
        {/* Fixed height so the modal never resizes between phases (estimate → running → done). */}
        <DialogBody className="h-[360px]">
          <GeneratePanel onViewResults={() => onOpenChange(false)} />
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
