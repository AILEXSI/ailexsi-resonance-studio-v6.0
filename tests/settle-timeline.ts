import { act } from "react";

/** Timeline loads in its own chunk. Wait until that chunk has rendered. */
export async function settleTimeline(host: ParentNode): Promise<void> {
  for (let i = 0; i < 25 && !host.querySelector("[data-testid=timeline]"); i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}
