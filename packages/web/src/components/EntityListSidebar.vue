<template>
  <aside class="entity-sidebar" :class="{ collapsed }" data-testid="entity-list-sidebar">
    <!--
      Folded, the sidebar is a rail: the hinge back out, the one action that
      still makes sense without the list (+ New), and the section's own name
      turned on its side so the rail still says where you are. Collapse-only
      rather than drag, because the list has a fixed vocabulary and a
      comfortable width — see `useSidebarCollapse`.
    -->
    <template v-if="collapsed">
      <button
        class="hinge rail-hinge"
        data-testid="sidebar-hinge"
        title="Expand the list"
        aria-label="Expand the list"
        :aria-expanded="false"
        @click="toggleCollapsed"
      >
        <PanelLeftOpen :size="14" />
      </button>
      <button
        class="rail-new"
        data-testid="rail-new-scratch"
        :title="newButtonTitle"
        :aria-label="newButtonTitle"
        @click="emit('create-scratch')"
      >
        <Plus :size="14" />
      </button>
      <div class="rail-spine">
        <span class="rail-count">{{ totalCount }}</span>
        <span class="rail-label">{{ sectionLabel }}</span>
      </div>
    </template>

    <!--
      Where a section's own tabs go, when it has any. Tests puts its Tests/Runs
      strip here: the two are one list seen at two scopes, so the switch belongs
      above the list rather than beside the section name.
    -->
    <slot v-if="!collapsed" name="list-tabs" />

    <TagManagerDialog v-if="taggingEnabled" v-model:open="tagManagerOpen" />

    <div v-if="!collapsed" class="section-bar">
      <!--
        The hinge sits with the section's own name: this bar is the first thing
        in the sidebar now that the library strip has moved to the rail.
      -->
      <button
        class="hinge"
        data-testid="sidebar-hinge"
        title="Collapse the list"
        aria-label="Collapse the list"
        :aria-expanded="true"
        @click="toggleCollapsed"
      >
        <PanelLeftClose :size="13" />
      </button>
      <span class="section-name">{{ sectionLabel }}</span>
      <!--
        Saved plus scratch: the count is of everything the list holds. A
        replaced body counts something else — a run's tests, not the section's —
        and says so in its own tabs, so the section's count stands down rather
        than contradicting it.
      -->
      <span v-if="!$slots['list-body']" class="section-count" data-testid="section-count">{{ totalCount }}</span>
      <!--
        Whatever the section can do to its whole list — Tests puts Run all here.
        A slot rather than a prop because the action belongs to the section, and
        this component has no business knowing what running a test means.
      -->
      <slot v-if="!$slots['list-body']" name="section-actions" :items="visibleSaved" />
      <!--
        Authoring belongs to the list you author against. A replaced body is a
        view of something already made — a run — so it gets no New button.

        + New starts one, and that is the whole control. Rules used to carry a
        chevron beside it for "Import from SPARQL…", which opened the same
        dialog the editor's own Import button opens on the rule set already in
        front of you — so the menu was a second door onto one room.
      -->
      <div v-if="!$slots['list-body']" class="new-group">
        <button
          class="new-button"
          data-testid="new-scratch"
          :title="newButtonTitle"
          @click="emit('create-scratch')"
        >
          <Plus :size="13" />New
        </button>
      </div>
    </div>

    <!--
      A section can hand the sidebar a different body — Tests does, for its
      Runs tab, which is the same list at the scope of one run. It replaces the
      filter and the rows and nothing else, so the hinge, the width and the
      collapse behaviour stay the sidebar's rather than being drawn a second
      time beside it (sidebar sizing doc §1).
    -->
    <slot v-if="!collapsed && $slots['list-body']" name="list-body" />

    <div v-if="!collapsed && !$slots['list-body']" class="filter-bar">
      <label class="filter-field">
        <Search :size="12" />
        <input
          v-model="filter"
          type="text"
          class="filter-input"
          placeholder="Filter"
          :aria-label="`Filter ${nounPlural}`"
          data-testid="entity-filter"
        />
      </label>
      <!--
        Grouping is a view over the same list, not a move (tags doc §2), so it
        sits beside the filter rather than in a menu: it changes what you are
        looking at, and you have to be able to see that it is on.
      -->
      <DropdownMenu v-if="groupingEnabled">
        <DropdownMenuTrigger as-child>
          <button
            class="group-by-button"
            :class="{ active: grouping !== 'none' }"
            title="Group by"
            data-testid="group-by"
          >
            <Tags :size="13" />
            <span class="group-by-label">{{ groupingLabel }}</span>
            <ChevronDown :size="12" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem class="library-menu-item" data-testid="group-by-none" @select="setGrouping('none')">
            <Check :size="13" :class="['library-check', { hidden: grouping !== 'none' }]" />
            <span>No grouping</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            v-if="taggingEnabled"
            class="library-menu-item"
            data-testid="group-by-tag"
            @select="setGrouping('tag')"
          >
            <Check :size="13" :class="['library-check', { hidden: grouping !== 'tag' }]" />
            <span>Tag</span>
          </DropdownMenuItem>
          <!--
            Origin is how you find things; tags are how you mean things. It is
            here rather than as an auto-applied tag for exactly that reason.
          -->
          <DropdownMenuItem
            v-if="originEnabled"
            class="library-menu-item"
            data-testid="group-by-origin"
            @select="setGrouping('origin')"
          >
            <Check :size="13" :class="['library-check', { hidden: grouping !== 'origin' }]" />
            <span>Origin</span>
          </DropdownMenuItem>
          <!--
            Tags are the library's, not the section's, but this is the only
            menu that is about them — the library strip that used to hold it is
            gone, and switching libraries is the rail's job now (tags doc §5).
          -->
          <template v-if="taggingEnabled">
          <DropdownMenuSeparator />
          <DropdownMenuItem
            class="library-menu-item"
            data-testid="manage-tags"
            @select="tagManagerOpen = true"
          >
            <Tags :size="13" class="library-check" />
            <span>Manage tags…</span>
          </DropdownMenuItem>
          </template>
        </DropdownMenuContent>
      </DropdownMenu>

      <DensityToggle :model-value="density" @update:model-value="setDensity" />
    </div>

    <div v-if="!collapsed && !$slots['list-body']" class="entity-list" :class="`density-${density}`">
      <!-- Scratch pins above Saved: an unsaved body is the thing that
           needs a decision, and burying it is how it gets forgotten. -->
      <template v-if="visibleScratch.length > 0">
        <div class="cluster-header">
          <FlaskConical :size="11" />
          <span class="cluster-name">Scratch</span>
          <span class="cluster-meta">{{ visibleScratch.length }} · never saved</span>
        </div>
        <div
          v-for="item in visibleScratch"
          :key="item.id"
          class="entity-row scratch-row"
          :class="{
            selected: selection.kind === 'scratch' && selection.id === item.id,
            'one-line': !item.description,
          }"
          data-testid="scratch-row"
          :data-scratch-id="item.id"
          role="button"
          tabindex="0"
          @click="emit('select-scratch', item.id)"
          @keydown.enter="emit('select-scratch', item.id)"
        >
          <span class="scratch-dot" aria-hidden="true" />
          <span class="entity-name scratch-name">{{ item.name }}</span>
          <!--
            No "Never saved" line. The cluster header says it once, the dashed
            dot and the italic name say it again on every row, and a third copy
            under each one bought a second line of height per scratch to repeat
            what the reader already knew. A scratch that *has* a description
            still shows it — that is the only thing the line can say that is
            not already on screen.
          -->
          <span v-if="density === 'comfortable' && item.description" class="entity-sub">{{ item.description }}</span>
          <span class="entity-age">{{ ageOf(item) }}</span>
          <button
            class="discard-button"
            :title="`Discard ${item.name}`"
            :aria-label="`Discard ${item.name}`"
            data-testid="discard-scratch"
            @click.stop="emit('discard-scratch', item.id)"
          >
            <X :size="12" />
          </button>
        </div>
        <div class="cluster-divider" />
      </template>

      <template v-if="savedEnabled && (visibleSaved.length > 0 || visibleScratch.length > 0)">
        <div class="cluster-header">
          <Library :size="11" />
          <span class="cluster-name">Saved</span>
          <span class="cluster-meta">{{ visibleSaved.length }}</span>
        </div>

        <!--
          A section listing one kind of thing gets one flat run of rows; the
          "Rule sets / Rules / Data blocks" subheadings would be noise there.
          Rules lists three kinds, and without the subheadings a rule and the
          data block beside it are two identical rows that open two different
          screens.

          Grouped by tag the headings are always drawn, and they collapse:
          a row appears under every tag it carries, so the list is longer than
          the library and folding a group is how it stays readable.
        -->
        <template v-for="group in savedClusters" :key="group.key">
          <!--
            A div with the button role rather than a `<button>`: the heading
            carries actions of its own (Run, for tests), and a control nested
            inside a button is invalid and reads as one target to assistive
            tech. Enter and Space are bound by hand to keep the keyboard
            behaviour a real button would have given.
          -->
          <div
            v-if="group.showHeading && group.items.length > 0"
            class="group-header"
            :class="{ 'group-header-button': group.collapsible }"
            :data-testid="group.tagId ? `tag-group-${group.tagId}` : undefined"
            :role="group.collapsible ? 'button' : undefined"
            :tabindex="group.collapsible ? 0 : undefined"
            :aria-expanded="group.collapsible ? !isGroupCollapsed(group.key) : undefined"
            @click="group.collapsible ? toggleGroup(group.key) : undefined"
            @keydown.enter.prevent="group.collapsible ? toggleGroup(group.key) : undefined"
            @keydown.space.prevent="group.collapsible ? toggleGroup(group.key) : undefined"
          >
            <ChevronDown
              v-if="group.collapsible"
              :size="12"
              class="group-chevron"
              :class="{ collapsed: isGroupCollapsed(group.key) }"
            />
            <TagDot v-if="group.color" :color="group.color" size="heading" />
            <span class="group-name">{{ group.label }}</span>
            <span class="cluster-meta">{{ group.items.length }}</span>
            <!-- The same action, narrowed to one heading's rows. -->
            <!--
              `.stop`, or running a heading's tests would collapse the heading
              on the way out: the row itself is the collapse toggle.
            -->
            <span class="group-actions" @click.stop @keydown.stop>
              <!--
              `tag-id` so a section can run the *tag* rather than the rows it
              can see: the same heading, run server-side, picks up a test the
              list has not loaded yet.
            -->
            <slot
              name="group-actions"
              :items="group.items"
              :label="group.label"
              :tag-id="group.tagId"
            />
            </span>
          </div>
          <template v-if="!isGroupCollapsed(group.key)">
            <div
              v-for="entity in group.items"
              :key="`${group.key}:${entity.id}`"
              class="entity-row saved-row"
              :class="{ selected: selection.kind === 'saved' && selection.id === entity.id, indented: group.collapsible }"
              data-testid="saved-row"
              :data-entity-id="entity.id"
              :data-entity-kind="entity.kind ?? group.type"
              role="button"
              tabindex="0"
              @click="selectSaved(entity, group.type)"
              @keydown.enter="selectSaved(entity, group.type)"
            >
              <span
                v-if="entity.verdict"
                class="row-verdict"
                :class="`row-verdict-${entity.verdict}`"
                :title="entity.verdict === 'pass' ? 'Passed' : 'Failed'"
              ></span>
              <span class="entity-name">{{ entity.name }}</span>
              <span v-if="density === 'comfortable'" class="entity-sub">{{ entity.description ?? '—' }}</span>
              <span class="entity-trailing">
                <!--
                  The other tags this row carries, as dots. Under Geo, a blue
                  dot says "also in Production" — which makes a group readable
                  as a census of the library rather than as a folder. The
                  group's own colour never repeats here, so a dot always means
                  elsewhere (tags mockup 1a).
                -->
                <span
                  v-if="othersFor(entity, group.tagId).length > 0"
                  class="other-tags"
                  data-testid="other-tag-dots"
                  :title="othersTitle(entity, group.tagId)"
                >
                  <TagDot
                    v-for="other in othersFor(entity, group.tagId).slice(0, MAX_OTHER_DOTS)"
                    :key="other.id"
                    :color="other.color"
                  />
                  <span v-if="othersFor(entity, group.tagId).length > MAX_OTHER_DOTS" class="other-more">
                    +{{ othersFor(entity, group.tagId).length - MAX_OTHER_DOTS }}
                  </span>
                </span>
                <!-- One store behind the dot, the header pill and the Details panel,
                     so they cannot disagree about whether a draft exists. -->
                <span
                  v-if="hasDraft(entity.id)"
                  class="draft-dot"
                  data-testid="draft-dot"
                  title="Unsaved draft in this browser"
                />
                <span class="entity-version">{{ versionLabel(entity) }}</span>
              </span>
            </div>
          </template>
        </template>
      </template>

      <InlineNote v-if="visibleSaved.length === 0 && visibleScratch.length === 0" as="div" class="list-empty">
        <template v-if="filter.trim()">
          <span>Nothing matches “{{ filter }}”.</span>
        </template>
        <template v-else>
          <span>No {{ nounPlural }} yet.</span>
          <span class="list-empty-hint">{{ emptyHint }}</span>
        </template>
      </InlineNote>
    </div>
  </aside>
