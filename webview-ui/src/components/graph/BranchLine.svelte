<script lang="ts">
  interface Props {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    color: string;
    isMerge?: boolean;
  }

  let { fromX, fromY, toX, toY, color, isMerge = false }: Props = $props();

  const BEND = 16;

  let pathD = $derived.by(() => {
    const dx = toX - fromX;
    const dy = toY - fromY;

    if (dx === 0) {
      return `M ${fromX} ${fromY} L ${toX} ${toY}`;
    }

    if (Math.abs(dy) < 2) {
      return `M ${fromX} ${fromY} L ${toX} ${toY}`;
    }

    const bend = Math.min(BEND, Math.abs(dy) * 0.45);

    if (isMerge) {
      // Merge line: ALWAYS horizontal first from merge commit toward source branch
      return [
        `M ${fromX} ${fromY}`,
        `Q ${toX} ${fromY}, ${toX} ${fromY + bend}`,
        `L ${toX} ${toY}`,
      ].join(' ');
    } else {
      // First-parent / rail shift: vertical first, curve at the end
      return [
        `M ${fromX} ${fromY}`,
        `L ${fromX} ${toY - bend}`,
        `Q ${fromX} ${toY}, ${toX} ${toY}`,
      ].join(' ');
    }
  });
</script>

<!-- Glow -->
<path d={pathD} fill="none" stroke={color} stroke-width="5" opacity="0.07" stroke-linecap="round" stroke-linejoin="round" />
<!-- Main -->
<path d={pathD} fill="none" stroke={color} stroke-width="2" opacity="0.85" stroke-linecap="round" stroke-linejoin="round" />
