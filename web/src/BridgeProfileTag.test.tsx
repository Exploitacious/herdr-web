/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeProfileTag } from "./BridgeProfileTag";

const roots: Root[] = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount();
    }
  });
  document.body.innerHTML = "";
});

async function render(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(node));
  return container;
}

describe("BridgeProfileTag", () => {
  it("renders a work tag", async () => {
    const container = await render(<BridgeProfileTag profile="work" />);
    const tag = container.querySelector<HTMLElement>(".bridge-profile-tag");
    expect(tag?.textContent).toBe("work");
    expect(tag?.getAttribute("data-profile")).toBe("work");
  });

  it("renders a personal tag", async () => {
    const container = await render(<BridgeProfileTag profile="personal" />);
    const tag = container.querySelector<HTMLElement>(".bridge-profile-tag");
    expect(tag?.textContent).toBe("personal");
    expect(tag?.getAttribute("data-profile")).toBe("personal");
  });

  it("renders nothing for other or an absent profile", async () => {
    const other = await render(<BridgeProfileTag profile="other" />);
    expect(other.querySelector(".bridge-profile-tag")).toBeNull();

    const none = await render(<BridgeProfileTag />);
    expect(none.querySelector(".bridge-profile-tag")).toBeNull();
  });
});
