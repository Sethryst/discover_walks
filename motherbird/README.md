# Walk & Wildlife

Walk & Wildlife is a vanilla JavaScript, local-first PWA. It is a viewfinder over static regional packs, with the device as the source of truth for a person’s walk.

## Current view

- The viewfinder is `100dvh`. The map fills the frame, the chrome overlays it, and the page does not scroll.
- The lights are **NEWS**, **RECREATION**, **CUISINE**, and **MY PLACES**.
- Recreation chips are **nature**, **trails**, **historic**, **routes**, and **volunteer**.
- Cuisine chips are **cafés**, **markets**, and **restaurants**. Cuisine starts off. Empty lights stay hidden.
- Controls include **Locate** (GPS), **Start walk**, **End walk** as its own control, **Add Location**, the **Journal** overlay, and the **Field Guide** with **Discover**, **Learn**, **App**, and **My maps**.
- The App tab has three entries: **Online**, **Offline**, and **Share**. Export, legal links, and Clear stay in the footer.
- The splash screen fills the iPhone view. Use `100dvh` and `-webkit-fill-available`. Do not use `100lvh` for splash height.

Discover paints numbered **1**, **2**, and **3** from pack stop IDs. It does not invent a crow-flies route. Journeys may use official GIS lines.

Packs are static JSON emitted by Gremlin Lab. The device is the source of truth: GPS, journal entries, and photos never sync.

## Run locally

Serve this directory with a static server. Do not open it with `file://`.

```powershell
cd motherbird
python -m http.server 8080
```

Then open [http://localhost:8080](http://localhost:8080). Real GPS and installability may require HTTPS on a physical phone.

## Region notes

The default is not Vienna. Fairfax is the proof pack, not a forced idle city. County packages swallow Vienna, Herndon, and Reston; Falls Church and Fairfax City stay independent.
