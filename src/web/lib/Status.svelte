<script lang="ts">
  import { sync, syncNow } from './sync.svelte.ts';

  const label = $derived.by(() => {
    if (sync.conflicts) return `⚠ ${sync.conflicts} конфликт${sync.conflicts === 1 ? '' : 'а'}`;
    switch (sync.state) {
      case 'offline':
        return sync.pending ? `● Без връзка · ${sync.pending} чакат` : '● Без връзка';
      case 'syncing':
        return '↻ Синхронизира…';
      case 'auth':
        return '⚠ Влез отново';
      case 'error':
        return '⚠ Грешка при синхр.';
      case 'unavailable':
        return '● Само локално';
      default:
        return sync.pending ? `● ${sync.pending} чакат` : '✓ Синхронизирано';
    }
  });
  const tone = $derived(
    sync.conflicts || sync.state === 'auth' || sync.state === 'error'
      ? 'offline'
      : sync.state === 'offline' || sync.pending || sync.state === 'unavailable'
        ? 'offline'
        : 'online'
  );

  function act() {
    if (sync.state === 'auth') location.reload();
    else if (sync.conflicts || sync.state === 'error') location.hash = '/settings';
    else syncNow();
  }
</script>

<button type="button" class="pill {tone}" style="border: 0; cursor: pointer; min-height: 32px" onclick={act} title={sync.error || 'Синхронизирай сега'}>{label}</button>
