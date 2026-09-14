<!--
  The one dropdown body every mediatype picker uses.

  A result is either a table or a graph, so the formats are headed that way —
  and the query type only *suggests*, it never forbids: everything stays
  selectable, the formats that would be odd for this query are just played
  down. An ASK answers with a boolean rather than rows, so its SPARQL Results
  heading says BOOLEAN.
-->
<template>
  <SelectContent>
    <SelectGroup v-for="group in groups" :key="group.category">
      <SelectLabel class="format-category-label">
        {{ group.label }}
      </SelectLabel>
      <SelectItem
        v-for="option in group.options"
        :key="option.value"
        :value="option.value"
        :class="{ 'select-item-secondary': !option.isPrimary }"
        :title="getMediaTypeHint(option, queryType) ?? undefined"
      >
        {{ option.label }}
      </SelectItem>
    </SelectGroup>
  </SelectContent>
</template>

<script setup lang="ts">
import SelectContent from '../ui/select/SelectContent.vue';
import SelectGroup from '../ui/select/SelectGroup.vue';
import SelectItem from '../ui/select/SelectItem.vue';
import SelectLabel from '../ui/select/SelectLabel.vue';
import {
  getMediaTypeHint,
  type GroupedMediaTypeOption,
  type QueryType,
} from '@/lib/mediaTypes';

defineProps<{
  groups: GroupedMediaTypeOption[];
  /** Only used to word the hint on a played-down option. */
  queryType?: QueryType;
}>();
</script>
