---
description: List the diagnostic scripts available in `src/scripts/` and their purpose
---

Survey the diagnostic and one-shot scripts in `src/scripts/`.

1. List every file in `src/scripts/` whose name contains `diagnostic`, `diagnose`, `repair`, `check`, or `reconciliation`.
2. For each match, read the first 30 lines of the file to extract the header docstring or top comment, and summarize in one sentence what it investigates or fixes.
3. Show an example invocation for each: `node src/scripts/<name>.js [args]`. If the script reads CLI args, infer the expected shape from the file head.

**Do not execute any of these scripts.** They hit the production Sage 300 database and the Focaltec portal API. Running them locally without the right `.env` will either fail loudly or, worse, mutate production state. The user runs them manually when needed.

Output format: a markdown table with columns `Script | What it does | Example`.
