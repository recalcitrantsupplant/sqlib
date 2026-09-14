<template>
  <div class="kg-spinner" role="status" :aria-label="ariaLabel">
    <svg
      class="kg"
      viewBox="0 0 240 240"
      :style="{
        '--glowEdge': `url(#${edgeFilterId})`,
        '--glowNode': `url(#${nodeFilterId})`,
        width: size,
        height: size,
      }"
      aria-hidden="true"
    >
      <defs>
        <filter :id="edgeFilterId" x="-45%" y="-45%" width="190%" height="190%">
          <feGaussianBlur stdDeviation="2.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter :id="nodeFilterId" x="-70%" y="-70%" width="240%" height="240%">
          <feGaussianBlur stdDeviation="4.2" result="b" />
          <feColorMatrix
            in="b"
            type="matrix"
            values="1.35 0 0 0 0
                    0 1.35 0 0 0
                    0 0 1.35 0 0
                    0 0 0 1 0"
            result="bb"
          />
          <feMerge>
            <feMergeNode in="bb" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g class="edges">
        <path class="edgeBack" d="M44 128 L64 70" /><path class="edge" d="M44 128 L64 70" />
        <path class="edgeBack" d="M64 70 L118 36" /><path class="edge" d="M64 70 L118 36" />
        <path class="edgeBack" d="M118 36 L170 58" /><path class="edge" d="M118 36 L170 58" />
        <path class="edgeBack" d="M170 58 L196 112" /><path class="edge" d="M170 58 L196 112" />
        <path class="edgeBack" d="M196 112 L164 176" /><path class="edge" d="M196 112 L164 176" />
        <path class="edgeBack" d="M164 176 L92 196" /><path class="edge" d="M164 176 L92 196" />
        <path class="edgeBack" d="M92 196 L44 128" /><path class="edge" d="M92 196 L44 128" />
        <path class="edgeBack" d="M64 70 L196 112" /><path class="edge" d="M64 70 L196 112" />
        <path class="edgeBack" d="M118 36 L164 176" /><path class="edge" d="M118 36 L164 176" />
        <path class="edgeBack" d="M44 128 L170 58" /><path class="edge" d="M44 128 L170 58" />
        <path class="edgeBack" d="M92 196 L196 112" /><path class="edge" d="M92 196 L196 112" />
        <path class="edgeBack" d="M74 124 L164 176" /><path class="edge" d="M74 124 L164 176" />
        <path class="edgeBack" d="M138 122 L64 70" /><path class="edge" d="M138 122 L64 70" />
        <path class="edgeBack" d="M138 122 L92 196" /><path class="edge" d="M138 122 L92 196" />

        <path class="edgeBack h1" d="M64 70 L118 36" /><path class="edge h1" d="M64 70 L118 36" />
        <path class="edgeBack h1" d="M118 36 L170 58" /><path class="edge h1" d="M118 36 L170 58" />
        <path class="edgeBack h1" d="M170 58 L196 112" /><path class="edge h1" d="M170 58 L196 112" />

        <path class="edgeBack h2" d="M44 128 L170 58" /><path class="edge h2" d="M44 128 L170 58" />
        <path class="edgeBack h2" d="M64 70 L196 112" /><path class="edge h2" d="M64 70 L196 112" />
        <path class="edgeBack h2" d="M92 196 L196 112" /><path class="edge h2" d="M92 196 L196 112" />

        <path class="edgeBack h3" d="M118 36 L164 176" /><path class="edge h3" d="M118 36 L164 176" />
        <path class="edgeBack h3" d="M196 112 L164 176" /><path class="edge h3" d="M196 112 L164 176" />
        <path class="edgeBack h3" d="M164 176 L92 196" /><path class="edge h3" d="M164 176 L92 196" />
      </g>

      <g class="nodes">
        <g class="nh2">
          <circle class="nodeShape" cx="44" cy="128" r="8.2" stroke-width="3.0" />
          <circle class="nodeCore" cx="44" cy="128" r="3.1" />
        </g>

        <g class="nh1">
          <circle class="nodeShape" cx="64" cy="70" r="8.2" stroke-width="3.0" />
          <circle class="nodeCore" cx="64" cy="70" r="3.1" />
        </g>

        <g class="nh1">
          <circle class="nodeShape" cx="118" cy="36" r="8.2" stroke-width="3.0" />
          <circle class="nodeCore" cx="118" cy="36" r="3.1" />
        </g>

        <g class="nh1">
          <circle class="nodeShape" cx="170" cy="58" r="8.2" stroke-width="3.0" />
          <circle class="nodeCore" cx="170" cy="58" r="3.1" />
        </g>

        <g class="nh2">
          <circle class="nodeShape" cx="196" cy="112" r="8.2" stroke-width="3.0" />
          <circle class="nodeCore" cx="196" cy="112" r="3.1" />
        </g>

        <g class="nh3">
          <circle class="nodeShape" cx="164" cy="176" r="8.2" stroke-width="3.0" />
          <circle class="nodeCore" cx="164" cy="176" r="3.1" />
        </g>

        <g class="nh2">
          <circle class="nodeShape" cx="92" cy="196" r="8.2" stroke-width="3.0" />
          <circle class="nodeCore" cx="92" cy="196" r="3.1" />
        </g>

        <g>
          <circle class="nodeShape" cx="74" cy="124" r="7.2" stroke-width="2.6" />
          <circle class="nodeCore" cx="74" cy="124" r="2.7" />
        </g>

        <g>
          <circle class="nodeShape" cx="138" cy="122" r="7.2" stroke-width="2.6" />
          <circle class="nodeCore" cx="138" cy="122" r="2.7" />
        </g>

        <g>
          <circle class="nodeShape" cx="116" cy="132" r="7.2" stroke-width="2.6" />
          <circle class="nodeCore" cx="116" cy="132" r="2.7" />
        </g>
      </g>
    </svg>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    size?: string;
    ariaLabel?: string;
  }>(),
  {
    size: '220px',
    ariaLabel: 'Running query',
  }
);

