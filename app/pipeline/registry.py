"""Approved provider registry; unapproved source types cannot execute."""

from __future__ import annotations

from app.pipeline.adapters.arcgis import ArcGisFeatureServiceProvider
from app.pipeline.adapters.base import SourceAdapter
from app.pipeline.adapters.geojson import GeoJsonProvider
from app.pipeline.adapters.local_open_data import LocalOpenDataProvider
from app.pipeline.adapters.osm import OsmOverpassProvider
from app.pipeline.adapters.ebird import EbirdHotspotsProvider, EbirdProvider
from app.pipeline.adapters.nps import NpsEventsProvider
from app.pipeline.adapters.usgs_water import UsgsMonitoringLocationsProvider
from app.pipeline.adapters.tribe_events import TribeEventsProvider
from app.pipeline.adapters.philly_events import PhiladelphiaSpecialEventsProvider
from app.pipeline.adapters.nyc_events import NycEventsProvider
from app.pipeline.source_config import SourceConfig


class ProviderRegistry:
    """Factory for supported, explicitly configured source providers."""

    _providers: dict[str, type[SourceAdapter]] = {
        "arcgis_feature_service": ArcGisFeatureServiceProvider,
        "geojson": GeoJsonProvider,
        "local_open_data": LocalOpenDataProvider,
        "osm_overpass": OsmOverpassProvider,
        "ebird_recent": EbirdProvider,
        "ebird_hotspots": EbirdHotspotsProvider,
        "nps_events": NpsEventsProvider,
        "usgs_monitoring_locations": UsgsMonitoringLocationsProvider,
        "tribe_events": TribeEventsProvider,
        "phila_special_events": PhiladelphiaSpecialEventsProvider,
        "nyc_events": NycEventsProvider,
    }

    @classmethod
    def create(cls, source: SourceConfig) -> SourceAdapter:
        """Instantiate the configured provider or fail before acquisition begins."""
        try:
            return cls._providers[source.provider]()
        except KeyError as exc:
            raise ValueError(f"Unsupported provider '{source.provider}' for source '{source.id}'.") from exc
