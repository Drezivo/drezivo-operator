import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from "./theme";
import { ThemeToggle } from "./ThemeToggle";

function mockSystemDark(dark: boolean) {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: dark, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

describe("theme", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("init script follows the OS when nothing is saved", () => {
    mockSystemDark(true);
    new Function(THEME_INIT_SCRIPT)();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("init script prefers the saved choice over the OS", () => {
    mockSystemDark(true);
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    new Function(THEME_INIT_SCRIPT)();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("init script ignores an unrecognised saved value", () => {
    mockSystemDark(false);
    localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    new Function(THEME_INIT_SCRIPT)();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("toggle flips the theme and remembers the choice", () => {
    mockSystemDark(false);
    document.documentElement.dataset.theme = "light";
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    fireEvent.click(screen.getByRole("button", { name: "Switch to light theme" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });
});
