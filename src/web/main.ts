import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-700.css';
import '@fontsource/ibm-plex-sans/cyrillic-400.css';
import '@fontsource/ibm-plex-sans/cyrillic-600.css';
import '@fontsource/ibm-plex-sans/cyrillic-700.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './styles.css';
import { mount } from 'svelte';
import App from './App.svelte';

if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

export default mount(App, { target: document.getElementById('app')! });
