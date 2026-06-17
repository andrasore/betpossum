"use client";

import { Box, Flex, IconButton } from "@radix-ui/themes";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import type { OddsEvent } from "@/types";
import { BetSlip } from "./BetSlip";

type Choice = "home" | "away" | "draw";
interface Selection {
  event: OddsEvent;
  choice: Choice;
}

interface Props {
  selection: Selection | null;
  loggedIn: boolean;
  balance: number | null;
  onChoiceChange: (choice: Choice) => void;
  onPlaced: () => void;
  onLogin: () => void;
  onClose: () => void;
}

const DRAWER_WIDTH = 500;

export function BetSlipDrawer({ selection, onClose, ...slip }: Props) {
  const open = selection !== null;

  // Hold onto the last non-null selection so the slip keeps rendering its
  // content while the drawer slides shut, instead of flashing empty mid-slide.
  const [shown, setShown] = useState<Selection | null>(selection);
  useEffect(() => {
    if (selection) {
      setShown(selection);
    }
  }, [selection]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      <Box
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          background: "var(--black-a6)",
          opacity: open ? 1 : 0,
          transition: "opacity 0.2s ease",
          pointerEvents: open ? "auto" : "none",
          zIndex: 100,
        }}
      />
      <Box
        asChild
        p="4"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: DRAWER_WIDTH,
          maxWidth: "100vw",
          background: "var(--color-panel-solid)",
          borderLeft: "1px solid var(--gray-a5)",
          boxShadow: "var(--shadow-6)",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.25s ease",
          overflowY: "auto",
          zIndex: 101,
        }}
      >
        <aside aria-hidden={!open}>
          <Flex justify="end" mb="2">
            <IconButton
              variant="ghost"
              color="gray"
              aria-label="Close bet slip"
              onClick={onClose}
            >
              <X size={18} />
            </IconButton>
          </Flex>
          <BetSlip selection={selection ?? shown} {...slip} />
        </aside>
      </Box>
    </>
  );
}
