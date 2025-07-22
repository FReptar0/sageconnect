# Contributing to This Project

Thank you for your interest in contributing! This document outlines the steps and guidelines to make the process as smooth and efficient as possible.

---

## 1. Code of Conduct

This project follows a [Code of Conduct](CODE_OF_CONDUCT.md). Please read it before interacting. In summary:

- **Be respectful.**  
- **Be collaborative.**  
- **Be patient and open‑minded.**

---

## 2. Getting Started

1. **Fork** the repository on GitHub.  
2. **Clone** your fork locally:

   ```bash
   git clone https://github.com/<your-username>/sageconnect.git
   cd sageconnect
   ```

3. **Install prerequisites** (Node.js, Python, etc.) as specified in `README.md`.
4. **Create a branch** for your work (see Branching Model below).

---

## 3. Branching Model

We use a **GitFlow‑inspired** workflow:

- **`main`**: production‑ready code, protected; only maintainers may merge.
- **`develop`**: integration branch for features and fixes; periodically merged into `main`.
- **`feature/xyz`**: new features branched off `develop`.
- **`fix/abc`**: bug‑fix branches off `develop`.
- **`hotfix/123`**: urgent fixes branched off `main`, merged back into both `main` and `develop`.

**Naming convention:**

```text
feature/<short-description>
fix/<short-description>
hotfix/<short-description>
```

---

## 4. Reporting Issues

Before opening an issue, search existing issues to avoid duplicates.

When reporting a bug, include:

- **Title:** concise and descriptive.
- **Description:** what you expected vs. what happened.
- **Steps to reproduce:** numbered list.
- **Environment:** OS, language/runtime versions, hardware if relevant.
- **Logs / Screenshots:** any error messages, stack traces, or screenshots.
- **Severity / Priority:** Blocker / Critical / Major / Minor / Trivial.

Use labels where appropriate: `bug`, `enhancement`, `question`, etc.

---

## 5. Proposing Features

If you have an idea for a new feature:

1. **Search** existing feature requests.
2. **Open** a new issue with:

   - A clear description of the problem.
   - Proposed solution or API changes.
   - Mockups or examples, if applicable.

Maintainers will discuss feasibility and scope before work begins.

---

## 6. Pull Request Workflow

1. **Branch off** from `develop` (or `main` for hotfixes).
2. **Work on your changes**, committing logically:

   - **Atomic commits**: one logical change per commit.
   - **Descriptive messages**: use imperative, present tense (e.g., “Add user login endpoint”).

3. **Rebase** or **merge** the latest `develop` into your branch to resolve conflicts early:

   ```bash
   git fetch origin
   git checkout feature/xyz
   git rebase origin/develop
   ```

4. **Run tests** and ensure everything passes:

   ```bash
   npm test         # or `pytest`, etc.
   npm run lint
   ```

5. **Push** your branch to your fork:

   ```bash
   git push origin feature/xyz
   ```

6. **Open a Pull Request** against `develop`:

   - Reference the issue number if applicable (`Closes #123`).
   - Describe what your PR does and why.
   - Mention any follow‑up tasks.

7. **Respond to review feedback** by pushing new commits to the same branch.
8. Once approved, a maintainer will **merge** your PR and close the issue.

---

## 7. Coding Style & Guidelines

- **Languages & Frameworks:** follow the style guides of the respective ecosystem (e.g., PEP 8 for Python, ESLint + Prettier for JavaScript).
- **Indentation:** 2 spaces (JS/TS), 4 spaces (Python).
- **Line length:** wrap at 80–100 characters.
- **Documentation comments:** use JSDoc/TSDoc, docstrings, or equivalent.
- **Type safety:** prefer typing (TypeScript, MyPy) where available.
- **Avoid trailing whitespace** and enforce via linter.

We provide configurations:

- `.eslintrc.js` + `.prettierrc` for JavaScript/TypeScript.
- `pyproject.toml` / `setup.cfg` for Python.
- `.editorconfig` for consistent editor settings.

---

## 8. Testing

- Write **unit tests** covering new functionality and edge cases.
- Include **integration tests** where appropriate.
- Maintain **> 80% code coverage**.
- Run tests locally before submitting:

  ```bash
  npm test
  coverage report
  ```

- Add test scripts to `package.json` or `Makefile`.

---

## 9. Continuous Integration

Commits and PRs are validated via CI (e.g., GitHub Actions):

- **Linting**
- **Unit & Integration Tests**
- **Security Scans** (e.g., Snyk, Dependabot checks)
- **Build Verification**

Fix any failures reported by the CI before requesting a merge.

---

## 10. Documentation

- **README.md**: high‑level overview, getting started.
- **`/docs` directory**: detailed guides, architecture docs, API reference.
- **Auto‑generated docs** (via JSDoc, Sphinx, etc.) should be updated when APIs change.
- Include **code samples** and **command‑line examples**.

---

## 11. Localization & Internationalization

- Core text must be in English.
- For translations, use the `i18n/` folder and follow existing patterns.
- Pull requests that add or improve translations are welcome.

---

## 12. Security Vulnerabilities

If you discover a security issue:

1. **Do not** open a public issue.
2. **Email** the maintainers at `<fmemije00@gmail.com>` with details.
3. We will coordinate a patch and disclosure timeline.

---

## 13. License & EULA

This project is licensed under the **EULA** with Fernando Rodríguez Memije (Effective July 22, 2025). By contributing, you agree that:

- Your code is incorporated under the same EULA terms.
- You grant the project a **non‑exclusive, perpetual** license to use and distribute your contributions.
- The EULA remains in force until revoked per its terms.

Refer to `EULA.md` for full legal text.

---

## 14. Acknowledgments

We appreciate every contribution, big or small. Special thanks to all past and future contributors for making this project better! 🎉

---

## 15. Questions & Contact

- For general questions, open an issue with the `question` label.
- For private matters, email **Fernando Rodríguez Memije** at [fmemije00@gmail.com](mailto:fmemije00@gmail.com).

---

**Thank you for helping us build something great!** 🚀