</template>

<script lang="ts">
/** What the sidebar thinks is open. `none` is a section with nothing selected. */
export type SidebarSelection =
  | { kind: 'saved'; id: string | null }
  | { kind: 'scratch'; id: string | null }
  | { kind: 'none'; id: null };

/**
 * The least an entity needs to appear in the list. Queries, groups, rulesets
 * and benchmarks all satisfy it; nothing here is query-specific, which is the
 * point — one list component, every section.
 */
export interface SidebarEntity {
  id: string;
  name: string;
  description?: string | null;
  /**
   * A last-known verdict, shown as a dot before the name.
   *
   * Session state the parent owns, not a property of the entity — which is why
   * it arrives per render rather than being fetched here. It is what makes a
   * bulk run legible: rows tick over as the run walks the list.
   *
   * Named `verdict` rather than `status` because a Backend already carries a
   * `status`, and a row spread from one would have collided with it.
   */
  verdict?: 'pass' | 'fail';
  /**
   * Which of the section's saved kinds this row is, for a section that lists
   * more than one. Rules lists rule sets, rules and data blocks together, and
   * the row has to say which it is or the parent cannot tell what to open.
   */
  kind?: string;
  currentVersion?: string | null;
  /**
   * The current version's number, projected onto the entity by the server.
   *
   * Read rather than derived because it cannot be derived: version IRIs are
   * `urn:sqlib:query-version:<uuid>` and carry no number. The badge used to
   * parse one out of the IRI, so it read `—` against every real backend and
   * only ever worked against the `:v1` suffixes some specs had invented.
   */
  currentVersionNumber?: number | null;
  /**
   * Tag IRIs the entity carries, straight from `sqlib:hasTag`.
   *
   * Zero or more, and zero is the normal state: untagged is what everything is
   * until someone says otherwise, and the sidebar computes an "Untagged" group
   * for those rather than the model storing a default tag.
   */
  tags?: string[] | null;
  /**
   * Where the row came from, for the Origin grouping.
   *
   * *Composed here* is `+ New` on the rail; the other two are rows born on a
   * callable's screen — read off `targetEntity` for an argument set, and off
   * the minting binding for a graph.
   *
   * Bucketed by kind of origin rather than one cluster per callable, because a
   * real library would shatter into dozens of single-row clusters. The callable
   * itself stays in the row's subtitle, where it already was.
   *
   * Deliberately not a tag: tags are user-authored and library-wide, and
   * auto-tagging by provenance would make a tag mean both "I decided this" and
   * "the system asserted this", which destroys the one job tags do well.
   */
  origin?: SidebarOrigin | null;
}

