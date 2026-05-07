import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

/**
 * Prompt for one of `choices`. Returns the selected entry.
 *
 * Behaviour:
 *   - Single choice → returned without prompting.
 *   - Non-TTY stdin (CI / pipe) → throws so the caller is forced to pass
 *     an explicit `--host` flag rather than silently picking one.
 */
export async function pickOne<T>(
  question: string,
  choices: T[],
  formatter: (c: T) => string,
): Promise<T> {
  if (choices.length === 0) {
    throw new Error("no choices to pick from");
  }
  if (choices.length === 1) {
    return choices[0]!;
  }
  if (!stdin.isTTY) {
    throw new Error(
      `multiple options available; please pass --host <id> (got ${choices.length} candidates: ${choices.map(formatter).join(", ")})`,
    );
  }

  stdout.write(`\n${question}\n`);
  for (let i = 0; i < choices.length; i++) {
    stdout.write(`  ${i + 1}. ${formatter(choices[i]!)}\n`);
  }
  stdout.write("\n");
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    while (true) {
      const raw = (await rl.question(`Choice [1-${choices.length}]: `)).trim();
      const n = Number.parseInt(raw, 10);
      if (Number.isInteger(n) && n >= 1 && n <= choices.length) {
        return choices[n - 1]!;
      }
      stdout.write(`Invalid choice "${raw}". Try again.\n`);
    }
  } finally {
    rl.close();
  }
}

/** Yes/no prompt; defaults to false (safer) on non-TTY. */
export async function confirm(question: string, defaultYes = false): Promise<boolean> {
  if (!stdin.isTTY) {
    return defaultYes;
  }
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const suffix = defaultYes ? "[Y/n]" : "[y/N]";
    const raw = (await rl.question(`${question} ${suffix} `)).trim().toLowerCase();
    if (raw === "") {
      return defaultYes;
    }
    return raw === "y" || raw === "yes";
  } finally {
    rl.close();
  }
}
