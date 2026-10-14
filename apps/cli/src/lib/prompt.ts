import { createInterface } from "node:readline/promises";

// Questions a command asks on a terminal. Off a TTY, or with `--yes`, every
// question takes its fallback, so a flag is the only way to change an answer.
export type Prompter = {
  interactive: boolean;
  confirm: (question: string, fallback: boolean) => Promise<boolean>;
  text: (question: string, fallback: string) => Promise<string>;
  // `fallback` is an index into `choices`.
  choose: <T>(
    question: string,
    choices: Array<{ label: string; value: T }>,
    fallback: number,
  ) => Promise<T>;
};

// One readline per question, so a raw-mode listener between questions (such
// as `listenForManualSwitch`) gets the terminal to itself.
async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Readline takes Ctrl-C as a key and rejects the question, which a step's
  // error handling would swallow and carry on past; it ends the command instead.
  rl.on("SIGINT", () => {
    rl.close();
    process.stdout.write("\n");
    process.exit(130);
  });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export function parseYesNo(answer: string, fallback: boolean): boolean {
  const normalized = answer.trim().toLowerCase();
  if (normalized === "") return fallback;
  if (["y", "yes"].includes(normalized)) return true;
  if (["n", "no"].includes(normalized)) return false;
  return fallback;
}

// A number from the list, or a label typed out; anything else is the fallback.
export function parseChoice<T>(
  answer: string,
  choices: Array<{ label: string; value: T }>,
  fallback: number,
): T | undefined {
  const normalized = answer.trim().toLowerCase();
  const index = Number(normalized);
  if (normalized !== "" && Number.isInteger(index)) {
    return choices[index - 1]?.value;
  }
  const byLabel = choices.find(
    (choice) => choice.label.toLowerCase() === normalized,
  );
  return (byLabel ?? choices[fallback])?.value;
}

export function createPrompter(options: { interactive: boolean }): Prompter {
  const { interactive } = options;
  return {
    interactive,
    async confirm(question, fallback) {
      if (!interactive) return fallback;
      const hint = fallback ? "[Y/n]" : "[y/N]";
      return parseYesNo(await ask(`${question} ${hint} `), fallback);
    },
    async text(question, fallback) {
      if (!interactive) return fallback;
      const answer = await ask(
        fallback ? `${question} [${fallback}]: ` : `${question}: `,
      );
      return answer || fallback;
    },
    async choose(question, choices, fallback) {
      const fallbackChoice = choices[fallback] ?? choices[0];
      if (!fallbackChoice) throw new Error(`No choices for: ${question}`);
      if (!interactive) return fallbackChoice.value;
      console.log(`\n${question}`);
      choices.forEach((choice, index) => {
        console.log(`  ${index + 1}  ${choice.label}`);
      });
      for (;;) {
        const picked = parseChoice(
          await ask(`Choose 1-${choices.length} [${fallback + 1}]: `),
          choices,
          fallback,
        );
        if (picked !== undefined) return picked;
      }
    },
  };
}
