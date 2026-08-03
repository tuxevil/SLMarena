import { describe, expect, it } from "vitest";
import { formatBytes } from "./format-bytes";

describe("formatBytes", () => {
  it("formats megabytes below one gigabyte", () => {
    expect(formatBytes(512_000_000)).toBe("512 MB");
  });

  it("formats gigabytes with one decimal place", () => {
    expect(formatBytes(4_500_000_000)).toBe("4.5 GB");
  });
});
