<script lang="ts">
  import { ui } from './ui.svelte.ts';
</script>

<span class="pill {ui.online ? 'online' : 'offline'}">● {ui.online ? 'Онлайн' : 'Без връзка'}</span>
