import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  input: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("@inquirer/prompts", () => ({
  select: mocks.select,
  input: mocks.input,
  confirm: mocks.confirm,
}));

import { interactivePrompts } from "../src/cli/prompts";

const CANDIDATES = ["litellm/litellm-default", "litellm/litellm-builder"];

describe("interactivePrompts.chooseModel", () => {
  beforeEach(() => {
    mocks.select.mockReset();
    mocks.input.mockReset();
  });

  test("returns the catalog model the user selected", async () => {
    mocks.select.mockResolvedValue("litellm/litellm-builder");

    await expect(interactivePrompts.chooseModel("mystery-model", CANDIDATES)).resolves.toBe(
      "litellm/litellm-builder",
    );
  });

  test("asks for a typed id when the custom choice is selected", async () => {
    mocks.select.mockImplementation(
      async (config: { choices: readonly { value: string }[] }) =>
        config.choices[config.choices.length - 1]?.value ?? "",
    );
    mocks.input.mockResolvedValue("  litellm/custom  ");

    await expect(interactivePrompts.chooseModel("mystery-model", CANDIDATES)).resolves.toBe(
      "litellm/custom",
    );
  });

  test("returns undefined when the typed id is blank", async () => {
    mocks.select.mockImplementation(
      async (config: { choices: readonly { value: string }[] }) =>
        config.choices[config.choices.length - 1]?.value ?? "",
    );
    mocks.input.mockResolvedValue("   ");

    await expect(interactivePrompts.chooseModel("mystery-model", CANDIDATES)).resolves.toBeUndefined();
  });
});
