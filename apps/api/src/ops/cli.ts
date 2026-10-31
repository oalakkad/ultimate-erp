// Entry point of the backup tool (docs/operations.md section 2). See commands.ts for usage.
import { describeFailure, main } from './commands.js';

main(process.argv.slice(2), process.env).catch((err: unknown) => {
  process.stderr.write(`\n${describeFailure(err).message}\n\n`);
  process.exit(1);
});
