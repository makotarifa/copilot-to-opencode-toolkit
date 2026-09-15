import { checkbox, confirm, input, select } from "@inquirer/prompts";

import { TargetScope } from "../domain/target-scope";
import { ModelPrompt } from "../model/model-resolver";

const CUSTOM_MODEL_CHOICE = "<type a custom OpenCode model id>";
const SCOPE_CHOICES = [
  { name: "project (repo-local dest; review-then-promote)", value: TargetScope.Project },
  { name: "user (~/.config/opencode)", value: TargetScope.User },
];

export interface InteractivePrompts extends ModelPrompt {
  promptPath(message: string, defaultValue?: string): Promise<string>;
  selectScope(message: string, defaultValue: TargetScope): Promise<TargetScope>;
  confirm(message: string, defaultValue?: boolean): Promise<boolean>;
  confirmOverwrite(target: string): Promise<boolean>;
  selectTeams(message: string, teams: readonly string[]): Promise<readonly string[]>;
  showPanel(title: string, lines: readonly string[]): void;
}

async function chooseModel(original: string, candidates: readonly string[]): Promise<string | undefined> {
  const answer = await select({
    message: `Resolve Copilot model \`${original}\` to an OpenCode model id`,
    choices: [
      ...candidates.map((candidate) => ({ name: candidate, value: candidate })),
      { name: CUSTOM_MODEL_CHOICE, value: CUSTOM_MODEL_CHOICE },
    ],
  });
  if (answer !== CUSTOM_MODEL_CHOICE) {
    return answer;
  }
  const typed = await input({ message: "OpenCode model id" });
  return typed.trim().length > 0 ? typed.trim() : undefined;
}

export const interactivePrompts: InteractivePrompts = {
  promptPath: async (message, defaultValue) => {
    const answer = await input({ message, default: defaultValue });
    return answer;
  },
  selectScope: async (message, defaultValue) =>
    select({ message, choices: SCOPE_CHOICES, default: defaultValue }),
  confirm: async (message, defaultValue = false) => confirm({ message, default: defaultValue }),
  confirmOverwrite: async (target) =>
    confirm({ message: `Overwrite existing \`${target}\`?`, default: false }),
  selectTeams: async (message, teams) =>
    checkbox({ message, choices: teams.map((team) => ({ name: team, value: team })) }),
  confirmPersist: async (copilotModel, opencodeModelId) =>
    confirm({
      message: `Persist \`${copilotModel}\` → \`${opencodeModelId}\` into model-map.json?`,
      default: false,
    }),
  chooseModel,
  showPanel: (title, lines) => {
    console.log(`\n${title}\n${"-".repeat(title.length)}`);
    for (const line of lines) {
      console.log(`  ${line}`);
    }
    console.log("");
  },
};
