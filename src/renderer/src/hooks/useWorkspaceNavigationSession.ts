import { useRef } from "react";
import { NavigationCoordinator } from "../lib/navigationCoordinator";

/** Owns request sequencing and cancellation tokens used by primary navigation and previews. */
export function useWorkspaceNavigationSession() {
  const navigationCoordinatorRef = useRef(new NavigationCoordinator());
  const pageOpenAbortRef = useRef<AbortController | null>(null);
  const linkPreviewAbortRef = useRef<AbortController | null>(null);
  return { navigationCoordinatorRef, pageOpenAbortRef, linkPreviewAbortRef };
}
