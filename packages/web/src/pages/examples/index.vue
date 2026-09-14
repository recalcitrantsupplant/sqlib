<template>
  <div class="page-shell">
    <header class="page-header">
      <h1>Examples</h1>
      <p class="subtitle">
        Interactive examples demonstrating the SPARQL Query Library and ruleset functionality.
      </p>
    </header>

    <section class="examples-list">
      <article
        v-for="example in examples"
        :key="example.id"
        class="example-card"
      >
        <div class="card-header">
          <h2>{{ example.title }}</h2>
          <span v-if="example.badge" class="badge" :class="example.badgeType">
            {{ example.badge }}
          </span>
        </div>
        <p class="description">{{ example.description }}</p>
        <div class="card-footer">
          <NuxtLink :to="example.link" class="example-link">
            View Example →
          </NuxtLink>
          <span v-if="example.difficulty" class="difficulty">
            {{ example.difficulty }}
          </span>
        </div>
      </article>
    </section>

    <footer class="page-footer">
      <p>
        These examples are designed to help you understand how to use the SPARQL Query Library
        for various use cases. Each example includes interactive components and real RDF data.
      </p>
    </footer>
  </div>
</template>

<script setup lang="ts">
interface Example {
  id: string;
  title: string;
  description: string;
  link: string;
  badge?: string;
  badgeType?: 'new' | 'experimental' | 'stable';
  difficulty?: 'Easy' | 'Medium' | 'Advanced';
}

const examples: Example[] = [
  {
    id: 'sudoku-solver',
    title: 'Sudoku Solver with RDF Rules',
    description:
      'Interactive Sudoku puzzle solver that demonstrates RDF-based rule inference. Edit the grid or RDF directly, toggle between Turtle and N-Triples formats, and solve puzzles using declarative rules.',
    link: '/examples/sudoku-solver',
    badge: 'Interactive',
    badgeType: 'new',
    difficulty: 'Medium',
  },
  // Add more examples here as they're created
];
</script>

<style scoped>
.page-shell {
  padding: var(--space-8) var(--space-7) var(--space-9);
  max-width: 1100px;
  margin: 0 auto;
}

.page-header {
  margin-bottom: var(--space-8);
}

.page-header h1 {
  margin: 0 0 var(--space-4);
  font-size: var(--text-hero);
  font-weight: bold;
  color: var(--ink);
}

.subtitle {
  margin: 0;
  font-size: var(--text-heading);
  color: var(--ink-muted);
  line-height: 1.6;
}

.examples-list {
  display: grid;
  gap: 1.5rem;
  margin-bottom: var(--space-9);
}

.example-card {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  padding: var(--space-7);
  background: var(--surface);
  transition: all 0.2s;
}

.example-card:hover {
  border-color: var(--action);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.1);
  transform: translateY(-2px);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: var(--space-5);
}

.card-header h2 {
  margin: 0;
  font-size: var(--text-display);
  font-weight: 600;
  color: var(--ink);
}

/*
 * Not <StatusBadge>: uppercase with tracking is a SectionLabel wearing a pill,
 * which is a shape neither primitive has. What did go are the .dark hand-rolls
 * over these three states — the token triples below are theme-aware, so the
 * rgba blocks were re-stating in one theme what the tokens say in both.
 */
.badge {
  padding: var(--space-1) var(--space-4);
  border-radius: var(--radius-full);
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.badge.new {
  background: var(--action-surface);
  color: var(--action-ink);
}

.badge.experimental {
  background: var(--warning-surface);
  color: var(--warning-ink);
}

.badge.stable {
  background: var(--success-surface);
  color: var(--success-ink);
}

.description {
  margin: 0 0 var(--space-6);
  color: var(--ink-secondary);
  line-height: 1.6;
}

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.example-link {
  color: var(--action);
  font-weight: 500;
  text-decoration: none;
  transition: color 0.2s;
}

.example-link:hover {
  color: var(--action-hover);
  text-decoration: underline;
}

.difficulty {
  padding: var(--space-2) var(--space-5);
  border-radius: var(--radius-panel);
  background: var(--surface-sunken);
  color: var(--ink-muted);
  font-size: var(--text-content);
  font-weight: 500;
}

.page-footer {
  padding-top: var(--space-8);
  border-top: 1px solid var(--border-subtle);
  color: var(--ink-muted);
  line-height: 1.6;
}

.page-footer p {
  margin: 0;
}

/* Dark rules hang off the .dark class the theme switch sets, not the OS
   preference: a preference pinned in Settings against the OS otherwise
   left this block applying in light mode, or not applying in dark. */
.dark .example-card {
  border-color: var(--border-hover);
  background: var(--gray-800);
}

.dark .example-card:hover {
  border-color: var(--action-border);
  box-shadow: 0 4px 12px rgba(96, 165, 250, 0.2);
}

.dark .example-link {
  color: var(--action);
}

.dark .example-link:hover {
  color: var(--action);
}

.dark .page-footer {
  border-top-color: var(--border-hover);
}
</style>
