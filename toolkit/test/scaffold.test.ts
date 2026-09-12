import { describe, expect, test } from "vitest";

import {
  DEFAULT_DEST_DIR_NAME,
  DEFAULT_SOURCE_DIR_NAME,
  PROJECT_AGENTS_DIR,
  PROJECT_COMMANDS_DIR,
  USER_AGENTS_DIR,
  USER_COMMANDS_DIR,
} from "../src/constants";

describe("scaffold constants", () => {
  test("exposes the zero-config default source and dest directory names", () => {
    expect(DEFAULT_SOURCE_DIR_NAME).toBe("copilot-source");
    expect(DEFAULT_DEST_DIR_NAME).toBe("migrated");
  });

  test("targets the installed runtime commands dir per scope", () => {
    expect(USER_COMMANDS_DIR).toBe("command");
    expect(PROJECT_COMMANDS_DIR).toBe("commands");
    expect(USER_AGENTS_DIR).toBe(PROJECT_AGENTS_DIR);
  });
});