const edgeFilterId = `kg-edge-${Math.random().toString(36).slice(2, 9)}`;
const nodeFilterId = `kg-node-${Math.random().toString(36).slice(2, 9)}`;

const size = computed(() => props.size);
const ariaLabel = computed(() => props.ariaLabel);
</script>

<style scoped>
.kg-spinner {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.kg {
  --node: rgba(94, 110, 132, 0.9);
  --edge: rgba(122, 134, 152, 0.32);
  --hot1: var(--brand-1);
  --hot2: var(--brand-2);
  --hot3: var(--brand-3);
  display: block;
}

.kg .edgeBack {
  fill: none;
  opacity: 0.18;
}

.kg .edge {
  stroke: var(--edge);
  fill: none;
  opacity: 0.28;
  stroke-width: 2.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.kg .nodeShape {
  stroke: var(--node);
  fill: transparent;
  opacity: 0.72;
}

.kg .nodeCore {
  fill: var(--node);
  opacity: 0.35;
}

.kg .h1 {
  animation: stage1 1.8s ease-in-out infinite;
  filter: var(--glowEdge);
}

.kg .h2 {
  animation: stage2 1.8s ease-in-out infinite;
  filter: var(--glowEdge);
}

.kg .h3 {
  animation: stage3 1.8s ease-in-out infinite;
  filter: var(--glowEdge);
}

.kg .nh1 {
  animation: nodeStage1 1.8s ease-in-out infinite;
}

.kg .nh2 {
  animation: nodeStage2 1.8s ease-in-out infinite;
}

.kg .nh3 {
  animation: nodeStage3 1.8s ease-in-out infinite;
}

@keyframes stage1 {
  0%,
  18% {
    stroke: var(--hot1);
    opacity: 0.95;
  }
  22%,
  100% {
    stroke: var(--edge);
    opacity: 0.2;
  }
}

@keyframes stage2 {
  0%,
  32% {
    stroke: var(--edge);
    opacity: 0.2;
  }
  36%,
  54% {
    stroke: var(--hot2);
    opacity: 0.95;
  }
  58%,
  100% {
    stroke: var(--edge);
    opacity: 0.2;
  }
}

@keyframes stage3 {
  0%,
  64% {
    stroke: var(--edge);
    opacity: 0.2;
  }
  68%,
  86% {
    stroke: var(--hot3);
    opacity: 0.95;
  }
  90%,
  100% {
    stroke: var(--edge);
    opacity: 0.2;
  }
}

@keyframes nodeStage1 {
  0%,
  18% {
    stroke: var(--hot1);
    opacity: 1;
    filter: var(--glowNode);
  }
  22%,
  100% {
    stroke: var(--node);
    opacity: 0.72;
    filter: none;
  }
}

@keyframes nodeStage2 {
  0%,
  32% {
    stroke: var(--node);
    opacity: 0.72;
    filter: none;
  }
  36%,
  54% {
    stroke: var(--hot2);
    opacity: 1;
    filter: var(--glowNode);
  }
  58%,
  100% {
    stroke: var(--node);
    opacity: 0.72;
    filter: none;
  }
}

@keyframes nodeStage3 {
  0%,
  64% {
    stroke: var(--node);
    opacity: 0.72;
    filter: none;
  }
  68%,
  86% {
    stroke: var(--hot3);
    opacity: 1;
    filter: var(--glowNode);
  }
  90%,
  100% {
    stroke: var(--node);
    opacity: 0.72;
    filter: none;
  }
}
</style>
