# Repairing a browser with a stuck old tab

1. Open the canonical site with `?diagnose=1` and inspect the storage state and recent transitions.
2. Close every other tab, installed PWA window, and app shortcut for the site.
3. Reload the diagnostic page. The new tab should release its old connection on `pagehide` and reopen the database.
4. If the state is `quota-exceeded`, remove only unused site data or large optional regional/media caches, then reload.
5. If it remains `failed`, export any available local backup before using the app’s deletion control; deletion is irreversible for that browser.
