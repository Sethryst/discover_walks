# Your next decisions and source checklist

## No key needed

- Send one editorial or organizer-controlled **free-event calendar** per remaining region when you find a better one than the current registry.
- Prioritize sources that expose date/time, physical venue/address, and an explicit free claim.
- For public meetings, send the official council, planning, school-board, or community-board calendar—not PDFs unless there is no calendar.
- For volunteer opportunities, send the direct opportunity or signup page, not a general organization homepage.

## Regions to source next

For each, send a direct free-event or organizer calendar with date/time, physical location, and an explicit free claim where possible.

- Asheville, NC
- Boise, Meridian & Old Town, ID
- Boston, MA
- Boulder, CO
- Chicago, IL
- Denver, CO
- Keystone / Summit County, CO
- New Orleans, LA
- Norfolk, VA
- New York City, NY
- Philadelphia, PA
- Portland, ME
- Portland, OR
- Prince George's County, MD
- Richmond, VA
- San Francisco, CA
- Santa Fe, NM
- Seattle, WA
- Sedona, AZ
- Washington, DC
- Wolf Trap / Vienna, VA

### Best immediate targets

1. NYC, San Francisco, Chicago, Portland OR, Seattle — mature editorial free-event calendars; send any feed/API/RSS endpoint or calendar export you find.
2. Prince George's County, Washington DC, Norfolk, Sedona, Boise-Meridian, Wolf Trap — city, parks, library, or venue calendars with usable addresses.
3. Asheville, Boulder, Keystone, New Orleans, Portland ME, Richmond, Santa Fe, Boston, Denver, Philadelphia — direct official or trusted editorial calendar pages.

## Remaining data gaps (August 6, 2026 audit)

No further API key is required for the current build path. The missing production data is source-specific:

- **Free events:** verified map events are currently only present for Philadelphia and Wolf Trap. NYC and Boise-Meridian also have verified broad-area Events-table cards; these intentionally remain off-map until a precise venue/address is available. For the other regions, the discovery registry exists but needs a fixture-tested parser or stable feed endpoint before publication.
- **Public meetings:** no `civic/meetings.json` has been published yet. The most useful contribution is one official meetings/calendar URL per region that states whether public comment is accepted and lists a physical or virtual location.
- **Volunteer:** current verified coverage is Prince George's County, Norfolk, NYC, Philadelphia, Washington DC, and Sedona. For all other regions, send the direct city/parks/nonprofit opportunity page with signup link and requirements.

The supplied source packet now covers every region in `app/regions/civic-source-priority.json`. Please do not send credentials for editorial calendars. A sample event page, RSS/ICS export, or documented public endpoint is more useful than a key.

## Keys worth getting later

1. **AirNow API key** — only if you want AQI alongside NWS weather. NWS weather is already live without a key.
2. **Local transit GTFS-realtime keys**, where an agency requires one — highest value for reliable transit-access/barrier indicators.
3. **City GIS/Open Data app tokens**, only for regions where the public endpoint rate-limits the producer.

## Do not obtain yet

- iNaturalist JWT: public reads are sufficient and authenticated access can reveal protected coordinates.
- Paid review, ratings, or reservation APIs: they do not fit the civic/discovery mission.

## Review cadence

- Events: refresh weekly or before each package build.
- NWS: refresh at least twice daily; artifacts expire after 12 hours.
- Volunteer and civic listings: refresh monthly or when an organizer changes its page.
