"use client";

import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { Input } from "@repo/ui/input";
import {
  ModalBody,
  ModalClose,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalIconButton,
  ModalRoot,
  ModalSteps,
  ModalTitle,
  ModalTrigger,
} from "@repo/ui/modal";
import { Maximize2, Minus, Trash2 } from "lucide-react";
import { useState } from "react";

const STEPS = ["Step Name", "Step Name", "Step Name"];

export function ModalDemo() {
  const [step, setStep] = useState(0);

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Default header, footer with both slots. */}
      <ModalRoot>
        <ModalTrigger asChild>
          <Button
            variant="outline"
            tone="grey"
            data-testid="modal-open-default"
          >
            Default
          </Button>
        </ModalTrigger>
        <ModalContent data-testid="modal-default">
          <ModalHeader>
            <ModalTitle>Title</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <ModalDescription>
              The header, footer and radius come from the Pencil frame. The body
              is whatever the feature puts here.
            </ModalDescription>
          </ModalBody>
          <ModalFooter
            left={
              <Button variant="outline" tone="grey" startIcon={<Trash2 />}>
                Delete
              </Button>
            }
          >
            <ModalClose asChild>
              <Button variant="outline" tone="grey">
                Cancel
              </Button>
            </ModalClose>
            <Button>Active</Button>
          </ModalFooter>
        </ModalContent>
      </ModalRoot>

      {/* Step rail, the header's optional row. */}
      <ModalRoot onOpenChange={(o) => !o && setStep(0)}>
        <ModalTrigger asChild>
          <Button variant="outline" tone="grey" data-testid="modal-open-steps">
            With steps
          </Button>
        </ModalTrigger>
        <ModalContent size="lg" data-testid="modal-steps">
          <ModalHeader>
            <ModalTitle>Title</ModalTitle>
            <ModalSteps
              steps={STEPS}
              current={step}
              data-testid="modal-steprail"
            />
          </ModalHeader>
          <ModalBody>
            <ModalDescription>
              Step {step + 1} of {STEPS.length}.
            </ModalDescription>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="outline"
              tone="grey"
              disabled={step === 0}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
            >
              Back
            </Button>
            <Button
              disabled={step === STEPS.length - 1}
              onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
              data-testid="modal-step-next"
            >
              Next
            </Button>
          </ModalFooter>
        </ModalContent>
      </ModalRoot>

      {/* Mailbox header: 48px bar with its own icon actions. */}
      <ModalRoot>
        <ModalTrigger asChild>
          <Button
            variant="outline"
            tone="grey"
            data-testid="modal-open-mailbox"
          >
            Mailbox
          </Button>
        </ModalTrigger>
        <ModalContent data-testid="modal-mailbox">
          <ModalHeader
            variant="mailbox"
            actions={
              <>
                <ModalIconButton aria-label="Minimise">
                  <Minus aria-hidden="true" />
                </ModalIconButton>
                <ModalIconButton aria-label="Expand">
                  <Maximize2 aria-hidden="true" />
                </ModalIconButton>
              </>
            }
          >
            <ModalTitle>Title</ModalTitle>
          </ModalHeader>
          <ModalBody className="flex flex-col gap-4 pt-4">
            <Input label="To" placeholder="name@example.com" />
            <Input label="Subject" placeholder="Subject" />
          </ModalBody>
          <ModalFooter>
            <ModalClose asChild>
              <Button variant="outline" tone="grey">
                Cancel
              </Button>
            </ModalClose>
            <Button>Send</Button>
          </ModalFooter>
        </ModalContent>
      </ModalRoot>

      {/* Long body: the panel is capped and the body scrolls, not the page. */}
      <ModalRoot>
        <ModalTrigger asChild>
          <Button variant="outline" tone="grey" data-testid="modal-open-long">
            Long content
          </Button>
        </ModalTrigger>
        <ModalContent data-testid="modal-long">
          <ModalHeader>
            <ModalTitle>Terms</ModalTitle>
          </ModalHeader>
          <ModalBody
            className="flex flex-col gap-3"
            data-testid="modal-long-body"
          >
            {Array.from({ length: 24 }, (_, i) => (
              <p key={i} className="text-subhead-regular text-fg-muted">
                {i + 1}. The panel is capped at the viewport height, so this
                region scrolls while the header and footer stay put.
              </p>
            ))}
          </ModalBody>
          <ModalFooter left={<Checkbox label="Do not show again" />}>
            <ModalClose asChild>
              <Button variant="outline" tone="grey">
                Cancel
              </Button>
            </ModalClose>
            <Button>Accept</Button>
          </ModalFooter>
        </ModalContent>
      </ModalRoot>
    </div>
  );
}