/** Where a row came from. Absent reads as *Composed here*. */
export type SidebarOrigin = 'composed' | 'query' | 'group';

/** A tag as the list needs it: enough to draw a heading and a dot. */
export interface SidebarTag {
  id: string;
  name: string;
  color?: string | null;
}
</script>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import {
  Library,
  ChevronDown,
  Check,
  Plus,
  Search,
  FlaskConical,
  Tags,
  X,
  PanelLeftClose,
  PanelLeftOpen,
} from '@lucide/vue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import DensityToggle from './shared/DensityToggle.vue';
import InlineNote from './shared/InlineNote.vue';
import TagDot from './tags/TagDot.vue';
import TagManagerDialog from './tags/TagManagerDialog.vue';
import { fuzzyMatches } from '../lib/fuzzy';
import { normalizeTagColor, UNTAGGED_COLOR } from '../lib/tagPalette';
import { useCallableDrafts, type CallableDraft } from '../composables/useCallableDrafts';
import { useSettings, type EntityListGrouping } from '../composables/useSettings';
import { useSidebarCollapse } from '../composables/useSidebarCollapse';
import { formatCompactAge } from '../lib/time';

const props = defineProps<{
  /**
   * The rail section this list belongs to. It keys the collapsed flag, so
   * folding the list away under Queries says nothing about Tests.
   */
  section?: string;
  /** Saved entities for the active library, already loaded. */
  saved: SidebarEntity[];
  scratch: CallableDraft[];
  selection: SidebarSelection;
  /** Section heading — "Queries", "Groups", "Rulesets", "Benchmarks". */
  sectionLabel?: string;
  /**
   * Singular/plural noun for the prose: the filter's label, the empty state,
   * and what + New says it will make. "query" reads wrong under Groups.
   */
  itemNoun?: string;
  itemNounPlural?: string;
  /**
   * False for a section whose work area cannot yet hold an unsaved body. Those
   * sections keep a + New that opens their creation dialog instead, and never
   * render a scratch cluster — an empty cluster that can never fill is worse
   * than no cluster.
   */
  supportsScratch?: boolean;
  /**
   * The saved kinds this section lists, in list order. One kind (or none
   * given) renders a flat run of rows; several render a subheading each.
   */
  savedKinds?: Array<{ type: string; label: string }>;
  /**
   * False for a section with no server entity at all — ETL. Its list is
   * scratch and nothing else, and a `Saved 0` header that can never move off
   * zero reads as something being broken.
   */
  supportsSaved?: boolean;
  /**
   * The active library's tags. Empty for a section whose entities cannot be
   * tagged — Bench and ETL — where the group-by control is absent too, because
   * a control that can only produce one group called "Untagged" is a control
   * that does nothing.
   */
  tags?: SidebarTag[];
  /**
   * True where the section's entities can carry tags. Absent reads as false,
   * the way the other capability props here do — a list is flat until its
   * section says its rows are taggable.
   */
  supportsTags?: boolean;
  /**
   * True where the section's rows carry an origin — Graphs and Argument sets.
   * Elsewhere the mode is absent from the menu rather than disabled: a section
   * whose every row would land in one cluster has nothing to group by.
   */
  supportsOrigin?: boolean;
}>();

