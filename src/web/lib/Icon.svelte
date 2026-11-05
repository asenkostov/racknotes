<script lang="ts">
  const paths = {
    back: 'M15 5l-7 7 7 7',
    close: 'M6 6l12 12M18 6L6 18',
    plus: 'M12 5v14M5 12h14',
    chevron: 'M9 5l7 7-7 7',
    camera: 'M4 8h3l2-3h6l2 3h3v11H4zM15.5 13a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0',
    rack: 'M5 3h14v18H5zM9 8h6M9 12h6M9 16h6',
    note: 'M5 4h14v16H5zM9 9h6M9 13h6M9 17h3',
    room: 'M3 21V5h12v16M15 9h6v12H3M8 10h2M8 14h2',
    settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-1-3-2 .2-1.3-1.3L17 5l-3-1-1 2h-2L10 4 7 5l.3 2-1.3 1.3L4 8.2 3 11l2 1v1l-2 1 1 3 2-.2 1.3 1.3L7 19l3 1 1-2h2l1 2 3-1-.3-2 1.3-1.3 2 .2 1-3-2-1z',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
    edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
    logo: 'M4 3h16v18H4zM8 8h8M8 12h8M8 16h5'
  } as const;
  let { name, size = 22, stroke = 'currentColor' }: { name: keyof typeof paths; size?: number; stroke?: string } = $props();
</script>

<svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" {stroke} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d={paths[name]} />
</svg>
