<script lang="ts">
  interface Props {
    x: number;
    y: number;
    color: string;
    isMerge: boolean;
    isHead: boolean;
  }

  let { x, y, color, isMerge, isHead }: Props = $props();
</script>

{#if isHead}
  <!-- Outer glow ring for HEAD -->
  <circle cx={x} cy={y} r={8} fill={color} opacity="0.12" />
  <circle cx={x} cy={y} r={6} fill="none" stroke={color} stroke-width="1.5" opacity="0.5" />
{/if}

<!-- Node body -->
<circle cx={x} cy={y} r={isMerge ? 5 : 4} fill={color} />

{#if isMerge}
  <!-- Inner hole for merge commits -->
  <circle cx={x} cy={y} r={2} fill="var(--bg-primary, #1e1e1e)" />
{/if}