const emit = defineEmits<{
  (e: 'select-saved', id: string, kind: string): void;
  (e: 'select-scratch', id: string): void;
  (e: 'create-scratch'): void;
  (e: 'discard-scratch', id: string): void;
}>();

const { collapsed, toggle: toggleCollapsed } = useSidebarCollapse(computed(() => props.section ?? 'queries'));

const sectionLabel = computed(() => props.sectionLabel ?? 'Queries');
const noun = computed(() => props.itemNoun ?? 'query');
const nounPlural = computed(() => props.itemNounPlural ?? `${noun.value}s`);
const scratchEnabled = computed(() => props.supportsScratch !== false);
const savedEnabled = computed(() => props.supportsSaved !== false);

const newButtonTitle = computed(() =>
  scratchEnabled.value
    ? `Opens an untitled scratch ${noun.value} — nothing is saved until you save`
    : `Create a ${noun.value}`,
);

const emptyHint = computed(() => {
  if (!scratchEnabled.value) return 'Press + New to create one.';
  if (!savedEnabled.value) return 'Press + New to start one — it stays in this browser.';
  return 'Press + New to start one — it stays in this browser until you save it.';
});

const { draftFor } = useCallableDrafts();
const { settings } = useSettings();

const filter = ref('');
const density = computed(() => settings.value.entityListDensity);

