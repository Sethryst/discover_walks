// Keep the whole module graph with the shell. Caching only app.js leaves an
// offline (or briefly disconnected) reload with a blank app when any imported
// module was not already in the runtime cache.
const APP_CACHE = 'walk-wildlife-shell-v84'; // bump when shell assets change
