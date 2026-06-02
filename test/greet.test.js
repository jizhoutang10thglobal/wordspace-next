import { describe, it, expect } from "vitest";
import { greet } from "../src/greet.js";

describe("greet", () => {
  it('returns "Hello, Colin!" for greet("Colin")', () => {
    expect(greet("Colin")).toBe("Hello, Colin!");
  });

  it('returns "Hello, world!" for greet()', () => {
    expect(greet()).toBe("Hello, world!");
  });
});