function setDensity(value: 'compact' | 'comfortable') {
  settings.value.entityListDensity = value;
}

const tagManagerOpen = ref(false);

/*
 * Grouping is offered where the section's entities can carry tags. Bench and
 * ETL cannot, and the control is absent there rather than disabled: nothing
 * about those sections is going to change, so there is nothing to explain.
 */
const taggingEnabled = computed(() => props.supportsTags === true && savedEnabled.value);

const originEnabled = computed(() => props.supportsOrigin === true && savedEnabled.value);

/**
 * The grouping control is offered where *either* axis exists, and the stored
 * mode is honoured only where this section has that axis: the setting is one
 * preference shared across sections, so Origin selected under Graphs must read
 * as flat under Queries rather than as an empty split.
 */
const groupingEnabled = computed(() => taggingEnabled.value || originEnabled.value);

const grouping = computed<EntityListGrouping>(() => {
  const mode = settings.value.entityListGrouping;
  if (mode === 'tag') return taggingEnabled.value ? 'tag' : 'none';
  if (mode === 'origin') return originEnabled.value ? 'origin' : 'none';
  return 'none';
});
const groupingByTag = computed(() => grouping.value === 'tag');
const groupingByOrigin = computed(() => grouping.value === 'origin');

const groupingLabel = computed(() => {
  if (grouping.value === 'tag') return 'Tag';
  if (grouping.value === 'origin') return 'Origin';
  return 'Flat';
});

function setGrouping(value: EntityListGrouping) {
  settings.value.entityListGrouping = value;
}


/*
 * Fuzzy on the name, the same rule the choosers filter by (`lib/fuzzy`): "qgrp"
 * finds "query-group smoke". A predicate rather than a ranked list, because the
 * rows below are clustered by kind or tag and ordered by the section — a filter
 * removes rows here, it does not re-sort them.
 */
function matches(name: string, description: string | null | undefined) {
  return fuzzyMatches(filter.value, name, description);
}

// The filter runs across both clusters, and an empty cluster hides its header
// rather than sitting there claiming a section with nothing under it.
// Gated here rather than only in the template, so the count, the Saved header
// and the empty state all agree with the cluster about whether scratch exists.
const visibleScratch = computed(() =>
  scratchEnabled.value ? props.scratch.filter((item) => matches(item.name, item.description)) : [],
);
const visibleSaved = computed(() =>
  savedEnabled.value ? props.saved.filter((entity) => matches(entity.name, entity.description)) : [],
);

/** A run of rows under one heading, whatever decided the heading. */
interface SidebarCluster {
  /** Stable across re-renders, and what collapse state is keyed by. */
  key: string;
  type: string;
  label: string;
  items: SidebarEntity[];
  /** The tag this cluster is, when grouping by tag; null for kind headings. */
  tagId: string | null;
  color: string | null;
  collapsible: boolean;
  showHeading: boolean;
}

