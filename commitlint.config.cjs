// Conventional Commits config (Decision D3). Enforced warn-only in CI for now
// via scripts/ci/commitlint.sh; required later once history has adopted it.
module.exports = {
  extends: ['@commitlint/config-conventional'],
};
