// Conventional Commits config (Decision D3). Blocking on pull requests via
// scripts/ci/commitlint.sh — see the header there for why the warn-only phase
// ended: release-please reads these subjects to decide the version and write
// the changelog, so a commit that does not parse is skipped silently.
module.exports = {
  extends: ['@commitlint/config-conventional'],
};