/*
 * Saved rows, split by kind and ordered as the section declares them. A row
 * with no `kind` falls into the first group, which is what makes the
 * single-kind sections work without having to label every entity.
 *
 * Grouping by tag replaces that split rather than nesting inside it: the two
 * answer different questions ("what is this row?" vs "what is it about?"), and
 * a section that lists several kinds keeps saying which each row is through
 * `data-entity-kind` and the work area it opens.
 *
 * There is no third case. Tests used to fold by a free-text `group` here, a
 * second axis that the tag control silently replaced whenever it was on; it is
 * gone, and the two questions above are the only ones a heading in this list
 * answers.
 */
const savedClusters = computed<SidebarCluster[]>(() => {
  if (groupingByTag.value) return tagClusters.value;
  if (groupingByOrigin.value) return originClusters.value;

  const kinds = props.savedKinds ?? [];
  if (kinds.length <= 1) {
    const only = kinds[0];
    const type = only?.type ?? 'entity';
    return [kindCluster({ type, label: only?.label ?? sectionLabel.value, items: visibleSaved.value }, false)];
  }
  const clusters = kinds.map((kind) => ({
    type: kind.type,
    label: kind.label,
    items: visibleSaved.value.filter((entity) => entity.kind === kind.type),
  }));
  return clusters.map((cluster) => kindCluster(cluster, true));
});

function kindCluster(
  cluster: { type: string; label: string; items: SidebarEntity[] },
  showHeading: boolean,
): SidebarCluster {
  return {
    key: `kind:${cluster.type}:${cluster.label}`,
    type: cluster.type,
    label: cluster.label,
    items: cluster.items,
    tagId: null,
    color: null,
    collapsible: false,
    showHeading,
  };
}

/*
 * Three buckets, in a fixed order: what you made here, then what was born on a
 * query, then what was born on a group. A row with no origin is *Composed
 * here*, which is what `+ New` on the rail produces and what everything saved
 * before origin was recorded reads as.
 *
 * An empty bucket is dropped, for the same reason an empty tag heading is: it
 * would say the filter matched nothing there, which the empty list already
 * says once.
 */
const ORIGIN_BUCKETS: Array<{ origin: SidebarOrigin; label: string }> = [
  { origin: 'composed', label: 'Composed here' },
  { origin: 'query', label: 'From queries' },
  { origin: 'group', label: 'From groups' },
];

const originClusters = computed<SidebarCluster[]>(() => {
  const type = props.savedKinds?.[0]?.type ?? 'entity';
  const clusters: SidebarCluster[] = [];

  for (const bucket of ORIGIN_BUCKETS) {
    const items = visibleSaved.value.filter((entity) => (entity.origin ?? 'composed') === bucket.origin);
    if (items.length === 0) continue;
    clusters.push({
      key: `origin:${bucket.origin}`,
      type,
      label: bucket.label,
      items,
      tagId: null,
      color: null,
      collapsible: true,
      showHeading: true,
    });
  }

  return clusters;
});

/*
 * One cluster per tag, in the tags' own order, with the untagged remainder
 * last.
 *
 * A row appears under *every* tag it carries — grouping is a view, not a move
 * (tags doc §2) — so the clusters together hold more rows than the library
 * does, and that is the intended read rather than a duplicate to be removed.
 * A tag with nothing under it is dropped: an empty heading in a filtered list
 * says the filter matched nothing there, which is what the empty list already
 * says once.
 */
const tagClusters = computed<SidebarCluster[]>(() => {
  const type = props.savedKinds?.[0]?.type ?? 'entity';
  const clusters: SidebarCluster[] = [];

  for (const tag of props.tags ?? []) {
    const items = visibleSaved.value.filter((entity) => (entity.tags ?? []).includes(tag.id));
    if (items.length === 0) continue;
    clusters.push({
      key: `tag:${tag.id}`,
      type,
      label: tag.name,
      items,
      tagId: tag.id,
      color: normalizeTagColor(tag.color),
      collapsible: true,
      showHeading: true,
    });
  }

  const untagged = visibleSaved.value.filter((entity) => (entity.tags ?? []).length === 0);
  if (untagged.length > 0) {
    clusters.push({
      key: 'tag:untagged',
      type,
      label: 'Untagged',
      items: untagged,
      tagId: null,
      color: UNTAGGED_COLOR,
      collapsible: true,
      showHeading: true,
    });
  }

  return clusters;
});

/**
 * Past three, dots stop being countable and start being a smear, so the rest
 * become `+n` and the full list stays in the row's tooltip.
 */
const MAX_OTHER_DOTS = 3;

const tagsById = computed(() => new Map((props.tags ?? []).map((tag) => [tag.id, tag])));

/** The tags a row carries other than the one whose heading it is sitting under. */
function othersFor(entity: SidebarEntity, withinTagId: string | null) {
  if (!groupingByTag.value) return [];
  return (entity.tags ?? [])
    .filter((id) => id !== withinTagId)
    .map((id) => tagsById.value.get(id))
    .filter((tag): tag is SidebarTag => Boolean(tag))
    .map((tag) => ({ id: tag.id, color: normalizeTagColor(tag.color) }));
}

