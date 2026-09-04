/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackendSettingsDialog } from "./BackendSettingsDialog";
import { DISCOVERED_ID_PREFIX } from "./discoveredBridges";

const discovered = {
  id: `${DISCOVERED_ID_PREFIX}session:bootloop`,
  name: "bootloop",
  baseUrl: "https://host.example:8801",
  color: "#89b4fa",
  discovered: true as const,
  profile: "work" as const,
};

const bridge = vi.hoisted(() => ({
  store: {
    backends: [] as unknown[],
    enabledBridgeIds: [] as string[],
  },
  lastSelectedBridgeId: null as string | null,
  sameOriginAvailable: true,
  addBackend: vi.fn(),
  deleteBackend: vi.fn(),
  probeBackend: vi.fn(),
  setBridgeEnabled: vi.fn(),
  updateBackend: vi.fn(),
}));

vi.mock("./bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./bridge")>();
  return {
    ...actual,
    useBridge: () => bridge,
  };
});

const roots: Root[] = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  bridge.store = {
    backends: [discovered],
    enabledBridgeIds: [discovered.id],
  };
  bridge.lastSelectedBridgeId = discovered.id;
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount();
    }
  });
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("BackendSettingsDialog discovered bridges", () => {
  it("shows a read-only summary with no delete control for a discovered row", async () => {
    const { container } = await render(<BackendSettingsDialog {...settingsProps()} />);

    expect(container.textContent).toContain("Discovered from bridges.json");
    expect(container.textContent).toContain(discovered.baseUrl);

    const deleteButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "Delete",
    );
    expect(deleteButton).toBeUndefined();

    // The enable switch stays available for a discovered row.
    const toggle = container.querySelector<HTMLElement>(
      `[role="switch"][aria-label="Disable ${discovered.name}"]`,
    );
    expect(toggle).not.toBeNull();
  });
});

async function render(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(node));
  return { container, root };
}

function settingsProps() {
  return {
    showMobileTerminalSettings: true,
    notesEnabled: true,
    onNotesEnabled: vi.fn(),
    navigationSyncMode: "shared" as const,
    onNavigationSyncMode: vi.fn(),
    agentFeaturesInTabs: true,
    onAgentFeaturesInTabs: vi.fn(),
    combineMatchingWorkspaceNames: false,
    onCombineMatchingWorkspaceNames: vi.fn(),
    multiHostSpaceSelection: true,
    onMultiHostSpaceSelection: vi.fn(),
    terminalFontSizePx: 13,
    onTerminalFontSizePx: vi.fn(),
    terminalScreenReaderText: false,
    onTerminalScreenReaderText: vi.fn(),
    autoRenameUploadConflicts: true,
    onAutoRenameUploadConflicts: vi.fn(),
    terminalInputTransport: "json" as const,
    onTerminalInputTransport: vi.fn(),
    terminalInputBatchDelayMs: 0,
    onTerminalInputBatchDelayMs: vi.fn(),
    terminalOutputCoalesceMs: 16,
    onTerminalOutputCoalesceMs: vi.fn(),
    contentInsetTopPx: 0,
    onContentInsetTopPx: vi.fn(),
    contentInsetBottomPx: 0,
    onContentInsetBottomPx: vi.fn(),
    mobileControlsScalePercent: 100,
    onMobileControlsScalePercent: vi.fn(),
    mobileTerminalTapTarget: "command-input" as const,
    onMobileTerminalTapTarget: vi.fn(),
    mobileLongPressBehavior: "off" as const,
    onMobileLongPressBehavior: vi.fn(),
    mobileTouchSelectionEndpointTimeoutMs: 1500 as const,
    onMobileTouchSelectionEndpointTimeoutMs: vi.fn(),
    mobileCommandExpandingInput: true,
    onMobileCommandExpandingInput: vi.fn(),
    mobileCommandEnterNewline: false,
    onMobileCommandEnterNewline: vi.fn(),
    showMobileKeyboardHideRefit: true,
    mobileKeyboardHideRefit: true,
    onMobileKeyboardHideRefit: vi.fn(),
    onClose: vi.fn(),
  };
}
