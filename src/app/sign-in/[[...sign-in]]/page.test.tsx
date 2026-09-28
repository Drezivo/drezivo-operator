import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signInProps = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock("@clerk/nextjs", () => ({
  SignIn: (props: Record<string, unknown>) => {
    signInProps.value = props;
    return null;
  },
}));

import SignInPage from "./page";

describe("sign-in route", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_operator-console";
    signInProps.value = {};
  });

  afterEach(() => {
    cleanup();
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  });

  it("uses the optional path-based callback route and returns sign-in to the console root", () => {
    render(<SignInPage />);

    expect(signInProps.value).toMatchObject({
      path: "/sign-in",
      routing: "path",
      forceRedirectUrl: "/",
      fallbackRedirectUrl: "/",
    });
  });
});