function othersTitle(entity: SidebarEntity, withinTagId: string | null) {
  const names = (entity.tags ?? [])
    .filter((id) => id !== withinTagId)
    .map((id) => tagsById.value.get(id)?.name)
    .filter((name): name is string => Boolean(name));
  return names.length > 0 ? `Also in ${names.join(', ')}` : '';
}

/*
 * Which tag headings are folded. Named apart from the sidebar's own fold above:
 * one hides a group of rows, the other hides the whole list.
 */
const collapsedGroups = ref<Set<string>>(new Set());

function isGroupCollapsed(key: string) {
  return collapsedGroups.value.has(key);
}

function toggleGroup(key: string) {
  const next = new Set(collapsedGroups.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  collapsedGroups.value = next;
}

/*
 * The count is of everything the list holds, not everything that matches the
 * filter — it labels the section, not the search.
 */
const totalCount = computed(
  () => (savedEnabled.value ? props.saved.length : 0) + (scratchEnabled.value ? props.scratch.length : 0),
);

function selectSaved(entity: SidebarEntity, groupType: string) {
  emit('select-saved', entity.id, entity.kind ?? groupType);
}

function hasDraft(queryId: string) {
  return draftFor(queryId) !== null;
}

function versionLabel(entity: SidebarEntity): string {
  return entity.currentVersionNumber == null ? '—' : `v${entity.currentVersionNumber}`;
}

/*
 * Ages are relative, so they go stale sitting on screen. A minute tick is
 * enough for `now` → `1m` to look alive without costing anything.
 */
const nowMs = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  ticker = setInterval(() => { nowMs.value = Date.now(); }, 30_000);
});
onUnmounted(() => {
  if (ticker) clearInterval(ticker);
});

function ageOf(item: CallableDraft) {
  return formatCompactAge(item.updatedAt, nowMs.value);
}
</script>

<style scoped>
.entity-sidebar {
  width: 288px;
  flex-shrink: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--surface-subtle);
  border-right: 1px solid var(--border-default);
  /*
   * Two widths, not a range: the hinge snaps between them, so the transition is
   * the whole animation there is.
   */
  transition: width 0.18s ease;
}

.entity-sidebar.collapsed {
  width: 44px;
  align-items: center;
  overflow: hidden;
}

/* The hinge, in both states — same glyph slot, same hit area. */
.hinge {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-muted);
  cursor: pointer;
}

.hinge:hover {
  background: var(--surface-raised);
  color: var(--ink);
}

/* Full-bleed so its lower border joins the one the section bar draws. */
.rail-hinge {
  width: 100%;
  height: 40px;
  border-radius: 0;
  border-bottom: 1px solid var(--border-default);
  background: var(--surface);
}

.rail-new {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  margin-top: var(--space-4);
  padding: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-muted);
  cursor: pointer;
}

.rail-new:hover {
  color: var(--ink);
  border-color: var(--border-strong);
}

/*
 * The section's name, turned on its side. Without it the rail is two anonymous
 * buttons and the screen stops saying which list it folded away.
 */
.rail-spine {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-top: var(--space-5);
  min-height: 0;
  overflow: hidden;
}

.rail-count {
  font-size: var(--text-micro);
  font-variant-numeric: tabular-nums;
  color: var(--ink-muted);
}

.rail-label {
  writing-mode: vertical-rl;
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.library-menu-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.library-check.hidden {
  visibility: hidden;
}

.section-bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-4);
}

.section-name {
  color: var(--ink-muted);
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.section-count {
  color: var(--ink-muted);
  font-size: var(--text-label);
}

.new-button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  margin-left: auto;
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-label);
  font-weight: var(--weight-medium);
  cursor: pointer;
}

.new-button:hover {
  border-color: var(--border-strong);
  color: var(--ink);
}
.new-group {
  display: inline-flex;
  margin-left: auto;
  flex-shrink: 0;
}
.filter-bar {
  display: flex;
  gap: 6px;
  padding: 0 var(--space-4) var(--space-4);
}

.filter-field {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: 26px;
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-muted);
}

.filter-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-label);
  outline: none;
}

/*
 * The group-by control sits in the filter bar because grouping and filtering
 * are the same kind of thing — both change what the list shows without
 * changing what the library holds. Active state is a filled pill: a view that
 * is on has to look on, or a row appearing twice reads as a bug.
 */
.group-by-button {
  display: inline-flex;
  flex-shrink: 0;
  height: 26px;
  align-items: center;
  gap: 5px;
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-muted);
  font-family: inherit;
  font-size: var(--text-label);
  cursor: pointer;
}

