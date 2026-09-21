// Conventional Commits config (Decision D3). Blocking on pull requests via
// scripts/ci/commitlint.sh — see the header there for why the warn-only phase
// ended: release-please reads these subjects to decide the version and write
// the changelog, so a commit that does not parse is skipped silently.
module.exports = {
  extends: ['@commitlint/config-conventional'],

  // Dependabot writes "build(deps): Bump x from 1.0 to 2.0" — a capitalised
  // "Bump" that trips subject-case, so every Dependabot PR fails this check and
  // has to be reworded by hand before it can merge. Exempting them is safe on
  // the terms above: the type and scope still parse, so release-please sees
  // these commits; it is only the casing of a subject Dependabot generates.
  // Matched on the sign-off trailer rather than the subject so the exemption
  // covers only commits Dependabot actually authored.
  ignores: [(message) => /^Signed-off-by: dependabot\[bot\] </m.test(message)],
};
