import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { GeneratePanel } from '@/components/GeneratePanel'

interface GenerateModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Dedicated modal for the generation flow. Opening it goes straight to the cost estimate →
 * confirm → progress → result; the panel owns starting fresh on open (and keeps a live run's
 * progress if it's still streaming).
 */
export function GenerateModal({ open, onOpenChange }: GenerateModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate Tickets</DialogTitle>
          <DialogDescription>Estimate the cost, then run generation in batches.</DialogDescription>
        </DialogHeader>
        {/* Fixed height so the modal never resizes between phases (estimate → running → done). */}
        <DialogBody className="h-[360px]">
          <GeneratePanel
            onViewResults={() => onOpenChange(false)}
            onClose={() => onOpenChange(false)}
          />
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