.group-by-button:hover {
  color: var(--ink-secondary);
}

.group-by-button.active {
  border-color: var(--action-border);
  background: var(--action-surface);
  color: var(--action-ink);
  font-weight: var(--weight-semibold);
}

.group-by-label {
  font-size: var(--text-label);
}

.group-header-button {
  width: 100%;
  border: none;
  background: none;
  font-family: inherit;
  font-size: inherit;
  text-align: left;
  cursor: pointer;
}

.group-header-button:hover {
  color: var(--ink-secondary);
}

.group-chevron {
  flex-shrink: 0;
  transition: transform 120ms ease;
}

.group-chevron.collapsed {
  transform: rotate(-90deg);
}

/* A tagged row is one level in from its heading, the way scratch rows are. */
.saved-row.indented {
  padding-left: var(--space-6);
}

.other-tags {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.other-more {
  color: var(--ink-muted);
  font-size: var(--text-label);
}

.entity-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  padding: 0 var(--space-3) var(--space-4);
  overflow: auto;
}

.cluster-header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  padding: var(--space-1) var(--space-4) var(--space-2);
  color: var(--ink-muted);
}

.cluster-name {
  font-size: var(--text-micro);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.cluster-meta {
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

/* Indented under the Saved header: a subdivision of the cluster, not a second
   cluster beside it. It used to be lighter than that header as well, at a ratio
   nobody could read — and there is no lighter step that is readable, so the
   indent carries the subdivision on its own. */
.group-header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  padding: var(--space-3) var(--space-4) var(--space-1) var(--space-5);
  color: var(--ink-muted);
}

/* Pushed right, so the headings stay a clean column of names and counts. */
.group-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
}

.row-verdict {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  align-self: center;
}

.row-verdict-pass {
  background: var(--success);
}

.row-verdict-fail {
  background: var(--danger);
}

.group-name {
  font-size: var(--text-micro);
  font-weight: var(--weight-medium);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.cluster-divider {
  flex-shrink: 0;
  height: 1px;
  margin: var(--space-3) var(--space-4);
  background: var(--border-subtle);
}

.entity-row {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
  height: 26px;
  padding: 0 var(--space-4);
  border-radius: var(--radius-sm);
  cursor: pointer;
}

/*
 * Comfortable is the two-line row, not a roomy one: the extra height buys the
 * description line and nothing else. It sat at 40px against compact's 26 and
 * read as padding rather than content, so it is halfway now — enough for the
 * second line, no more.
 */
.density-comfortable .entity-row {
  height: auto;
  min-height: 33px;
  flex-wrap: wrap;
  padding: var(--space-1) var(--space-4);
  row-gap: 0;
}

.density-comfortable .entity-sub {
  line-height: 1.25;
}

/*
 * A row with nothing on its second line does not reserve one. Comfortable's
 * extra height is the description's, and scratch rows rarely carry one — six
 * of them at the top of the list were paying for six blank lines.
 */
.density-comfortable .entity-row.one-line {
  min-height: 26px;
}

.entity-row:hover {
  background: var(--surface-raised);
}

.entity-row.selected {
  background: var(--action-surface);
}

.entity-name {
  min-width: 0;
  overflow: hidden;
  color: var(--ink-secondary);
  font-size: var(--text-content);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.entity-row.selected .entity-name {
  color: var(--action-ink);
  font-weight: var(--weight-semibold);
}

/* Italic and grey: a scratch item is not yet a thing the library contains. */
.scratch-name {
  /* Italic glyphs lean past their advance width; the row clips overflow for the
     ellipsis, so reserve a sliver of trailing space or the last letter loses its tail. */
  padding-right: 0.12em;
  font-style: italic;
  color: var(--ink-muted);
}

.entity-sub {
  flex-basis: 100%;
  overflow: hidden;
  color: var(--ink-muted);
  font-size: var(--text-micro);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.scratch-dot {
  box-sizing: border-box;
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border: 1.5px dashed var(--ink-disabled);
  border-radius: var(--radius-full);
}

.entity-age {
  flex-shrink: 0;
  margin-left: auto;
  color: var(--ink-muted);
  font-size: var(--text-micro);
  white-space: nowrap;
}

.discard-button {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--ink-disabled);
  cursor: pointer;
}

.discard-button:hover {
  color: var(--danger);
}

.entity-trailing {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 5px;
  margin-left: auto;
}

.draft-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--warning);
}

.entity-version {
  color: var(--ink-muted);
  font-size: var(--text-micro);
  white-space: nowrap;
}

.entity-row.selected .entity-version {
  color: var(--action-ink);
}

.list-empty {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-3);
}

.list-empty-hint {
  color: var(--ink-muted);
  line-height: var(--leading-normal);
}
</style>
